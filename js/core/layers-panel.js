// js/core/layers-panel.js
// "Layers" tab on the right feature panel. A unified manager for everything on
// the map: drawn features (nested by user group), reference/imported layers
// (GTFS, OSM, muni boundaries), analysis choropleths (TPI, Corridor Scoring,
// Ridership), and the basemap. Phase 1: visibility + opacity + basemap. Reorder
// and per-row actions land in phase 2.
// Depends on: App.map, App.collectDrawnFeatures, App.UNIVERSAL_GROUP_KEY,
//             App.rerenderForType, App.openColorPicker, App._openFpSlider,
//             App.applyFeatureOpacity, App.getBasemaps, App.switchBasemap,
//             App.cache, App.refreshFeaturePanel.
(function () {
  var App = window.App = window.App || {};

  var EYE_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 13 1 13a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var OPACITY_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2"><circle cx="12" cy="12" r="9"/>' +
    '<path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>';

  // ---- Reference + analysis layer manifest ----
  // Each entry: { id (presence/detect key), label, layers:[{id, op}] }.
  var REFERENCE = [
    { id: "muni-boundaries-line", label: "Municipal boundaries", layers: [{ id: "muni-boundaries-line", op: "line-opacity" }] },
    { id: "gtfs-shapes-layer",    label: "GTFS routes",          layers: [{ id: "gtfs-shapes-layer", op: "line-opacity" }] },
    { id: "gtfs-stops-layer",     label: "GTFS stops",           layers: [{ id: "gtfs-stops-layer", op: "circle-opacity" }] },
    { id: "osm-points-layer",     label: "OSM points",           layers: [{ id: "osm-points-layer", op: "circle-opacity" }] },
    { id: "osm-lines-layer",      label: "OSM lines",            layers: [{ id: "osm-lines-layer", op: "line-opacity" }] },
    { id: "osm-poi-layer",        label: "OSM points of interest", layers: [{ id: "osm-poi-layer", op: "circle-opacity" }] }
  ];
  var ANALYSIS = [
    { id: "tpi-choropleth-fill", label: "Transit Propensity",
      layers: [{ id: "tpi-choropleth-fill", op: "fill-opacity" }, { id: "tpi-choropleth-line", op: "line-opacity" }] },
    { id: "corridor-scoring-routes-layer", label: "Corridor Scoring",
      layers: [{ id: "corridor-scoring-routes-layer", op: "line-opacity" }] },
    { id: "rf-choropleth-fill", label: "Ridership Forecast",
      layers: [{ id: "rf-choropleth-fill", op: "fill-opacity" }, { id: "rf-choropleth-line", op: "line-opacity" }, { id: "rf-corridor-cdi-layer", op: "line-opacity" }] }
  ];

  var DRAWN_TYPES = [
    { type: "point",   label: "Points"   },
    { type: "line",    label: "Lines"    },
    { type: "route",   label: "Routes"   },
    { type: "polygon", label: "Polygons" }
  ];

  // ---- Map helpers ----
  function entryPresent(entry) {
    var map = App.map;
    return !!map && entry.layers.some(function (L) { return map.getLayer(L.id); });
  }
  function entryVisible(entry) {
    var map = App.map;
    for (var i = 0; i < entry.layers.length; i++) {
      var L = entry.layers[i];
      if (map.getLayer(L.id)) return map.getLayoutProperty(L.id, "visibility") !== "none";
    }
    return false;
  }
  function setEntryVisible(entry, vis) {
    var map = App.map;
    entry.layers.forEach(function (L) {
      if (map.getLayer(L.id)) map.setLayoutProperty(L.id, "visibility", vis ? "visible" : "none");
    });
  }
  function entryOpacity(entry) {
    var map = App.map;
    for (var i = 0; i < entry.layers.length; i++) {
      var L = entry.layers[i];
      if (map.getLayer(L.id)) {
        var v = map.getPaintProperty(L.id, L.op);
        return (typeof v === "number") ? v : 1;
      }
    }
    return 1;
  }
  function setEntryOpacity(entry, frac) {
    var map = App.map;
    entry.layers.forEach(function (L) {
      if (map.getLayer(L.id)) map.setPaintProperty(L.id, L.op, frac);
    });
  }

  // ---- Generic row builder (reference / analysis) ----
  function buildLayerRow(entry) {
    var row = document.createElement("div");
    row.className = "lp-row";

    var vis = entryVisible(entry);
    var eye = document.createElement("button");
    eye.type = "button";
    eye.className = "lp-row-btn" + (vis ? "" : " lp-eye-off");
    eye.innerHTML = vis ? EYE_SVG : EYE_OFF_SVG;
    eye.title = vis ? "Hide layer" : "Show layer";
    eye.addEventListener("click", function (e) {
      e.stopPropagation();
      setEntryVisible(entry, !entryVisible(entry));
      render();
    });
    row.appendChild(eye);

    var name = document.createElement("span");
    name.className = "lp-row-label";
    name.textContent = entry.label;
    row.appendChild(name);

    var op = document.createElement("button");
    op.type = "button";
    op.className = "lp-row-btn lp-row-op";
    op.innerHTML = OPACITY_SVG;
    op.title = "Opacity";
    op.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof App._openFpSlider !== "function") return;
      App._openFpSlider(op, {
        value: Math.round(entryOpacity(entry) * 100),
        min: 0, max: 100, step: 5, unit: "%",
        onChange: function (v) { setEntryOpacity(entry, v / 100); }
      });
    });
    row.appendChild(op);

    return row;
  }

  // ---- Drawn features (nested by user group) ----
  function collectGroups() {
    var all = (typeof App.collectDrawnFeatures === "function") ? App.collectDrawnFeatures() : [];
    var key = App.UNIVERSAL_GROUP_KEY || "group";
    var groups = {}, ungrouped = [];
    all.forEach(function (it) {
      var a = it.feature.properties.attributes;
      var g = a && a[key];
      if (g) { (groups[g] = groups[g] || []).push(it); }
      else { ungrouped.push(it); }
    });
    return { groups: groups, ungrouped: ungrouped };
  }

  function setItemsHidden(items, hide) {
    var types = {};
    items.forEach(function (it) {
      if (hide) it.feature.properties.hidden = true;
      else delete it.feature.properties.hidden;
      types[it.type] = true;
    });
    Object.keys(types).forEach(function (t) { App.rerenderForType(t); });
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function buildFeatureRow(it) {
    var row = document.createElement("div");
    row.className = "lp-row lp-row-sub";

    var hidden = !!it.feature.properties.hidden;
    var eye = document.createElement("button");
    eye.type = "button";
    eye.className = "lp-row-btn" + (hidden ? " lp-eye-off" : "");
    eye.innerHTML = hidden ? EYE_OFF_SVG : EYE_SVG;
    eye.title = hidden ? "Show" : "Hide";
    eye.addEventListener("click", function (e) {
      e.stopPropagation();
      setItemsHidden([it], !it.feature.properties.hidden);
      render();
    });
    row.appendChild(eye);

    var color = it.feature.properties.color || App.getTypeDefaultColor(it.type);
    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "lp-swatch";
    sw.style.background = color;
    sw.title = "Change color";
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      App.openColorPicker(sw, it.feature.properties.color || color, function (nc) {
        it.feature.properties.color = nc;
        sw.style.background = nc;
        App.rerenderForType(it.type);
        if (App.cache && typeof App.cache.save === "function") App.cache.save();
        if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
      });
    });
    row.appendChild(sw);

    var name = document.createElement("span");
    name.className = "lp-row-label";
    name.textContent = it.feature.properties.name || (it.type + " " + (it.index + 1));
    row.appendChild(name);

    return row;
  }

  var _expandedGroups = {};

  function buildGroupBlock(groupName, items) {
    var block = document.createElement("div");
    block.className = "lp-group";

    var header = document.createElement("div");
    header.className = "lp-row lp-group-header";

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "lp-caret";
    var open = !!_expandedGroups[groupName];
    toggle.innerHTML = "&#9662;";
    toggle.classList.toggle("open", open);
    header.appendChild(toggle);

    var allHidden = items.every(function (it) { return !!it.feature.properties.hidden; });
    var eye = document.createElement("button");
    eye.type = "button";
    eye.className = "lp-row-btn" + (allHidden ? " lp-eye-off" : "");
    eye.innerHTML = allHidden ? EYE_OFF_SVG : EYE_SVG;
    eye.title = allHidden ? "Show all" : "Hide all";
    eye.addEventListener("click", function (e) {
      e.stopPropagation();
      setItemsHidden(items, !allHidden);
      render();
    });
    header.appendChild(eye);

    var firstColor = items[0].feature.properties.color || App.getTypeDefaultColor(items[0].type);
    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "lp-swatch";
    sw.style.background = firstColor;
    sw.title = "Change color for all in group";
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      App.openColorPicker(sw, firstColor, function (nc) {
        var types = {};
        items.forEach(function (it) { it.feature.properties.color = nc; types[it.type] = true; });
        sw.style.background = nc;
        Object.keys(types).forEach(function (t) { App.rerenderForType(t); });
        if (App.cache && typeof App.cache.save === "function") App.cache.save();
        if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
        render();
      });
    });
    header.appendChild(sw);

    var name = document.createElement("span");
    name.className = "lp-row-label";
    name.textContent = groupName + " (" + items.length + ")";
    header.appendChild(name);

    var body = document.createElement("div");
    body.className = "lp-group-body";
    body.style.display = open ? "" : "none";
    items.forEach(function (it) { body.appendChild(buildFeatureRow(it)); });

    function toggleOpen(e) {
      if (e.target !== toggle && !toggle.contains(e.target) &&
          e.target !== name) return;
      e.stopPropagation();
      var isOpen = body.style.display !== "none";
      body.style.display = isOpen ? "none" : "";
      toggle.classList.toggle("open", !isOpen);
      if (isOpen) delete _expandedGroups[groupName];
      else _expandedGroups[groupName] = true;
    }
    header.addEventListener("click", toggleOpen);

    block.appendChild(header);
    block.appendChild(body);
    return block;
  }

  // ---- Band scaffolding ----
  function buildBand(title) {
    var band = document.createElement("div");
    band.className = "lp-band";
    var h = document.createElement("div");
    h.className = "lp-band-title";
    h.textContent = title;
    band.appendChild(h);
    return band;
  }

  function buildTypeOpacityRow(t) {
    var row = document.createElement("div");
    row.className = "lp-row lp-row-sub";
    var label = document.createElement("span");
    label.className = "lp-row-label lp-row-label-indent";
    label.textContent = t.label + " opacity";
    row.appendChild(label);

    var op = document.createElement("button");
    op.type = "button";
    op.className = "lp-row-btn lp-row-op";
    op.innerHTML = OPACITY_SVG;
    op.title = t.label + " opacity";
    op.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof App._openFpSlider !== "function") return;
      App._openFpSlider(op, {
        key: t.type + "Opacity",
        min: 0, max: 100, step: 5, unit: "%",
        onChange: function () { App.applyFeatureOpacity(t.type); }
      });
    });
    row.appendChild(op);
    return row;
  }

  // ---- Basemap row ----
  function buildBasemapBand() {
    var band = buildBand("Basemap");
    if (typeof App.getBasemaps !== "function") return band;
    var row = document.createElement("div");
    row.className = "lp-row";
    var sel = document.createElement("select");
    sel.className = "lp-basemap-select";
    var cur = (typeof App.getCurrentBasemapId === "function") ? App.getCurrentBasemapId() : null;
    App.getBasemaps().forEach(function (b) {
      var o = document.createElement("option");
      o.value = b.id; o.textContent = b.name;
      if (b.id === cur) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      if (typeof App.switchBasemap === "function") App.switchBasemap(sel.value);
    });
    row.appendChild(sel);
    band.appendChild(row);
    return band;
  }

  // ---- Render ----
  function render() {
    var host = document.getElementById("fp-tab-layers");
    if (!host) return;
    host.innerHTML = "";

    // Drawn
    var drawnBand = buildBand("Drawn");
    var gc = collectGroups();
    var groupNames = Object.keys(gc.groups).sort();
    var anyDrawn = groupNames.length || gc.ungrouped.length;
    if (anyDrawn) {
      groupNames.forEach(function (gn) {
        drawnBand.appendChild(buildGroupBlock(gn, gc.groups[gn]));
      });
      if (gc.ungrouped.length) {
        drawnBand.appendChild(buildGroupBlock("Ungrouped", gc.ungrouped));
      }
      // Per-geometry-type opacity (drawn features share one layer per type)
      DRAWN_TYPES.forEach(function (t) {
        var arr = App[t.type === "point" ? "points" : t.type + "s"];
        if (arr && arr.length) drawnBand.appendChild(buildTypeOpacityRow(t));
      });
    } else {
      var empty = document.createElement("div");
      empty.className = "lp-empty";
      empty.textContent = "No drawn features yet.";
      drawnBand.appendChild(empty);
    }
    host.appendChild(drawnBand);

    // Analysis overlays (only those currently on the map)
    var analysisPresent = ANALYSIS.filter(entryPresent);
    if (analysisPresent.length) {
      var aBand = buildBand("Analysis overlays");
      analysisPresent.forEach(function (e) { aBand.appendChild(buildLayerRow(e)); });
      host.appendChild(aBand);
    }

    // Reference / imported (only those currently on the map)
    var refPresent = REFERENCE.filter(entryPresent);
    if (refPresent.length) {
      var rBand = buildBand("Reference / Imported");
      refPresent.forEach(function (e) { rBand.appendChild(buildLayerRow(e)); });
      host.appendChild(rBand);
    }

    // Basemap
    host.appendChild(buildBasemapBand());
  }

  function refreshLayersPanel() {
    var host = document.getElementById("fp-tab-layers");
    // Only rebuild when the Layers tab is actually visible (cheap no-op otherwise).
    if (!host || host.style.display === "none") return;
    render();
  }

  App.refreshLayersPanel = refreshLayersPanel;
})();
