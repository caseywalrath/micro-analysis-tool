// js/core/features.js
// Right-side feature panel: lists all stations, lines, routes, polygons
// with editable names, per-item color swatches, and per-item delete buttons.
// Depends on: App.stations (stations.js), App.lines (lines.js),
//             App.polygons (polygons.js).
// Exports: refreshFeaturePanel, openColorPicker, updateFeatureColor

(function () {
  var App = window.App = window.App || {};

  var TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
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
      var lr = parseFloat((document.getElementById("lineBufferRadius") || {}).value) || 0.5;
      App.rebuildLineBuffers(lr);
      App.renderLineLayers();
    } else if (featureType === "route") {
      App.routes[featureIndex].properties.color = newColor;
      var rr = parseFloat((document.getElementById("routeBufferRadius") || {}).value) || 0.5;
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

  /* ---- Feature panel item ---- */

  function buildItem(feature, onDelete, featureType, featureIndex) {
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

    // Save name on blur or Enter key
    input.addEventListener("change", function () {
      feature.properties.name = input.value;
      refreshFeaturePanel();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
    });

    var delBtn = document.createElement("button");
    delBtn.className = "fp-delete";
    delBtn.title = "Delete";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", onDelete);

    // Hover and click wiring for bidirectional map highlighting
    div.addEventListener("mouseenter", function () {
      if (typeof App.setHoveredFeature === "function") App.setHoveredFeature(featureType, featureIndex);
    });
    div.addEventListener("mouseleave", function () {
      if (typeof App.clearHover === "function") App.clearHover();
    });
    div.addEventListener("click", function (e) {
      if (e.target === input || e.target === delBtn || delBtn.contains(e.target)) return;
      if (swatch && e.target === swatch) return;
      if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
    });

    div.appendChild(input);
    div.appendChild(delBtn);
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
          var lr = parseFloat((document.getElementById("lineBufferRadius") || {}).value) || 0.5;
          App.rebuildLineBuffers(lr);
          App.renderLineLayers();
        } else if (type === "route") {
          var rr = parseFloat((document.getElementById("routeBufferRadius") || {}).value) || 0.5;
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
      el.appendChild(buildItem(features[i], function () {
        removeFn(i);
        if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
      }, featureType, i));
    });
  }

  function refreshFeaturePanel() {
    buildSectionSwatches(); // no-op after first call
    populateList("fp-stations", App.stations || [], App.removeStation || function () {}, "station");
    populateList("fp-lines",    App.lines    || [], App.removeLine    || function () {}, "line");
    populateList("fp-routes",   App.routes   || [], App.removeRoute   || function () {}, "route");
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
