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
  var _expandedGroups = {};

  // Tracks which feature-type sections the user has collapsed this session.
  // Default is expanded; only collapsed sections are stored.
  var _collapsedSections = {};

  var GROUP_KEYS = {
    station: "stationGroup", line: "lineGroup",
    route: "routeGroup", polygon: "polygonGroup", label: "labelGroup"
  };

  var TYPE_LABELS_LOCAL = {
    station: "Station", line: "Line",
    route: "Route", polygon: "Polygon", label: "Label"
  };

  var CHEVRON_SVG = '&#9662;';

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
    if (featureType === "station") {
      if (App.stations[featureIndex]) App.stations[featureIndex].properties.color = newColor;
      if (typeof App.renderStationLayers === "function") App.renderStationLayers();
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
    var defaults = { station: "#2b6cb0", line: "#e53e3e", route: "#319795", polygon: "#b0c4de", label: "#1a202c" };
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
    var map = { station: "stations", line: "lines", route: "routes", polygon: "polygons", label: "labels" };
    var arr = App[map[type]];
    return arr ? arr[index] : null;
  }

  function generateGroupName(type) {
    var label = TYPE_LABELS_LOCAL[type] || type;
    var key = GROUP_KEYS[type];
    var map = { station: "stations", line: "lines", route: "routes", polygon: "polygons", label: "labels" };
    var arr = App[map[type]] || [];
    var existing = {};
    arr.forEach(function (f) {
      var g = f.properties.attributes && f.properties.attributes[key];
      if (g) existing[g] = true;
    });
    var n = 1;
    while (existing[label + " Group " + n]) n++;
    return label + " Group " + n;
  }

  function groupSelectedFeatures() {
    var selected = typeof App.getSelectedFeatures === "function" ? App.getSelectedFeatures() : [];
    if (selected.length < 2) return;
    var type = selected[0].type;
    var key = GROUP_KEYS[type];
    if (!key) return;
    var name = generateGroupName(type);
    // For routes: inherit color from the first route already carrying a color in this new group
    var inheritColor = null;
    if (type === "route") {
      for (var i = 0; i < selected.length; i++) {
        var rf = getFeatureByTypeIndex("route", selected[i].index);
        if (rf && rf.properties.color) { inheritColor = rf.properties.color; break; }
      }
    }
    selected.forEach(function (s) {
      var feat = getFeatureByTypeIndex(s.type, s.index);
      if (!feat) return;
      if (!feat.properties.attributes) feat.properties.attributes = {};
      feat.properties.attributes[key] = name;
      if (inheritColor) feat.properties.color = inheritColor;
    });
    if (inheritColor && type === "route") {
      var rrEl = document.getElementById("routeBufferRadius");
      var rr = rrEl ? parseFloat(rrEl.value) : 0.5; if (isNaN(rr)) rr = 0.5;
      if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(rr);
      if (typeof App.renderRouteLayers    === "function") App.renderRouteLayers();
    }
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function ungroupSelectedFeatures() {
    var selected = typeof App.getSelectedFeatures === "function" ? App.getSelectedFeatures() : [];
    selected.forEach(function (s) {
      var feat = getFeatureByTypeIndex(s.type, s.index);
      if (!feat || !feat.properties.attributes) return;
      var key = GROUP_KEYS[s.type];
      if (key) delete feat.properties.attributes[key];
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

    // Expand toggle button — far left
    var expandBtn = document.createElement("button");
    expandBtn.className = "fp-expand";
    expandBtn.title = "Edit attributes";
    expandBtn.innerHTML = CHEVRON_SVG;

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

    // Per-feature color swatch (all types including station)
    var swatch = document.createElement("button");
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

    var trashBtn = document.createElement("button");
    trashBtn.className = "fp-del-btn";
    trashBtn.title = "Delete feature";
    trashBtn.innerHTML = TRASH_SVG;
    trashBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var wrapper = div.closest ? div.closest(".fp-item-wrapper") : div.parentElement;
      if (!wrapper) return;
      var confirmDiv = wrapper.querySelector(".fp-delete-confirm");
      if (confirmDiv) {
        confirmDiv.style.display = "";
        trashBtn.style.display = "none";
      }
    });

    // Hover and click wiring
    div.addEventListener("mouseenter", function () {
      if (typeof App.setHoveredFeature === "function") App.setHoveredFeature(featureType, featureIndex);
    });
    div.addEventListener("mouseleave", function () {
      if (typeof App.clearHover === "function") App.clearHover();
    });
    div.addEventListener("click", function (e) {
      if (e.target === swatch || swatch.contains(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        if (typeof App.toggleMultiSelect === "function") App.toggleMultiSelect(featureType, featureIndex);
      } else {
        if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
        if (typeof App.toggleAttrPanel === "function") App.toggleAttrPanel(div);
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
      var allSameType = selected.every(function (s) { return s.type === selected[0].type; });
      if (selected.length >= 2 && allSameType) {
        var tLabel = TYPE_LABELS_LOCAL[selected[0].type] || selected[0].type;
        options.push({ label: "Group " + tLabel + "s", action: groupSelectedFeatures });
      }
      var anyInGroup = selected.some(function (s) {
        var feat = getFeatureByTypeIndex(s.type, s.index);
        var k = GROUP_KEYS[s.type];
        return feat && feat.properties.attributes && feat.properties.attributes[k];
      });
      if (anyInGroup) {
        options.push({ label: "Ungroup", action: ungroupSelectedFeatures });
      }
      if (options.length) showContextMenu(e.clientX, e.clientY, options);
    });

    // DOM order: expandBtn [eye] [swatch] [name] [dup?] [trash]
    div.appendChild(expandBtn);
    div.appendChild(eyeBtn);
    div.appendChild(swatch);
    div.appendChild(input);
    if (dupBtn) div.appendChild(dupBtn);
    div.appendChild(trashBtn);
    return div;
  }

  function buildDeleteConfirm(onDelete) {
    var container = document.createElement("div");
    container.className = "fp-delete-confirm";
    container.style.display = "none";
    var text = document.createElement("span");
    text.textContent = "Delete this feature?";
    var yesBtn = document.createElement("button");
    yesBtn.className = "fp-attr-confirm-yes";
    yesBtn.textContent = "Delete";
    yesBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof onDelete === "function") onDelete();
    });
    var noBtn = document.createElement("button");
    noBtn.className = "fp-attr-confirm-no";
    noBtn.textContent = "Cancel";
    noBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      container.style.display = "none";
      var wrapper = container.closest ? container.closest(".fp-item-wrapper") : container.parentElement;
      if (wrapper) {
        var trashBtn = wrapper.querySelector(".fp-del-btn");
        if (trashBtn) trashBtn.style.display = "";
      }
    });
    container.appendChild(text);
    container.appendChild(yesBtn);
    container.appendChild(noBtn);
    return container;
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

    var featArrayMap = { line: App.lines, route: App.routes, polygon: App.polygons, label: App.labels };
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
        } else if (type === "label") {
          featArray.forEach(function (f) { f.properties.bgColor = newColor; });
          if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();
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
      { text: "Polygons", type: "polygon" },
      { text: "Labels",   type: "label"   }
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

      // Add right-side chevron toggle for section collapse
      var listId = "fp-" + match.text.toLowerCase();
      var stog = document.createElement("button");
      stog.className = "fp-section-toggle open";
      stog.innerHTML = CHEVRON_SVG;
      stog.title = "Collapse " + match.text;
      header.appendChild(stog);

      (function (hdr, tog, swBtn, lId, t) {
        function toggleSection(e) {
          if (e.target === swBtn || swBtn.contains(e.target)) return;
          e.stopPropagation();
          var listEl = document.getElementById(lId);
          var isOpen = !_collapsedSections[t];
          if (isOpen) {
            _collapsedSections[t] = true;
            if (listEl) listEl.style.display = "none";
            tog.classList.remove("open");
          } else {
            delete _collapsedSections[t];
            if (listEl) listEl.style.display = "";
            tog.classList.add("open");
          }
        }
        tog.addEventListener("click", toggleSection);
        hdr.addEventListener("click", toggleSection);
      })(header, stog, sw, listId, type);
    });
  }

  /* ---- Shared group header builder ---- */

  function buildGroupHeader(groupName, featureType, idxs, features, rerenderFn, removeFn, onColorApply) {
    var header = document.createElement("div");
    header.className = "fp-group-header";

    var toggle = document.createElement("button");
    toggle.className = "fp-group-toggle";
    toggle.innerHTML = CHEVRON_SVG;
    header.appendChild(toggle);

    // Group-level visibility eye
    var allHidden = idxs.every(function (idx) { return !!features[idx].properties.hidden; });
    var groupEye = document.createElement("button");
    groupEye.className = "fp-visibility-btn" + (allHidden ? " fp-eye-off" : "");
    groupEye.innerHTML = allHidden ? EYE_OFF_SVG : EYE_SVG;
    groupEye.title = allHidden ? "Show all" : "Hide all";
    (function (btn, indices, feats) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var hideAll = !indices.every(function (i) { return !!feats[i].properties.hidden; });
        indices.forEach(function (i) {
          if (hideAll) { feats[i].properties.hidden = true; }
          else { delete feats[i].properties.hidden; }
        });
        if (App.cache && typeof App.cache.save === "function") App.cache.save();
        if (rerenderFn) rerenderFn();
      });
    })(groupEye, idxs, features);
    header.appendChild(groupEye);

    // Color swatch — applies color to all features in the group
    var firstColor = features[idxs[0]].properties.color || getTypeDefaultColor(featureType);
    var _groupSectionColor = App.sectionColors && App.sectionColors[featureType];
    header.style.borderLeftColor = firstColor;
    var sw = document.createElement("button");
    sw.className = "fp-swatch fp-item-swatch";
    if (_groupSectionColor && firstColor === _groupSectionColor) {
      sw.classList.add("fp-swatch-neutral");
    } else {
      sw.style.background = firstColor;
    }
    sw.title = "Change color for all in group";
    (function (swatch, indices, feats) {
      swatch.addEventListener("click", function (e) {
        e.stopPropagation();
        var curColor = feats[indices[0]].properties.color || getTypeDefaultColor(featureType);
        App.openColorPicker(swatch, curColor, function (newColor) {
          swatch.style.background = newColor;
          header.style.borderLeftColor = newColor;
          if (onColorApply) {
            onColorApply(indices, newColor, feats);
          } else {
            indices.forEach(function (idx) { feats[idx].properties.color = newColor; });
          }
          if (rerenderFn) rerenderFn();
          if (App.cache && typeof App.cache.save === "function") App.cache.save();
        });
      });
    })(sw, idxs, features);
    header.appendChild(sw);

    var nameSpan = document.createElement("span");
    nameSpan.className = "fp-group-name";
    nameSpan.textContent = groupName;
    nameSpan.title = "Double-click to rename";
    (function (span, indices, feats, fType) {
      span.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "fp-group-name-edit";
        inp.value = span.textContent;
        span.style.display = "none";
        header.insertBefore(inp, span.nextSibling);
        inp.focus();
        inp.select();
        function save() {
          var newName = inp.value.trim();
          inp.remove();
          span.style.display = "";
          if (newName && newName !== span.textContent) {
            var gKey = GROUP_KEYS[fType];
            indices.forEach(function (idx) {
              if (!feats[idx].properties.attributes) feats[idx].properties.attributes = {};
              feats[idx].properties.attributes[gKey] = newName;
            });
            if (App.cache && typeof App.cache.save === "function") App.cache.save();
            if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
          }
        }
        inp.addEventListener("blur", save);
        inp.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") inp.blur();
          if (ev.key === "Escape") { inp.value = span.textContent; inp.blur(); }
        });
      });
    })(nameSpan, idxs, features, featureType);
    header.appendChild(nameSpan);

    // Group delete button (margin-left: auto handled by CSS)
    if (removeFn) {
      var groupTrashBtn = document.createElement("button");
      groupTrashBtn.className = "fp-del-btn";
      groupTrashBtn.title = "Delete all features in group";
      groupTrashBtn.innerHTML = TRASH_SVG;
      (function (btn, indices) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var groupDiv = header.parentElement;
          if (!groupDiv) return;
          var existing = groupDiv.querySelector(".fp-group-delete-confirm");
          if (existing) { existing.style.display = ""; return; }
          var confirmDiv = document.createElement("div");
          confirmDiv.className = "fp-delete-confirm fp-group-delete-confirm";
          var text = document.createElement("span");
          text.textContent = "Delete all " + indices.length + " feature(s) in group?";
          var yesBtn = document.createElement("button");
          yesBtn.className = "fp-attr-confirm-yes";
          yesBtn.textContent = "Delete";
          yesBtn.addEventListener("click", function (e2) {
            e2.stopPropagation();
            var sorted = indices.slice().sort(function (a, b) { return b - a; });
            sorted.forEach(function (idx) { removeFn(idx); });
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
      })(groupTrashBtn, idxs);
      header.appendChild(groupTrashBtn);
    }

    return header;
  }

  /* ---- Generic grouped list builder ---- */

  function populateGroupedList(containerId, features, featureType, removeFn, groupKey, rerenderFn, groupItemSortFn, onColorApply) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    if (!features.length) return;

    var groups = {};
    var ungrouped = [];
    for (var i = 0; i < features.length; i++) {
      var a = features[i].properties.attributes;
      var g = a && a[groupKey];
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
      populateList(containerId, features, removeFn, featureType);
      return;
    }

    groupNames.sort(naturalSort);

    var defaultSort = function (a, b) {
      return naturalSort(features[a].properties.name, features[b].properties.name);
    };
    var itemSort = groupItemSortFn || defaultSort;

    groupNames.forEach(function (gn) { groups[gn].sort(itemSort); });
    ungrouped.sort(defaultSort);

    function buildItemWrapper(i) {
      var wrapper = document.createElement("div");
      wrapper.className = "fp-item-wrapper fp-pattern";
      var onDelete = (function (idx) {
        return function () {
          removeFn(idx);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
        };
      })(i);
      wrapper.appendChild(buildItem(features[i], featureType, i, onDelete));
      wrapper.appendChild(buildDeleteConfirm(onDelete));
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel(featureType, i, features[i], onDelete));
      }
      return wrapper;
    }

    groupNames.forEach(function (groupName) {
      var idxs = groups[groupName];
      var groupDiv = document.createElement("div");
      groupDiv.className = "fp-group";

      var header = buildGroupHeader(groupName, featureType, idxs, features, rerenderFn, removeFn, onColorApply);
      groupDiv.appendChild(header);

      var body = document.createElement("div");
      body.className = "fp-group-body";
      idxs.forEach(function (i) { body.appendChild(buildItemWrapper(i)); });
      groupDiv.appendChild(body);

      body.style.display = "none";
      var expandKey = featureType + ":" + groupName;
      var toggle = header.querySelector(".fp-group-toggle");
      if (_expandedGroups[expandKey]) {
        body.style.display = "";
        if (toggle) toggle.classList.add("open");
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
        if (toggle) toggle.classList.toggle("open", !isOpen);
        if (isOpen) { delete _expandedGroups[expandKey]; }
        else { _expandedGroups[expandKey] = true; }
      }
      if (toggle) toggle.addEventListener("click", toggleGroup);
      header.addEventListener("click", toggleGroup);

      el.appendChild(groupDiv);
    });

    // Render ungrouped items with same fp-pattern indent
    ungrouped.forEach(function (i) {
      var wrapper = document.createElement("div");
      wrapper.className = "fp-item-wrapper fp-pattern";
      var onDelete = (function (idx) {
        return function () {
          removeFn(idx);
          if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
        };
      })(i);
      wrapper.appendChild(buildItem(features[i], featureType, i, onDelete));
      wrapper.appendChild(buildDeleteConfirm(onDelete));
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel(featureType, i, features[i], onDelete));
      }
      el.appendChild(wrapper);
    });
  }

  /* ---- Route grouping list ---- */

  function populateRouteList(containerId, features, removeFn) {
    populateGroupedList(containerId, features, "route", removeFn, "routeGroup",
      function () {
        var rrEl = document.getElementById("routeBufferRadius");
        var rr = rrEl ? parseFloat(rrEl.value) : 0.5; if (isNaN(rr)) rr = 0.5;
        if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(rr);
        if (typeof App.renderRouteLayers === "function") App.renderRouteLayers();
      },
      function (a, b) {
        var aa = features[a].properties.attributes || {};
        var ab = features[b].properties.attributes || {};
        var da = aa.direction || "";
        var db = ab.direction || "";
        if (da !== db) return naturalSort(da, db);
        return naturalSort(features[a].properties.name, features[b].properties.name);
      }
    );
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
      var itemEl = buildItem(features[i], featureType, i, onDelete);
      wrapper.appendChild(itemEl);
      wrapper.appendChild(buildDeleteConfirm(onDelete));
      if (typeof App.buildAttrPanel === "function") {
        wrapper.appendChild(App.buildAttrPanel(featureType, i, features[i], onDelete));
      }
      el.appendChild(wrapper);
    });
  }

  /* ---- Label grouping list ---- */

  function populateLabelList(containerId, features, removeFn) {
    populateGroupedList(containerId, features, "label", removeFn, "labelGroup",
      function () {
        if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();
      },
      null,
      function (indices, newColor, feats) {
        indices.forEach(function (idx) {
          feats[idx].properties.color = newColor;
          feats[idx].properties.bgColor = newColor;
        });
      }
    );
  }

  var SECTION_LIST_IDS = { station: "fp-stations", line: "fp-lines", route: "fp-routes", polygon: "fp-polygons", label: "fp-labels" };

  function applySectionCollapse() {
    Object.keys(SECTION_LIST_IDS).forEach(function (type) {
      if (_collapsedSections[type]) {
        var el = document.getElementById(SECTION_LIST_IDS[type]);
        if (el) el.style.display = "none";
      }
    });
  }

  function refreshFeaturePanel() {
    buildSectionSwatches(); // no-op after first call
    populateGroupedList("fp-stations", App.stations || [], "station",
      App.removeStation || function () {}, "stationGroup",
      function () { if (typeof App.renderStationLayers === "function") App.renderStationLayers(); });
    populateGroupedList("fp-lines", App.lines || [], "line",
      App.removeLine || function () {}, "lineGroup",
      function () {
        var lrEl = document.getElementById("lineBufferRadius");
        var lr = lrEl ? parseFloat(lrEl.value) : 0.5; if (isNaN(lr)) lr = 0.5;
        if (typeof App.rebuildLineBuffers === "function") App.rebuildLineBuffers(lr);
        if (typeof App.renderLineLayers === "function") App.renderLineLayers();
      });
    populateRouteList("fp-routes", App.routes || [], App.removeRoute || function () {});
    populateGroupedList("fp-polygons", App.polygons || [], "polygon",
      App.removePolygon || function () {}, "polygonGroup",
      function () { if (typeof App.renderPolygonLayers === "function") App.renderPolygonLayers(); });
    populateLabelList("fp-labels", App.labels || [], App.removeLabel || function () {});
    applySectionCollapse();
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
