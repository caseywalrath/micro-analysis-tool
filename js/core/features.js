// js/core/features.js
// Right-side feature panel: lists all stations, lines, routes, polygons
// with editable names, per-item color swatches, and per-item delete buttons.
// Depends on: App.stations (stations.js), App.lines (lines.js),
//             App.polygons (polygons.js).
// Exports: refreshFeaturePanel, openColorPicker, updateFeatureColor

(function () {
  var App = window.App = window.App || {};

  // Tracks which route groups the user has manually collapsed.
  // Persists across refreshFeaturePanel() calls (survives DOM rebuilds).
  var _collapsedGroups = {};

  var CHEVRON_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="9 18 15 12 9 6"/>' +
    '</svg>';

  var EYE_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    '</svg>';

  var EYE_OFF_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94' +
    'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19' +
    'm-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
    '<line x1="1" y1="1" x2="23" y2="23"/>' +
    '</svg>';

  /* ---- Color picker (singleton popover) ---- */

  var PICKER_COLORS = [
    "#e53e3e","#c53030","#f56565",
    "#dd6b20","#c05621","#f6ad55",
    "#d69e2e","#b7791f","#faf089",
    "#38a169","#276749","#68d391",
    "#319795","#2c7a7b","#81e6d9",
    "#3182ce","#2b6cb0","#90cdf4",
    "#805ad5","#553c9a","#d6bcfa",
    "#d53f8c","#97266d","#fbb6ce",
    "#b0c4de","#718096","#e2e8f0",
    "#2d3748","#ffffff","#000000"
  ];

  var _picker = null;
  var _pickerCallback = null;
  var _pickerAnchor = null;

  function buildPicker() {
    if (_picker) return;
    var el = document.createElement("div");
    el.id = "fp-color-picker";
    el.style.display = "none";

    var grid = document.createElement("div");
    grid.className = "fp-cp-grid";
    PICKER_COLORS.forEach(function (c) {
      var cell = document.createElement("button");
      cell.className = "fp-cp-cell";
      cell.style.background = c;
      cell.title = c;
      cell.addEventListener("click", function (e) {
        e.stopPropagation();
        selectPickerColor(c);
      });
      grid.appendChild(cell);
    });
    el.appendChild(grid);

    var hexRow = document.createElement("div");
    hexRow.className = "fp-cp-hex-row";
    var hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "fp-cp-hex-input";
    hexInput.placeholder = "#rrggbb";
    hexInput.maxLength = 7;
    var applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply";
    applyBtn.className = "fp-cp-apply";
    applyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var val = hexInput.value.trim();
      if (val.charAt(0) !== "#") val = "#" + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        selectPickerColor(val.toLowerCase());
      } else {
        hexInput.style.outline = "2px solid red";
        setTimeout(function () { hexInput.style.outline = ""; }, 1200);
      }
    });
    hexInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") applyBtn.click();
    });
    hexInput.addEventListener("input", function () {
      hexInput.style.outline = "";
    });
    hexRow.appendChild(hexInput);
    hexRow.appendChild(applyBtn);
    el.appendChild(hexRow);

    document.body.appendChild(el);
    _picker = el;

    // Close on outside click (capture phase to beat stopPropagation on swatches)
    document.addEventListener("click", function (e) {
      if (!_picker || _picker.style.display === "none") return;
      if (!_picker.contains(e.target) && e.target !== _pickerAnchor) {
        closeColorPicker();
      }
    }, true);
  }

  function openColorPicker(anchorEl, currentColor, callback) {
    buildPicker();
    _pickerCallback = callback;
    _pickerAnchor = anchorEl;

    var hexInput = _picker.querySelector(".fp-cp-hex-input");
    hexInput.value = currentColor || "";
    hexInput.style.outline = "";

    _picker.style.display = "block";

    var rect = anchorEl.getBoundingClientRect();
    var pw = _picker.offsetWidth || 192;
    var ph = _picker.offsetHeight || 240;
    var top = rect.bottom + 4;
    var left = rect.left;

    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;

    _picker.style.left = left + "px";
    _picker.style.top = top + "px";
  }

  function closeColorPicker() {
    if (_picker) _picker.style.display = "none";
    _pickerAnchor = null;
    _pickerCallback = null;
  }

  function selectPickerColor(hex) {
    if (_pickerCallback) _pickerCallback(hex);
    closeColorPicker();
  }

  App.openColorPicker = openColorPicker;

  /* ---- Feature color update (called by per-feature swatches) ---- */

  App.updateFeatureColor = function (featureType, featureIndex, newColor) {
    if (featureType === "line") {
      App.lines[featureIndex].properties.color = newColor;
      var lrEl = document.getElementById("lineBufferRadius");
      var lr = lrEl ? parseFloat(lrEl.value) : 0.5; if (isNaN(lr)) lr = 0.5;
      App.rebuildLineBuffers(lr);
      App.renderLineLayers();
    } else if (featureType === "route") {
      App.routes[featureIndex].properties.color = newColor;
      var rrEl = document.getElementById("routeBufferRadius");
      var rr = rrEl ? parseFloat(rrEl.value) : 0.5; if (isNaN(rr)) rr = 0.5;
      App.rebuildRouteBuffers(rr);
      App.renderRouteLayers();
    } else if (featureType === "polygon") {
      App.polygons[featureIndex].properties.color = newColor;
      App.renderPolygonLayers();
    }
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
  };

  /* ---- Default color helper ---- */

  function getTypeDefaultColor(featureType) {
    var sc = App.sectionColors && App.sectionColors[featureType];
    if (sc) return sc;
    var defaults = { station: "#2b6cb0", line: "#e53e3e", route: "#319795", polygon: "#b0c4de" };
    return defaults[featureType] || "#999999";
  }

  /* ---- Natural sort helper ---- */

  function naturalSort(a, b) {
    var re = /(\d+)|(\D+)/g;
    var ap = String(a || "").match(re) || [];
    var bp = String(b || "").match(re) || [];
    for (var i = 0; i < Math.max(ap.length, bp.length); i++) {
      if (i >= ap.length) return -1;
      if (i >= bp.length) return 1;
      var aIsNum = /^\d+$/.test(ap[i]);
      var bIsNum = /^\d+$/.test(bp[i]);
      if (aIsNum && bIsNum) {
        var d = parseInt(ap[i], 10) - parseInt(bp[i], 10);
        if (d !== 0) return d;
      } else {
        var c = ap[i].toLowerCase().localeCompare(bp[i].toLowerCase());
        if (c !== 0) return c;
      }
    }
    return 0;
  }

  /* ---- Visibility helpers ---- */

  function rerenderForType(ft) {
    if (ft === "route") {
      var rrEl = document.getElementById("routeBufferRadius");
      var rr = rrEl ? parseFloat(rrEl.value) : 0.5; if (isNaN(rr)) rr = 0.5;
      if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(rr);
    } else if (ft === "line") {
      var lrEl = document.getElementById("lineBufferRadius");
      var lr = lrEl ? parseFloat(lrEl.value) : 0.5; if (isNaN(lr)) lr = 0.5;
      if (typeof App.rebuildLineBuffers === "function") App.rebuildLineBuffers(lr);
    } else if (ft === "station") {
      var srEl = document.getElementById("bufferRadius");
      var sr = srEl ? parseFloat(srEl.value) : 0.5; if (isNaN(sr)) sr = 0.5;
      if (typeof App.rebuildBuffers === "function") App.rebuildBuffers(sr);
    } else if (ft === "polygon") {
      if (typeof App.renderPolygonLayers === "function") App.renderPolygonLayers();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    }
  }

  /* ---- Feature panel item ---- */

  function buildItem(feature, featureType, featureIndex) {
    var div = document.createElement("div");
    div.className = "fp-item";
    div.dataset.featureType  = featureType;
    div.dataset.featureIndex = featureIndex;

    // Per-feature color swatch (not for stations)
    var swatch = null;
    if (featureType !== "station") {
      swatch = document.createElement("button");
      swatch.className = "fp-swatch fp-item-swatch";
      var _sectionColor = App.sectionColors && App.sectionColors[featureType];
      var _featureColor = feature.properties.color || getTypeDefaultColor(featureType);
      if (_sectionColor && _featureColor === _sectionColor) {
        swatch.classList.add("fp-swatch-neutral");
      } else {
        swatch.style.background = _featureColor;
      }
      swatch.title = "Change color";
      (function (sw, ft, fi) {
        sw.addEventListener("click", function (e) {
          e.stopPropagation();
          App.openColorPicker(sw, feature.properties.color, function (newColor) {
            feature.properties.color = newColor;
            sw.classList.remove("fp-swatch-neutral");
            sw.style.background = newColor;
            App.updateFeatureColor(ft, fi, newColor);
          });
        });
      })(swatch, featureType, featureIndex);
      div.appendChild(swatch);
    }

    var input = document.createElement("input");
    input.type = "text";
    input.className = "fp-name";
    input.value = feature.properties.name;

    // Save name on blur or Enter key; also sync to attribute panel name input
    input.addEventListener("change", function () {
      feature.properties.name = input.value;
      var wrapper = div.parentElement;
      if (wrapper) {
        var attrName = wrapper.querySelector(".fp-attr-panel .fp-attr-input");
        if (attrName && attrName.type === "text") attrName.value = input.value;
      }
      refreshFeaturePanel();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
    });

    // Visibility eye toggle
    var isHidden = !!feature.properties.hidden;
    if (isHidden) div.classList.add("fp-item-hidden");
    var eyeBtn = document.createElement("button");
    eyeBtn.className = "fp-visibility-btn" + (isHidden ? " fp-eye-off" : "");
    eyeBtn.title = isHidden ? "Show" : "Hide";
    eyeBtn.innerHTML = isHidden ? EYE_OFF_SVG : EYE_SVG;
    (function (btn, feat, ft) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        feat.properties.hidden = !feat.properties.hidden;
        if (App.cache && typeof App.cache.save === "function") App.cache.save();
        rerenderForType(ft);
      });
    })(eyeBtn, feature, featureType);

    // Expand toggle button (replaces the old delete button)
    var expandBtn = document.createElement("button");
    expandBtn.className = "fp-expand";
    expandBtn.title = "Edit attributes";
    expandBtn.innerHTML = CHEVRON_SVG;

    // Hover and click wiring
    div.addEventListener("mouseenter", function () {
      if (typeof App.setHoveredFeature === "function") App.setHoveredFeature(featureType, featureIndex);
    });
    div.addEventListener("mouseleave", function () {
      if (typeof App.clearHover === "function") App.clearHover();
    });
    div.addEventListener("click", function (e) {
      if (e.target === input || input.contains(e.target)) return;
      if (swatch && (e.target === swatch || swatch.contains(e.target))) return;
      if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
      if (typeof App.toggleAttrPanel === "function") App.toggleAttrPanel(div);
    });

    div.appendChild(input);
    div.appendChild(eyeBtn);
    div.appendChild(expandBtn);
    return div;
  }

  /* ---- Section-level color swatches ---- */

  var _sectionSwatchesBuilt = false;

  function getSectionSwatchColor(type) {
    return (App.sectionColors && App.sectionColors[type]) || null;
  }

  function applySectionColor(type, newColor, swatchEl) {
    if (!App.sectionColors) App.sectionColors = {};
    App.sectionColors[type] = newColor;
    swatchEl.classList.remove("fp-swatch-neutral");
    swatchEl.style.background = newColor;

    if (type === "station") {
      // Stations are always a uniform color — update immediately, no confirm needed
      if (typeof App.renderStationLayers === "function") App.renderStationLayers();
      if (App.cache && typeof App.cache.save === "function") App.cache.save();
      return;
    }

    var featArrayMap = { line: App.lines, route: App.routes, polygon: App.polygons };
    var featArray = featArrayMap[type] || [];

    if (featArray.length > 0) {
      var label = type + "s";
      var doOverride = confirm(
        "Apply this color to all existing " + label + " too?\n" +
        "(OK = override all existing, Cancel = use for new features only)"
      );
      if (doOverride) {
        featArray.forEach(function (f) { f.properties.color = newColor; });
        if (type === "line") {
          var lrEl2 = document.getElementById("lineBufferRadius");
          var lr = lrEl2 ? parseFloat(lrEl2.value) : 0.5; if (isNaN(lr)) lr = 0.5;
          App.rebuildLineBuffers(lr);
          App.renderLineLayers();
        } else if (type === "route") {
          var rrEl2 = document.getElementById("routeBufferRadius");
          var rr = rrEl2 ? parseFloat(rrEl2.value) : 0.5; if (isNaN(rr)) rr = 0.5;
          App.rebuildRouteBuffers(rr);
          App.renderRouteLayers();
        } else if (type === "polygon") {
          App.renderPolygonLayers();
        }
      }
      refreshFeaturePanel(); // always update per-item swatch appearance
    }

    if (App.cache && typeof App.cache.save === "function") App.cache.save();
  }

  function buildSectionSwatches() {
    if (_sectionSwatchesBuilt) return;
    _sectionSwatchesBuilt = true;

    var HEADER_MAP = [
      { text: "Stations", type: "station" },
      { text: "Lines",    type: "line"    },
      { text: "Routes",   type: "route"   },
      { text: "Polygons", type: "polygon" }
    ];

    document.querySelectorAll(".fp-section-header").forEach(function (header) {
      var headerText = header.textContent.trim();
      var match = null;
      for (var i = 0; i < HEADER_MAP.length; i++) {
        if (headerText === HEADER_MAP[i].text) { match = HEADER_MAP[i]; break; }
      }
      if (!match) return;

      var type = match.type;
      var sw = document.createElement("button");
      sw.className = "fp-swatch fp-section-swatch";
      var initColor = getSectionSwatchColor(type);
      if (initColor) {
        sw.style.background = initColor;
      } else {
        sw.classList.add("fp-swatch-neutral");
      }
      sw.title = "Set color for all " + match.text.toLowerCase();

      (function (swEl, t) {
        swEl.addEventListener("click", function (e) {
          e.stopPropagation();
          App.openColorPicker(swEl, getSectionSwatchColor(t) || "", function (newColor) {
            applySectionColor(t, newColor, swEl);
          });
        });
      })(sw, type);

      header.insertBefore(sw, header.firstChild);
    });
  }

  /* ---- Route grouping list ---- */

  function populateRouteList(containerId, features, removeFn) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    if (!features.length) return;

    // Collect groups and ungrouped indices
    var groups = {};      // groupName → [routeIndex, ...]
    var ungrouped = [];   // [routeIndex, ...]
    for (var i = 0; i < features.length; i++) {
      var a = features[i].properties.attributes;
      var g = a && a.routeGroup;
      if (g) {
        if (!groups[g]) groups[g] = [];
        groups[g].push(i);
      } else {
        ungrouped.push(i);
      }
    }

    var groupNames = Object.keys(groups);

    // No groups → fall back to flat list
    if (groupNames.length === 0) {
      populateList(containerId, features, removeFn, "route");
      return;
    }

    groupNames.sort(naturalSort);

    groupNames.forEach(function (gn) {
      groups[gn].sort(function (a, b) {
        var aa = features[a].properties.attributes || {};
        var ab = features[b].properties.attributes || {};
        var da = aa.direction || "";
        var db = ab.direction || "";
        if (da !== db) return naturalSort(da, db);
        return naturalSort(features[a].properties.name, features[b].properties.name);
      });
    });

    ungrouped.sort(function (a, b) {
      return naturalSort(features[a].properties.name, features[b].properties.name);
    });

    // Helper: build an indented pattern wrapper
    function buildPatternWrapper(i) {
      var wrapper = document.createElement("div");
      wrapper.className = "fp-item-wrapper fp-pattern";
      var onDelete = (function (idx) {
        return function () {
          removeFn(idx);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
        };
      })(i);
      wrapper.appendChild(buildItem(features[i], "route", i));
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel("route", i, features[i], onDelete));
      }
      return wrapper;
    }

    // Render groups
    groupNames.forEach(function (groupName) {
      var idxs = groups[groupName];
      var groupDiv = document.createElement("div");
      groupDiv.className = "fp-group";

      // Header
      var header = document.createElement("div");
      header.className = "fp-group-header";

      var toggle = document.createElement("button");
      toggle.className = "fp-group-toggle open";
      toggle.innerHTML = CHEVRON_SVG;
      header.appendChild(toggle);

      // Color swatch — clicking applies color to all patterns in the group
      var firstColor = features[idxs[0]].properties.color || getTypeDefaultColor("route");
      var sw = document.createElement("button");
      sw.className = "fp-swatch fp-item-swatch";
      sw.style.background = firstColor;
      sw.title = "Change color for all patterns";
      (function (swatch, indices, feats) {
        swatch.addEventListener("click", function (e) {
          e.stopPropagation();
          var curColor = feats[indices[0]].properties.color || getTypeDefaultColor("route");
          App.openColorPicker(swatch, curColor, function (newColor) {
            swatch.style.background = newColor;
            indices.forEach(function (idx) { feats[idx].properties.color = newColor; });
            var rr = parseFloat((document.getElementById("routeBufferRadius") || {}).value) || 0.5;
            App.rebuildRouteBuffers(rr);
            App.renderRouteLayers();
            if (App.cache && typeof App.cache.save === "function") App.cache.save();
          });
        });
      })(sw, idxs, features);
      header.appendChild(sw);

      var nameSpan = document.createElement("span");
      nameSpan.className = "fp-group-name";
      nameSpan.textContent = groupName;
      header.appendChild(nameSpan);

      var countSpan = document.createElement("span");
      countSpan.className = "fp-group-count";
      countSpan.textContent = idxs.length + (idxs.length === 1 ? " pattern" : " patterns");
      header.appendChild(countSpan);

      // Group-level visibility eye
      var allHidden = idxs.every(function (idx) { return !!features[idx].properties.hidden; });
      var groupEye = document.createElement("button");
      groupEye.className = "fp-visibility-btn" + (allHidden ? " fp-eye-off" : "");
      groupEye.innerHTML = allHidden ? EYE_OFF_SVG : EYE_SVG;
      groupEye.title = allHidden ? "Show all patterns" : "Hide all patterns";
      (function (btn, indices, feats) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var hideAll = !indices.every(function (i) { return !!feats[i].properties.hidden; });
          indices.forEach(function (i) {
            if (hideAll) { feats[i].properties.hidden = true; }
            else { delete feats[i].properties.hidden; }
          });
          if (App.cache && typeof App.cache.save === "function") App.cache.save();
          var rr = parseFloat((document.getElementById("routeBufferRadius") || {}).value) || 0.5;
          if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(rr);
        });
      })(groupEye, idxs, features);
      header.appendChild(groupEye);

      groupDiv.appendChild(header);

      // Body (collapsible)
      var body = document.createElement("div");
      body.className = "fp-group-body";
      idxs.forEach(function (i) { body.appendChild(buildPatternWrapper(i)); });
      groupDiv.appendChild(body);

      // Restore collapsed state across panel rebuilds
      if (_collapsedGroups[groupName]) {
        body.style.display = "none";
        toggle.classList.remove("open");
      }

      // Toggle expand/collapse
      function toggleGroup(e) {
        if (sw && (e.target === sw || sw.contains(e.target))) return;
        e.stopPropagation();
        var isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "";
        toggle.classList.toggle("open", !isOpen);
        if (isOpen) { _collapsedGroups[groupName] = true; }
        else { delete _collapsedGroups[groupName]; }
      }
      toggle.addEventListener("click", toggleGroup);
      header.addEventListener("click", toggleGroup);

      el.appendChild(groupDiv);
    });

    // Render ungrouped routes as flat items
    ungrouped.forEach(function (i) {
      var wrapper = document.createElement("div");
      wrapper.className = "fp-item-wrapper";
      var onDelete = (function (idx) {
        return function () {
          removeFn(idx);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
        };
      })(i);
      wrapper.appendChild(buildItem(features[i], "route", i));
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel("route", i, features[i], onDelete));
      }
      el.appendChild(wrapper);
    });
  }

  /* ---- List population ---- */

  function populateList(containerId, features, removeFn, featureType) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    var sortedIndices = features.map(function (_, i) { return i; });
    sortedIndices.sort(function (a, b) {
      return naturalSort(features[a].properties.name, features[b].properties.name);
    });
    sortedIndices.forEach(function (i) {
      var wrapper = document.createElement("div");
      wrapper.className = "fp-item-wrapper";
      var onDelete = (function (idx) {
        return function () {
          removeFn(idx);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
        };
      })(i);
      var itemEl = buildItem(features[i], featureType, i);
      wrapper.appendChild(itemEl);
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel(featureType, i, features[i], onDelete));
      }
      el.appendChild(wrapper);
    });
  }

  function refreshFeaturePanel() {
    buildSectionSwatches(); // no-op after first call
    populateList("fp-stations", App.stations || [], App.removeStation || function () {}, "station");
    populateList("fp-lines",    App.lines    || [], App.removeLine    || function () {}, "line");
    populateRouteList("fp-routes", App.routes || [], App.removeRoute || function () {});
    populateList("fp-polygons", App.polygons || [], App.removePolygon || function () {}, "polygon");
    if (typeof App.applyPanelHighlight === "function") App.applyPanelHighlight();
  }

  App.refreshFeaturePanel = refreshFeaturePanel;

  // Wire feature panel collapse toggle
  (function () {
    var btn = document.getElementById('fp-collapse-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var panel = document.getElementById('feature-panel');
      var collapsed = panel.classList.toggle('fp-collapsed');
      btn.title = collapsed ? 'Show panel' : 'Hide panel';
      btn.setAttribute('aria-label', collapsed ? 'Show feature panel' : 'Hide feature panel');
    });
  })();
})();
