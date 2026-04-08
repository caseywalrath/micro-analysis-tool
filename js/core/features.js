// js/core/features.js
// Right-side feature panel: lists all points, lines, routes, polygons
// with editable names, per-item color swatches, and per-item delete buttons.
// Depends on: App.points (points.js), App.lines (lines.js),
//             App.polygons (polygons.js).
// Exports: refreshFeaturePanel, openColorPicker, updateFeatureColor

(function () {
  var App = window.App = window.App || {};

  // Tracks which route groups the user has manually collapsed.
  // Persists across refreshFeaturePanel() calls (survives DOM rebuilds).
  var _expandedGroups = {};

  // Tracks which feature-type sections the user has collapsed this session.
  // Default is expanded; only collapsed sections are stored.
  var _collapsedSections = {};

  // Universal group key for cross-type grouping (labels keep their own key)
  var UNIVERSAL_GROUP_KEY = "group";
  var LABEL_GROUP_KEY = "labelGroup";

  var TYPE_LABELS_LOCAL = {
    point: "Point", line: "Line",
    route: "Route", polygon: "Polygon", label: "Label"
  };

  var CHEVRON_SVG = '&#9662;';

  // Dark grey type icon SVGs matching toolbar draw icons
  var TYPE_ICON_SVGS = {
    point: '<svg width="11" height="11" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="#718096"/></svg>',
    line:    '<svg width="11" height="11" viewBox="0 0 24 24"><line x1="4" y1="19" x2="20" y2="5" stroke="#718096" stroke-width="3.5" stroke-linecap="round"/></svg>',
    route:   '<svg width="11" height="11" viewBox="0 0 24 24"><path d="M4 18 Q8 6 14 10 Q20 14 20 6" stroke="#718096" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="4" cy="18" r="2.5" fill="#718096"/></svg>',
    polygon: '<svg width="11" height="11" viewBox="0 0 24 24"><polygon points="12,4 21,10 18,20 6,20 3,10" fill="#718096"/></svg>',
    label:   '<svg width="11" height="11" viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-4 4z" fill="#718096"/></svg>'
  };

  var GEAR_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06' +
    'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4' +
    'a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15' +
    'a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82' +
    'l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3' +
    'a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83' +
    'l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09' +
    'a1.65 1.65 0 0 0-1.51 1z"/>' +
    '</svg>';

  var COPY_SVG =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
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

  var TRASH_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
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
    if (App.undo && !App.undo.isRestoring()) App.undo.push();
    if (featureType === "point") {
      if (App.points[featureIndex]) App.points[featureIndex].properties.color = newColor;
      if (typeof App.renderPointLayers === "function") App.renderPointLayers();
    } else if (featureType === "line") {
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
    } else if (featureType === "label") {
      App.labels[featureIndex].properties.color = newColor;
      App.labels[featureIndex].properties.bgColor = newColor;
      if (App.labels[featureIndex].properties.attributes) {
        App.labels[featureIndex].properties.attributes.bgColor = newColor;
      }
      if (typeof App.updateLabelAppearance === "function") App.updateLabelAppearance(featureIndex);
    }
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
  };

  /* ---- Default color helper ---- */

  function getTypeDefaultColor(featureType) {
    var sc = App.sectionColors && App.sectionColors[featureType];
    if (sc) return sc;
    var defaults = { point: "#2b6cb0", line: "#e53e3e", route: "#319795", polygon: "#b0c4de", label: "#1a202c" };
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
    } else if (ft === "point") {
      var srEl = document.getElementById("bufferRadius");
      var sr = srEl ? parseFloat(srEl.value) : 0.5; if (isNaN(sr)) sr = 0.5;
      if (typeof App.rebuildBuffers === "function") App.rebuildBuffers(sr);
    } else if (ft === "polygon") {
      if (typeof App.renderPolygonLayers === "function") App.renderPolygonLayers();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    } else if (ft === "label") {
      if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();
    }
  }

  /* ---- Context menu ---- */

  var _ctxMenu = null;

  function showContextMenu(x, y, options) {
    if (_ctxMenu) _ctxMenu.remove();
    var menu = document.createElement("div");
    menu.id = "fp-context-menu";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.textContent = opt.label;
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        menu.remove();
        _ctxMenu = null;
        opt.action();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    _ctxMenu = menu;
    var mw = menu.offsetWidth || 160;
    var mh = menu.offsetHeight || 80;
    var left = Math.min(x, window.innerWidth  - mw - 8);
    var top  = Math.min(y, window.innerHeight - mh - 8);
    menu.style.left = Math.max(4, left) + "px";
    menu.style.top  = Math.max(4, top)  + "px";
    setTimeout(function () {
      document.addEventListener("click", function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); _ctxMenu = null; }
        document.removeEventListener("click", close);
      });
    }, 0);
  }

  /* ---- Group / ungroup helpers ---- */

  function getFeatureByTypeIndex(type, index) {
    var map = { point: "points", line: "lines", route: "routes", polygon: "polygons", label: "labels" };
    var arr = App[map[type]];
    return arr ? arr[index] : null;
  }

  function goToFeature(featureType, featureIndex) {
    var feature = getFeatureByTypeIndex(featureType, featureIndex);
    if (!feature || !feature.geometry) return;
    var geom = feature.geometry;
    if (geom.type === "Point") {
      App.map.flyTo({ center: geom.coordinates, zoom: Math.max(App.map.getZoom(), 14), duration: 500 });
    } else {
      var bbox = turf.bbox(feature);
      App.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, duration: 500 });
    }
  }

  function generateGroupName(isLabel) {
    var key = isLabel ? LABEL_GROUP_KEY : UNIVERSAL_GROUP_KEY;
    var prefix = isLabel ? "Label Group " : "Group ";
    var existing = {};
    var allArrays = isLabel ? [App.labels || []] :
      [App.points || [], App.lines || [], App.routes || [], App.polygons || []];
    allArrays.forEach(function (arr) {
      arr.forEach(function (f) {
        var g = f.properties.attributes && f.properties.attributes[key];
        if (g) existing[g] = true;
      });
    });
    var n = 1;
    while (existing[prefix + n]) n++;
    return prefix + n;
  }

  function groupSelectedFeatures() {
    var selected = typeof App.getSelectedFeatures === "function" ? App.getSelectedFeatures() : [];
    if (selected.length < 2) return;
    // Determine if all are labels (use label group key) or mixed/non-label (use universal key)
    var allLabels = selected.every(function (s) { return s.type === "label"; });
    var key = allLabels ? LABEL_GROUP_KEY : UNIVERSAL_GROUP_KEY;
    var name = generateGroupName(allLabels);
    // Inherit color from the first feature that has a color
    var inheritColor = null;
    for (var i = 0; i < selected.length; i++) {
      var cf = getFeatureByTypeIndex(selected[i].type, selected[i].index);
      if (cf && cf.properties.color) { inheritColor = cf.properties.color; break; }
    }
    selected.forEach(function (s) {
      var feat = getFeatureByTypeIndex(s.type, s.index);
      if (!feat) return;
      if (!feat.properties.attributes) feat.properties.attributes = {};
      feat.properties.attributes[key] = name;
      if (inheritColor) feat.properties.color = inheritColor;
    });
    // Re-render affected types
    var typesChanged = {};
    selected.forEach(function (s) { typesChanged[s.type] = true; });
    Object.keys(typesChanged).forEach(function (t) { rerenderForType(t); });
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function ungroupSelectedFeatures() {
    var selected = typeof App.getSelectedFeatures === "function" ? App.getSelectedFeatures() : [];
    selected.forEach(function (s) {
      var feat = getFeatureByTypeIndex(s.type, s.index);
      if (!feat || !feat.properties.attributes) return;
      // Clear universal group key (and legacy label key)
      delete feat.properties.attributes[UNIVERSAL_GROUP_KEY];
      if (s.type === "label") delete feat.properties.attributes[LABEL_GROUP_KEY];
    });
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  /* ---- Feature panel item ---- */

  function buildItem(feature, featureType, featureIndex, onDelete) {
    var div = document.createElement("div");
    div.className = "fp-item";
    div.dataset.featureType  = featureType;
    div.dataset.featureIndex = featureIndex;

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

    // Type icon (non-interactive, replaces old color swatch)
    var typeIcon = document.createElement("span");
    typeIcon.className = "fp-type-icon";
    typeIcon.innerHTML = TYPE_ICON_SVGS[featureType] || "";
    typeIcon.title = TYPE_LABELS_LOCAL[featureType] || featureType;

    var input = document.createElement("span");
    input.className = "fp-name";
    input.textContent = feature.properties.name || "";

    // Duplicate button (labels only)
    var dupBtn = null;
    if (featureType === "label") {
      dupBtn = document.createElement("button");
      dupBtn.className = "fp-dup-btn";
      dupBtn.title = "Duplicate label";
      dupBtn.innerHTML = COPY_SVG;
      (function (fi) {
        dupBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (typeof App.duplicateLabel === "function") App.duplicateLabel(fi);
        });
      })(featureIndex);
    }

    // Gear/attributes button
    var gearBtn = document.createElement("button");
    gearBtn.className = "fp-gear-btn";
    gearBtn.title = "Edit attributes";
    gearBtn.innerHTML = GEAR_SVG;
    (function (ft, fi, feat) {
      gearBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof App.openAttrPopup === "function") App.openAttrPopup(ft, fi, feat);
      });
    })(featureType, featureIndex, feature);

    var trashBtn = document.createElement("button");
    trashBtn.className = "fp-del-btn";
    trashBtn.title = "Delete feature";
    trashBtn.innerHTML = TRASH_SVG;
    trashBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      onDelete();
    });

    // Hover and click wiring
    div.addEventListener("mouseenter", function () {
      if (typeof App.setHoveredFeature === "function") App.setHoveredFeature(featureType, featureIndex);
    });
    div.addEventListener("mouseleave", function () {
      if (typeof App.clearHover === "function") App.clearHover();
    });
    div.addEventListener("click", function (e) {
      if (e.ctrlKey || e.metaKey) {
        if (typeof App.toggleMultiSelect === "function") App.toggleMultiSelect(featureType, featureIndex);
      } else {
        if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
      }
    });

    div.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // If this item isn't in the current selection, single-select it first
      if (typeof App.isFeatureSelected === "function" && !App.isFeatureSelected(featureType, featureIndex)) {
        if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
      }
      var selected = typeof App.getSelectedFeatures === "function" ? App.getSelectedFeatures() : [];
      if (!selected.length) return;
      var options = [];
      // Single-select: offer Attributes
      if (selected.length === 1 && selected[0].type === featureType && selected[0].index === featureIndex) {
        (function (ft, fi, feat) {
          options.push({ label: "Go To Feature", action: function () { goToFeature(ft, fi); } });
          options.push({ label: "Attributes", action: function () {
            if (typeof App.openAttrPopup === "function") App.openAttrPopup(ft, fi, feat);
          }});
          var dupFn = { point: App.duplicatePoint, line: App.duplicateLine,
                        route: App.duplicateRoute, polygon: App.duplicatePolygon,
                        label: App.duplicateLabel }[ft];
          if (typeof dupFn === "function") {
            options.push({ label: "Duplicate", action: function () { dupFn(fi); } });
          }
          options.push({ label: feat.properties.hidden ? "Show" : "Hide", action: function () {
            feat.properties.hidden = !feat.properties.hidden;
            if (App.cache && typeof App.cache.save === "function") App.cache.save();
            if (typeof App.rerenderForType === "function") App.rerenderForType(ft);
            if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
          }});
          options.push({ label: "Delete", action: function () { onDelete(); } });
        })(featureType, featureIndex, feature);
      }
      if (selected.length >= 2) {
        options.push({ label: "Group", action: groupSelectedFeatures });
      }
      var anyInGroup = selected.some(function (s) {
        var feat = getFeatureByTypeIndex(s.type, s.index);
        if (!feat || !feat.properties.attributes) return false;
        return feat.properties.attributes[UNIVERSAL_GROUP_KEY] ||
               (s.type === "label" && feat.properties.attributes[LABEL_GROUP_KEY]);
      });
      if (anyInGroup) {
        options.push({ label: "Ungroup", action: ungroupSelectedFeatures });
      }
      if (options.length) showContextMenu(e.clientX, e.clientY, options);
    });

    // DOM order: [eye] [type-icon] [name] [dup?] [gear] [trash]
    div.appendChild(eyeBtn);
    div.appendChild(typeIcon);
    div.appendChild(input);
    if (dupBtn) div.appendChild(dupBtn);
    div.appendChild(gearBtn);
    div.appendChild(trashBtn);
    return div;
  }

  /* ---- Section-level color swatches (Labels section only) ---- */

  var _labelSwatchBuilt = false;

  function buildLabelSectionSwatch() {
    if (_labelSwatchBuilt) return;
    _labelSwatchBuilt = true;

    var headers = document.querySelectorAll(".fp-section-header");
    for (var i = 0; i < headers.length; i++) {
      if (headers[i].textContent.trim() !== "Labels") continue;
      var header = headers[i];

      var sw = document.createElement("button");
      sw.className = "fp-swatch fp-section-swatch";
      var initColor = (App.sectionColors && App.sectionColors.label) || null;
      if (initColor) { sw.style.background = initColor; }
      else { sw.classList.add("fp-swatch-neutral"); }
      sw.title = "Set color for all labels";
      sw.addEventListener("click", function (e) {
        e.stopPropagation();
        App.openColorPicker(sw, (App.sectionColors && App.sectionColors.label) || "", function (newColor) {
          if (!App.sectionColors) App.sectionColors = {};
          App.sectionColors.label = newColor;
          sw.classList.remove("fp-swatch-neutral");
          sw.style.background = newColor;
          var labels = App.labels || [];
          if (labels.length > 0) {
            var doOverride = confirm("Apply this color to all existing labels too?\n(OK = override all, Cancel = new only)");
            if (doOverride) {
              labels.forEach(function (f) { f.properties.color = newColor; f.properties.bgColor = newColor; });
              if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();
            }
            refreshFeaturePanel();
          }
          if (App.cache && typeof App.cache.save === "function") App.cache.save();
        });
      });
      header.insertBefore(sw, header.firstChild);

      // Collapse toggle for Labels section
      var stog = document.createElement("button");
      stog.className = "fp-section-toggle open";
      stog.innerHTML = CHEVRON_SVG;
      stog.title = "Collapse Labels";
      header.appendChild(stog);

      (function (hdr, tog, swBtn) {
        function toggleSection(e) {
          if (e.target === swBtn || swBtn.contains(e.target)) return;
          e.stopPropagation();
          var listEl = document.getElementById("fp-labels");
          var isOpen = !_collapsedSections.label;
          if (isOpen) {
            _collapsedSections.label = true;
            if (listEl) listEl.style.display = "none";
            tog.classList.remove("open");
          } else {
            delete _collapsedSections.label;
            if (listEl) listEl.style.display = "";
            tog.classList.add("open");
          }
        }
        tog.addEventListener("click", toggleSection);
        hdr.addEventListener("click", toggleSection);
      })(header, stog, sw);
      break;
    }
  }

  /* ---- Shared group header builder (supports mixed-type groups) ---- */

  // items: array of { feature, type, index }
  // groupKey: UNIVERSAL_GROUP_KEY or LABEL_GROUP_KEY
  function buildMixedGroupHeader(groupName, items, groupKey) {
    var header = document.createElement("div");
    header.className = "fp-group-header";

    var toggle = document.createElement("button");
    toggle.className = "fp-group-toggle";
    toggle.innerHTML = CHEVRON_SVG;
    header.appendChild(toggle);

    // Group-level visibility eye
    var allHidden = items.every(function (it) { return !!it.feature.properties.hidden; });
    var groupEye = document.createElement("button");
    groupEye.className = "fp-visibility-btn" + (allHidden ? " fp-eye-off" : "");
    groupEye.innerHTML = allHidden ? EYE_OFF_SVG : EYE_SVG;
    groupEye.title = allHidden ? "Show all" : "Hide all";
    groupEye.addEventListener("click", function (e) {
      e.stopPropagation();
      var hideAll = !items.every(function (it) { return !!it.feature.properties.hidden; });
      var typesChanged = {};
      items.forEach(function (it) {
        if (hideAll) { it.feature.properties.hidden = true; }
        else { delete it.feature.properties.hidden; }
        typesChanged[it.type] = true;
      });
      if (App.cache && typeof App.cache.save === "function") App.cache.save();
      Object.keys(typesChanged).forEach(function (t) { rerenderForType(t); });
    });
    header.appendChild(groupEye);

    // Color swatch — applies color to all features in the group
    var firstColor = items[0].feature.properties.color || getTypeDefaultColor(items[0].type);
    header.style.borderLeftColor = firstColor;
    var sw = document.createElement("button");
    sw.className = "fp-swatch fp-item-swatch";
    sw.style.background = firstColor;
    sw.title = "Change color for all in group";
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      var curColor = items[0].feature.properties.color || getTypeDefaultColor(items[0].type);
      App.openColorPicker(sw, curColor, function (newColor) {
        sw.style.background = newColor;
        header.style.borderLeftColor = newColor;
        var typesChanged = {};
        items.forEach(function (it) {
          it.feature.properties.color = newColor;
          typesChanged[it.type] = true;
        });
        // Labels also need bgColor synced
        items.forEach(function (it) {
          if (it.type === "label") it.feature.properties.bgColor = newColor;
        });
        Object.keys(typesChanged).forEach(function (t) { rerenderForType(t); });
        if (App.cache && typeof App.cache.save === "function") App.cache.save();
      });
    });
    header.appendChild(sw);

    var nameSpan = document.createElement("span");
    nameSpan.className = "fp-group-name";
    nameSpan.textContent = groupName;
    nameSpan.title = "Double-click to rename";
    nameSpan.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "fp-group-name-edit";
      inp.value = nameSpan.textContent;
      nameSpan.style.display = "none";
      header.insertBefore(inp, nameSpan.nextSibling);
      inp.focus();
      inp.select();
      function save() {
        var newName = inp.value.trim();
        inp.remove();
        nameSpan.style.display = "";
        if (newName && newName !== nameSpan.textContent) {
          items.forEach(function (it) {
            if (!it.feature.properties.attributes) it.feature.properties.attributes = {};
            it.feature.properties.attributes[groupKey] = newName;
          });
          if (App.cache && typeof App.cache.save === "function") App.cache.save();
          if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
        }
      }
      inp.addEventListener("blur", save);
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") inp.blur();
        if (ev.key === "Escape") { inp.value = nameSpan.textContent; inp.blur(); }
      });
    });
    header.appendChild(nameSpan);

    // Group delete button
    var groupTrashBtn = document.createElement("button");
    groupTrashBtn.className = "fp-del-btn";
    groupTrashBtn.title = "Delete all features in group";
    groupTrashBtn.innerHTML = TRASH_SVG;
    groupTrashBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var groupDiv = header.parentElement;
      if (!groupDiv) return;
      var existing = groupDiv.querySelector(".fp-group-delete-confirm");
      if (existing) { existing.style.display = ""; return; }
      var confirmDiv = document.createElement("div");
      confirmDiv.className = "fp-delete-confirm fp-group-delete-confirm";
      var text = document.createElement("span");
      text.textContent = "Delete all " + items.length + " feature(s) in group?";
      var yesBtn = document.createElement("button");
      yesBtn.className = "fp-attr-confirm-yes";
      yesBtn.textContent = "Delete";
      yesBtn.addEventListener("click", function (e2) {
        e2.stopPropagation();
        // Sort by type then descending index to avoid index shifting issues
        var byType = {};
        items.forEach(function (it) {
          if (!byType[it.type]) byType[it.type] = [];
          byType[it.type].push(it.index);
        });
        Object.keys(byType).forEach(function (t) {
          var sorted = byType[t].sort(function (a, b) { return b - a; });
          var fn = getRemoveFnForType(t);
          sorted.forEach(function (idx) { if (fn) fn(idx); });
        });
        if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
      });
      var noBtn = document.createElement("button");
      noBtn.className = "fp-attr-confirm-no";
      noBtn.textContent = "Cancel";
      noBtn.addEventListener("click", function (e2) {
        e2.stopPropagation();
        confirmDiv.style.display = "none";
      });
      confirmDiv.appendChild(text);
      confirmDiv.appendChild(yesBtn);
      confirmDiv.appendChild(noBtn);
      var body = groupDiv.querySelector(".fp-group-body");
      groupDiv.insertBefore(confirmDiv, body || null);
    });
    header.appendChild(groupTrashBtn);

    return header;
  }

  function getRemoveFnForType(type) {
    var map = {
      point: App.removePoint,
      line:    App.removeLine,
      route:   App.removeRoute,
      polygon: App.removePolygon,
      label:   App.removeLabel
    };
    return map[type] || function () {};
  }

  /* ---- Collect all non-label features into unified list ---- */

  function collectAllFeatures() {
    var all = [];
    (App.points || []).forEach(function (f, i) { all.push({ feature: f, type: "point", index: i }); });
    (App.lines    || []).forEach(function (f, i) { all.push({ feature: f, type: "line",    index: i }); });
    (App.routes   || []).forEach(function (f, i) { all.push({ feature: f, type: "route",   index: i }); });
    (App.polygons || []).forEach(function (f, i) { all.push({ feature: f, type: "polygon", index: i }); });
    return all;
  }

  function featureSortKey(item) {
    var name = item.feature.properties.name || "";
    // Empty names sort to end
    return name ? name : "\uffff" + item.type + item.index;
  }

  function sortItems(arr) {
    arr.sort(function (a, b) {
      return naturalSort(featureSortKey(a), featureSortKey(b));
    });
  }

  /* ---- Build item wrapper with delete wiring ---- */

  function buildItemWrapperUnified(item, inGroup) {
    var wrapper = document.createElement("div");
    wrapper.className = "fp-item-wrapper" + (inGroup ? " fp-pattern" : "");
    var onDelete = (function (ft, idx) {
      return function () {
        if (typeof App.isAttrPopupOpen === "function" && App.isAttrPopupOpen()) {
          var pf = typeof App.getAttrPopupFeature === "function" ? App.getAttrPopupFeature() : null;
          if (pf && pf.featureType === ft && pf.featureIndex === idx) App.closeAttrPopup();
        }
        var fn = getRemoveFnForType(ft);
        if (fn) fn(idx);
        if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
      };
    })(item.type, item.index);
    wrapper.appendChild(buildItem(item.feature, item.type, item.index, onDelete));
    return wrapper;
  }

  /* ---- Unified feature list rendering ---- */

  function populateUnifiedList() {
    var el = document.getElementById("fp-features");
    if (!el) return;
    el.innerHTML = "";

    var all = collectAllFeatures();
    if (!all.length) return;

    // Separate into groups and ungrouped
    var groups = {};
    var ungrouped = [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i].feature.properties.attributes;
      var g = a && a[UNIVERSAL_GROUP_KEY];
      if (g) {
        if (!groups[g]) groups[g] = [];
        groups[g].push(all[i]);
      } else {
        ungrouped.push(all[i]);
      }
    }

    var groupNames = Object.keys(groups);
    groupNames.sort(naturalSort);

    // Sort items within each group and ungrouped alphabetically
    groupNames.forEach(function (gn) { sortItems(groups[gn]); });
    sortItems(ungrouped);

    // Render groups
    groupNames.forEach(function (groupName) {
      var items = groups[groupName];
      var groupDiv = document.createElement("div");
      groupDiv.className = "fp-group";

      var header = buildMixedGroupHeader(groupName, items, UNIVERSAL_GROUP_KEY);
      groupDiv.appendChild(header);

      var body = document.createElement("div");
      body.className = "fp-group-body";
      items.forEach(function (it) { body.appendChild(buildItemWrapperUnified(it, true)); });
      groupDiv.appendChild(body);

      // Default collapsed
      body.style.display = "none";
      var expandKey = "group:" + groupName;
      var gtoggle = header.querySelector(".fp-group-toggle");
      if (_expandedGroups[expandKey]) {
        body.style.display = "";
        if (gtoggle) gtoggle.classList.add("open");
      }

      var sw = header.querySelector(".fp-item-swatch");
      var headerEye = header.querySelector(".fp-visibility-btn");
      var headerTrash = header.querySelector(".fp-del-btn");
      function toggleGroup(e) {
        if (sw && (e.target === sw || sw.contains(e.target))) return;
        if (headerEye && (e.target === headerEye || headerEye.contains(e.target))) return;
        if (headerTrash && (e.target === headerTrash || headerTrash.contains(e.target))) return;
        e.stopPropagation();
        var isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "";
        if (gtoggle) gtoggle.classList.toggle("open", !isOpen);
        if (isOpen) { delete _expandedGroups[expandKey]; }
        else { _expandedGroups[expandKey] = true; }
      }
      if (gtoggle) gtoggle.addEventListener("click", toggleGroup);
      header.addEventListener("click", toggleGroup);

      el.appendChild(groupDiv);
    });

    // Render ungrouped items
    ungrouped.forEach(function (it) {
      el.appendChild(buildItemWrapperUnified(it, false));
    });
  }

  /* ---- Label grouped list (labels stay in their own section) ---- */

  function populateLabelGroupedList() {
    var containerId = "fp-labels";
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    var features = App.labels || [];
    if (!features.length) return;

    var groups = {};
    var ungrouped = [];
    for (var i = 0; i < features.length; i++) {
      var a = features[i].properties.attributes;
      var g = a && a[LABEL_GROUP_KEY];
      if (g) {
        if (!groups[g]) groups[g] = [];
        groups[g].push({ feature: features[i], type: "label", index: i });
      } else {
        ungrouped.push({ feature: features[i], type: "label", index: i });
      }
    }

    var groupNames = Object.keys(groups);
    if (groupNames.length === 0) {
      // Flat list
      sortItems(ungrouped);
      ungrouped.forEach(function (it) { el.appendChild(buildItemWrapperUnified(it, false)); });
      return;
    }

    groupNames.sort(naturalSort);
    groupNames.forEach(function (gn) { sortItems(groups[gn]); });
    sortItems(ungrouped);

    groupNames.forEach(function (groupName) {
      var items = groups[groupName];
      var groupDiv = document.createElement("div");
      groupDiv.className = "fp-group";

      var header = buildMixedGroupHeader(groupName, items, LABEL_GROUP_KEY);
      groupDiv.appendChild(header);

      var body = document.createElement("div");
      body.className = "fp-group-body";
      items.forEach(function (it) { body.appendChild(buildItemWrapperUnified(it, true)); });
      groupDiv.appendChild(body);

      body.style.display = "none";
      var expandKey = "label:" + groupName;
      var gtoggle = header.querySelector(".fp-group-toggle");
      if (_expandedGroups[expandKey]) {
        body.style.display = "";
        if (gtoggle) gtoggle.classList.add("open");
      }

      var sw = header.querySelector(".fp-item-swatch");
      var headerEye = header.querySelector(".fp-visibility-btn");
      var headerTrash = header.querySelector(".fp-del-btn");
      function toggleGroup(e) {
        if (sw && (e.target === sw || sw.contains(e.target))) return;
        if (headerEye && (e.target === headerEye || headerEye.contains(e.target))) return;
        if (headerTrash && (e.target === headerTrash || headerTrash.contains(e.target))) return;
        e.stopPropagation();
        var isOpen = body.style.display !== "none";
        body.style.display = isOpen ? "none" : "";
        if (gtoggle) gtoggle.classList.toggle("open", !isOpen);
        if (isOpen) { delete _expandedGroups[expandKey]; }
        else { _expandedGroups[expandKey] = true; }
      }
      if (gtoggle) gtoggle.addEventListener("click", toggleGroup);
      header.addEventListener("click", toggleGroup);

      el.appendChild(groupDiv);
    });

    // Ungrouped labels
    ungrouped.forEach(function (it) { el.appendChild(buildItemWrapperUnified(it, false)); });
  }

  function applySectionCollapse() {
    if (_collapsedSections.label) {
      var el = document.getElementById("fp-labels");
      if (el) el.style.display = "none";
    }
  }

  function refreshFeaturePanel() {
    buildLabelSectionSwatch(); // no-op after first call
    initSettingsCollapse();    // no-op after first call
    populateUnifiedList();
    populateLabelGroupedList();
    applySectionCollapse();
    if (typeof App.applyPanelHighlight === "function") App.applyPanelHighlight();
  }

  /* ---- Feature Settings collapse toggle ---- */

  var _settingsCollapseWired = false;

  function initSettingsCollapse() {
    if (_settingsCollapseWired) return;
    _settingsCollapseWired = true;

    var header = document.querySelector(".fp-settings-header");
    if (!header) return;

    // Add chevron toggle
    var stog = document.createElement("button");
    stog.className = "fp-section-toggle";
    stog.innerHTML = CHEVRON_SVG;
    stog.title = "Toggle Feature Settings";
    header.appendChild(stog);

    var body = header.nextElementSibling; // .fp-settings-body

    function toggle(e) {
      e.stopPropagation();
      var isOpen = body && body.style.display !== "none";
      if (body) body.style.display = isOpen ? "none" : "";
      stog.classList.toggle("open", !isOpen);
    }
    stog.addEventListener("click", toggle);
    header.addEventListener("click", toggle);
  }

  App.refreshFeaturePanel = refreshFeaturePanel;
  App.getTypeDefaultColor = getTypeDefaultColor;
  App.showContextMenu     = showContextMenu;
  App.rerenderForType     = rerenderForType;

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
