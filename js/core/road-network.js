// js/core/road-network.js
// Offline road network: Overpass download, graph construction, Dijkstra pathfinding.
// Allows local street-snapped routing when OSRM servers are unavailable.
// Depends on: App.map (map.js), App.setStatus (utils.js), turf (CDN).
// Exports: roadNetworkLoaded, findLocalRoute, fetchRoadNetwork,
//          loadRoadNetworkFromFile, exportRoadNetwork, clearRoadNetwork

(function () {
  "use strict";
  var App = window.App;

  var OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  var SNAP_MAX_KM = 0.5; // max snap distance to road network (500 m)

  // ---- Private state ----

  var _roadGeoJSON = null;  // raw GeoJSON FeatureCollection (for export)
  var _graph = null;        // Map<nodeKey, [{node, weight, coords}]>
  var _allLines = null;     // turf FeatureCollection of LineStrings (for nearestPointOnLine)
  var _segmentIndex = null; // Array of {feature, startKey, endKey, startCoord, endCoord} per segment
  var _featureCount = 0;

  // ---- Byte formatting helper ----

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  // ---- Node key helper ----

  function nodeKey(coord) {
    return coord[0].toFixed(6) + "," + coord[1].toFixed(6);
  }

  function keyToCoord(key) {
    var parts = key.split(",");
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  }

  // ---- Graph construction ----

  function buildGraph(geojson) {
    var graph = new Map();
    var lines = [];
    var segments = [];
    var features = geojson.features || [];

    function addEdge(fromKey, toKey, weight, coordPair) {
      if (!graph.has(fromKey)) graph.set(fromKey, []);
      graph.get(fromKey).push({ node: toKey, weight: weight, coords: coordPair });
      if (!graph.has(toKey)) graph.set(toKey, []);
      graph.get(toKey).push({ node: fromKey, weight: weight, coords: coordPair.slice().reverse() });
    }

    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var geom = f.geometry;
      if (!geom) continue;

      var coordArrays = [];
      if (geom.type === "LineString" && geom.coordinates && geom.coordinates.length >= 2) {
        coordArrays.push(geom.coordinates);
      } else if (geom.type === "MultiLineString" && geom.coordinates) {
        for (var m = 0; m < geom.coordinates.length; m++) {
          if (geom.coordinates[m].length >= 2) coordArrays.push(geom.coordinates[m]);
        }
      }

      for (var a = 0; a < coordArrays.length; a++) {
        var coords = coordArrays[a];
        var lineFeature = turf.lineString(coords);
        lines.push(lineFeature);

        for (var j = 0; j < coords.length - 1; j++) {
          var c1 = coords[j];
          var c2 = coords[j + 1];
          var k1 = nodeKey(c1);
          var k2 = nodeKey(c2);
          var dist = turf.distance(turf.point(c1), turf.point(c2), { units: "kilometers" });
          addEdge(k1, k2, dist, [c1, c2]);
          segments.push({
            feature: lineFeature,
            startKey: k1,
            endKey: k2,
            startCoord: c1,
            endCoord: c2
          });
        }
      }
    }

    _graph = graph;
    _allLines = turf.featureCollection(lines);
    _segmentIndex = segments;
    _featureCount = features.length;
  }

  // ---- Snap to network ----

  function snapToNetwork(lngLat) {
    if (!_allLines || _allLines.features.length === 0) return null;

    var pt = turf.point([lngLat[0], lngLat[1]]);
    var nearest = turf.nearestPointOnLine(_allLines, pt, { units: "kilometers" });

    if (!nearest || nearest.properties.dist > SNAP_MAX_KM) return null;

    // Find the segment this point falls on
    var lineIdx = nearest.properties.index; // index into _allLines
    // nearestPointOnLine returns the feature-level index in the multi-line collection,
    // and the location property tells us where on that line the point sits.
    // We need the two nodes bracketing this point.
    var snappedCoord = nearest.geometry.coordinates;
    var snappedKey = nodeKey(snappedCoord);

    // The nearest point sits on a specific segment. Find the closest segment.
    var bestDist = Infinity;
    var bestSeg = null;
    for (var i = 0; i < _segmentIndex.length; i++) {
      var seg = _segmentIndex[i];
      var segLine = turf.lineString([seg.startCoord, seg.endCoord]);
      var np = turf.nearestPointOnLine(segLine, pt, { units: "kilometers" });
      if (np.properties.dist < bestDist) {
        bestDist = np.properties.dist;
        bestSeg = seg;
      }
    }

    if (!bestSeg || bestDist > SNAP_MAX_KM) return null;

    // Insert the snapped point into the graph temporarily by connecting it to both segment endpoints
    return {
      coord: snappedCoord,
      key: snappedKey,
      segStartKey: bestSeg.startKey,
      segEndKey: bestSeg.endKey,
      segStartCoord: bestSeg.startCoord,
      segEndCoord: bestSeg.endCoord
    };
  }

  // ---- Dijkstra shortest path ----

  // Simple binary min-heap for the priority queue
  function MinHeap() {
    this.data = [];
  }
  MinHeap.prototype.push = function (item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  };
  MinHeap.prototype.pop = function () {
    var top = this.data[0];
    var last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  };
  MinHeap.prototype.size = function () { return this.data.length; };
  MinHeap.prototype._bubbleUp = function (i) {
    while (i > 0) {
      var parent = (i - 1) >> 1;
      if (this.data[i].dist < this.data[parent].dist) {
        var tmp = this.data[i]; this.data[i] = this.data[parent]; this.data[parent] = tmp;
        i = parent;
      } else break;
    }
  };
  MinHeap.prototype._sinkDown = function (i) {
    var n = this.data.length;
    while (true) {
      var left = 2 * i + 1, right = 2 * i + 2, smallest = i;
      if (left < n && this.data[left].dist < this.data[smallest].dist) smallest = left;
      if (right < n && this.data[right].dist < this.data[smallest].dist) smallest = right;
      if (smallest === i) break;
      var tmp = this.data[i]; this.data[i] = this.data[smallest]; this.data[smallest] = tmp;
      i = smallest;
    }
  };

  function dijkstra(startKey, endKey) {
    if (!_graph || !_graph.has(startKey) || !_graph.has(endKey)) return null;
    if (startKey === endKey) return [keyToCoord(startKey)];

    var dist = new Map();
    var prev = new Map();
    var heap = new MinHeap();

    dist.set(startKey, 0);
    heap.push({ node: startKey, dist: 0 });

    while (heap.size() > 0) {
      var current = heap.pop();
      if (current.dist > (dist.get(current.node) || Infinity)) continue;
      if (current.node === endKey) break;

      var neighbors = _graph.get(current.node);
      if (!neighbors) continue;

      for (var i = 0; i < neighbors.length; i++) {
        var nb = neighbors[i];
        var newDist = current.dist + nb.weight;
        if (newDist < (dist.get(nb.node) || Infinity)) {
          dist.set(nb.node, newDist);
          prev.set(nb.node, { from: current.node, coords: nb.coords });
          heap.push({ node: nb.node, dist: newDist });
        }
      }
    }

    if (!prev.has(endKey) && startKey !== endKey) return null;

    // Reconstruct path
    var path = [];
    var cur = endKey;
    while (cur !== startKey) {
      var step = prev.get(cur);
      if (!step) return null;
      // step.coords goes from step.from → cur
      // Add the endpoint (cur's coord)
      path.unshift(keyToCoord(cur));
      cur = step.from;
    }
    path.unshift(keyToCoord(startKey));
    return path;
  }

  // ---- Public route finder ----

  function findLocalRoute(waypoints) {
    if (!_graph || waypoints.length < 2) return null;

    // Temporarily inject snap nodes into graph
    var tempEdges = []; // track what we add so we can clean up

    function injectSnapNode(snap) {
      var k = snap.key;
      if (_graph.has(k)) return; // already a real node

      _graph.set(k, []);

      // Connect snapped point to both segment endpoints
      var d1 = turf.distance(turf.point(snap.coord), turf.point(snap.segStartCoord), { units: "kilometers" });
      var d2 = turf.distance(turf.point(snap.coord), turf.point(snap.segEndCoord), { units: "kilometers" });

      _graph.get(k).push({ node: snap.segStartKey, weight: d1, coords: [snap.coord, snap.segStartCoord] });
      _graph.get(k).push({ node: snap.segEndKey, weight: d2, coords: [snap.coord, snap.segEndCoord] });

      if (_graph.has(snap.segStartKey)) {
        _graph.get(snap.segStartKey).push({ node: k, weight: d1, coords: [snap.segStartCoord, snap.coord] });
        tempEdges.push({ mapKey: snap.segStartKey, node: k });
      }
      if (_graph.has(snap.segEndKey)) {
        _graph.get(snap.segEndKey).push({ node: k, weight: d2, coords: [snap.segEndCoord, snap.coord] });
        tempEdges.push({ mapKey: snap.segEndKey, node: k });
      }

      tempEdges.push({ mapKey: k, isNew: true });
    }

    function cleanupTempNodes() {
      for (var i = 0; i < tempEdges.length; i++) {
        var te = tempEdges[i];
        if (te.isNew) {
          _graph.delete(te.mapKey);
        } else {
          // Remove the edge pointing to the temp node
          var edges = _graph.get(te.mapKey);
          if (edges) {
            for (var j = edges.length - 1; j >= 0; j--) {
              if (edges[j].node === te.node) { edges.splice(j, 1); break; }
            }
          }
        }
      }
    }

    var allCoords = [];

    try {
      for (var i = 0; i < waypoints.length - 1; i++) {
        var fromWp = waypoints[i];
        var toWp = waypoints[i + 1];

        var snapFrom = snapToNetwork(fromWp);
        var snapTo = snapToNetwork(toWp);

        if (!snapFrom || !snapTo) return null; // waypoint outside network coverage

        injectSnapNode(snapFrom);
        injectSnapNode(snapTo);

        var path = dijkstra(snapFrom.key, snapTo.key);
        if (!path || path.length < 2) return null; // no route found

        // Append path, dedup junction point
        if (allCoords.length > 0) {
          path = path.slice(1); // skip first point (same as last of previous segment)
        }
        allCoords = allCoords.concat(path);
      }
    } finally {
      cleanupTempNodes();
    }

    return allCoords.length >= 2 ? allCoords : null;
  }

  // ---- Overpass download ----

  async function fetchRoadNetwork() {
    if (!App.map) return;

    // Prevent double-clicks
    var btn = document.getElementById("road-net-download");
    if (btn) btn.disabled = true;

    var b = App.map.getBounds();
    var south = b.getSouth(), west = b.getWest(), north = b.getNorth(), east = b.getEast();

    var query = '[out:json][timeout:60];(' +
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|' +
      'residential|unclassified|service|motorway_link|trunk_link|' +
      'primary_link|secondary_link|tertiary_link)$"](' +
      south + ',' + west + ',' + north + ',' + east + ');' +
      ');out geom;';

    App.setStatus("Downloading road network\u2026");

    try {
      var resp = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query)
      });

      if (!resp.ok) throw new Error("Overpass API error: " + resp.status);

      // Stream the response to track download progress
      var contentLength = parseInt(resp.headers.get("Content-Length") || "0", 10);
      var reader = resp.body.getReader();
      var receivedBytes = 0;
      var chunks = [];
      var lastUpdate = 0;

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        receivedBytes += result.value.length;

        // Throttle status updates to every 200ms
        var now = Date.now();
        if (now - lastUpdate > 200) {
          lastUpdate = now;
          var msg = "Downloading road network\u2026 " + formatBytes(receivedBytes);
          if (contentLength > 0) {
            msg += " / " + formatBytes(contentLength) +
              " (" + Math.round((receivedBytes / contentLength) * 100) + "%)";
          }
          App.setStatus(msg);
        }
      }

      // Parse the downloaded data
      App.setStatus("Parsing road network (" + formatBytes(receivedBytes) + ")\u2026");
      var combined = new Uint8Array(receivedBytes);
      var offset = 0;
      for (var c = 0; c < chunks.length; c++) {
        combined.set(chunks[c], offset);
        offset += chunks[c].length;
      }
      var data = JSON.parse(new TextDecoder().decode(combined));
      var elements = data.elements || [];

      if (elements.length === 0) {
        App.setStatus("No roads found in this area");
        return;
      }

      // Convert Overpass JSON to GeoJSON with progress updates
      var features = [];
      var graphLastUpdate = Date.now();
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
        var coords = el.geometry.map(function (g) { return [g.lon, g.lat]; });
        features.push({
          type: "Feature",
          properties: {
            highway: (el.tags || {}).highway || "",
            name: (el.tags || {}).name || "",
            oneway: (el.tags || {}).oneway || ""
          },
          geometry: { type: "LineString", coordinates: coords }
        });

        // Update status every 500 elements and yield to keep UI responsive
        if (i % 500 === 0 && i > 0) {
          App.setStatus("Building routing graph (" +
            (i + 1).toLocaleString() + " / " + elements.length.toLocaleString() + " ways)\u2026");
          await new Promise(function (r) { setTimeout(r, 0); });
        }
      }

      var geojson = { type: "FeatureCollection", features: features };

      // Build graph (synchronous — fast for regional networks)
      buildGraph(geojson);
      _roadGeoJSON = geojson;

      updateUI();
      App.setStatus(_featureCount.toLocaleString() + " road segments loaded \u2014 local routing enabled");
    } catch (e) {
      App.setStatus("Road network download failed: " + (e.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---- File import / export ----

  function loadRoadNetworkFromFile(file) {
    App.setStatus("Loading road network from file\u2026");
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var geojson = JSON.parse(e.target.result);
        if (!geojson.features || geojson.features.length === 0) {
          App.setStatus("No features found in file");
          return;
        }
        buildGraph(geojson);
        _roadGeoJSON = geojson;
        updateUI();
        App.setStatus(_featureCount.toLocaleString() + " road segments loaded from " + file.name);
      } catch (err) {
        App.setStatus("Failed to parse road network: " + (err.message || err));
      }
    };
    reader.readAsText(file);
  }

  function exportRoadNetwork() {
    if (!_roadGeoJSON) {
      App.setStatus("No road network to export");
      return;
    }
    var blob = new Blob([JSON.stringify(_roadGeoJSON)], { type: "application/geo+json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "road-network-" + new Date().toISOString().slice(0, 10) + ".geojson";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function clearRoadNetwork() {
    _roadGeoJSON = null;
    _graph = null;
    _allLines = null;
    _segmentIndex = null;
    _featureCount = 0;
    updateUI();
  }

  // ---- UI helpers ----

  function updateUI() {
    var loaded = !!_graph;

    // Show/hide export button in Export dropdown
    var exportBtn = document.getElementById("export-road-net");
    if (exportBtn) exportBtn.style.display = loaded ? "" : "none";
  }

  // ---- Expose on App namespace ----

  App.roadNetworkLoaded = function () { return !!_graph; };
  App.findLocalRoute = findLocalRoute;
  App.fetchRoadNetwork = fetchRoadNetwork;
  App.loadRoadNetworkFromFile = loadRoadNetworkFromFile;
  App.exportRoadNetwork = exportRoadNetwork;
  App.clearRoadNetwork = clearRoadNetwork;

})();
