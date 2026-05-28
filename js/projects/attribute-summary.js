// js/projects/attribute-summary.js
// Attribute Summary — view and edit every drawn feature's attributes in one place.
// Opened from the Feature Settings panel (right side), not from the Analysis dropdown.
// Registered with `system: true` so the Analysis panel skips it.
(function () {
  var App = window.App = window.App || {};

  var DIRECTIONS = ["", "Both", "NB", "SB", "EB", "WB", "Inbound", "Outbound", "Loop", "CW", "CCW"];
  var MODES      = ["", "Bus", "BRT", "Light Rail", "Streetcar"];
  var FONT_SIZES = ["Small", "Medium", "Large", "XL"];

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "attribute-summary";
  }

  function el(id) { return document.getElementById(id); }

  function saveAndRefreshFeaturePanel() {
    if (App.undo && !App.undo.isRestoring()) App.undo.push();
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function pushLayer(featureType) {
    var fnName = {
      point:   "renderPointLayers",
      line:    "renderLineLayers",
      route:   "renderRouteLayers",
      polygon: "renderPolygonLayers"
    }[featureType];
    if (fnName && typeof App[fnName] === "function") App[fnName]();
  }

  /* ---- Cell builders ---- */

  function buildSwatchCell(featureType, featureIndex, feature) {
    var sw = document.createElement("button");
    sw.type = "button";
    sw.className = "as-swatch";
    sw.title = "Change color";
    sw.style.background = feature.properties.color ||
      (typeof App.getTypeDefaultColor === "function" ? App.getTypeDefaultColor(featureType) : "#999");
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof App.openColorPicker !== "function") return;
      App.openColorPicker(sw, feature.properties.color || sw.style.background, function (newColor) {
        feature.properties.color = newColor;
        sw.style.background = newColor;
        if (typeof App.updateFeatureColor === "function") {
          App.updateFeatureColor(featureType, featureIndex, newColor);
        }
        saveAndRefreshFeaturePanel();
      });
    });
    return sw;
  }

  function buildTextCell(getValue, setValue, opts) {
    opts = opts || {};
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "as-input";
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    if (opts.title) inp.title = opts.title;
    inp.value = getValue() != null ? getValue() : "";
    inp.addEventListener("change", function () {
      setValue(inp.value);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    return inp;
  }

  function buildNumberCell(getValue, setValue, opts) {
    opts = opts || {};
    var inp = document.createElement("input");
    inp.type = "number";
    inp.className = "as-input as-input-num";
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    if (opts.title) inp.title = opts.title;
    if (opts.min  != null) inp.min  = opts.min;
    if (opts.step != null) inp.step = opts.step;
    var v = getValue();
    inp.value = (v != null && v !== "") ? v : "";
    inp.addEventListener("change", function () {
      setValue(inp.value !== "" ? parseFloat(inp.value) : null);
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    return inp;
  }

  function buildSelectCell(options, getValue, setValue, opts) {
    opts = opts || {};
    var sel = document.createElement("select");
    sel.className = "as-input as-select";
    if (opts.title) sel.title = opts.title;
    var current = getValue();
    var noVal = (current == null || current === "");
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o === "" ? "—" : o;
      if (o === "" ? noVal : current === o) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      setValue(sel.value === "" ? null : sel.value);
    });
    return sel;
  }

  function buildColorSwatchCell(getValue, setValue, opts) {
    opts = opts || {};
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "as-swatch";
    btn.title = opts.title || "Change color";
    btn.style.background = getValue() || opts.defaultColor || "#1a202c";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof App.openColorPicker !== "function") return;
      App.openColorPicker(btn, getValue() || btn.style.background, function (newColor) {
        btn.style.background = newColor;
        setValue(newColor);
      });
    });
    return btn;
  }

  /* ---- Section renderers ---- */

  function appendCell(row, content, className) {
    var cell = document.createElement("div");
    cell.className = "as-cell" + (className ? " " + className : "");
    if (typeof content === "string") cell.textContent = content;
    else if (content) cell.appendChild(content);
    row.appendChild(cell);
    return cell;
  }

  function appendOverridesCell(row, featureType, feature) {
    var cell = document.createElement("div");
    cell.className = "as-cell as-cell-overrides";
    var ovr = (typeof App.buildOverrideIcons === "function")
      ? App.buildOverrideIcons(featureType, feature)
      : null;
    if (ovr) cell.appendChild(ovr);
    row.appendChild(cell);
  }

  // Header row builder
  function buildHeader(columns) {
    var hdr = document.createElement("div");
    hdr.className = "as-row as-row-header";
    columns.forEach(function (col) {
      var c = document.createElement("div");
      c.className = "as-cell as-cell-header" + (col.cls ? " " + col.cls : "");
      c.textContent = col.label;
      if (col.title) c.title = col.title;
      hdr.appendChild(c);
    });
    return hdr;
  }

  /* ---- Points ---- */

  function renderPoints(container) {
    var rows = App.points || [];
    if (!rows.length) return false;
    container.innerHTML = "";
    container.appendChild(buildHeader([
      { label: "" },
      { label: "Name" },
      { label: "ID",     title: "Stop ID" },
      { label: "Routes", title: "Associated routes / lines" },
      { label: "",       cls: "as-col-overrides", title: "Overrides" }
    ]));
    container.firstChild.classList.add("as-grid-points");

    rows.forEach(function (feat, idx) {
      var row = document.createElement("div");
      row.className = "as-row as-grid-points";
      row.dataset.featureType = "point";
      row.dataset.featureIndex = String(idx);

      if (!feat.properties.attributes) feat.properties.attributes = {};
      var attrs = feat.properties.attributes;

      appendCell(row, buildSwatchCell("point", idx, feat), "as-cell-swatch");
      appendCell(row, buildTextCell(
        function () { return feat.properties.name; },
        function (v) { feat.properties.name = v; saveAndRefreshFeaturePanel(); }
      ));
      appendCell(row, buildTextCell(
        function () { return attrs.stopId; },
        function (v) {
          if (v === "" || v == null) delete attrs.stopId;
          else attrs.stopId = v;
          saveAndRefreshFeaturePanel();
        },
        { placeholder: "e.g. 1042" }
      ));
      var badge = (typeof App.buildPointRouteBadge === "function")
        ? App.buildPointRouteBadge(feat)
        : document.createTextNode("—");
      appendCell(row, badge, "as-cell-badge");
      appendOverridesCell(row, "point", feat);

      container.appendChild(row);
    });
    return true;
  }

  /* ---- Lines / Routes (shared) ---- */

  function renderLineLike(container, featureType, features, gridClass) {
    if (!features.length) return false;
    container.innerHTML = "";
    container.appendChild(buildHeader([
      { label: "" },
      { label: "Name" },
      { label: "Direction", cls: "as-col-narrow" },
      { label: "Mode",      cls: "as-col-narrow" },
      { label: "Service" },
      { label: "Avg Spd",   cls: "as-col-num", title: "Average speed (mph)" },
      { label: "RunT",      cls: "as-col-num", title: "Run time (minutes, one-way / loop)" },
      { label: "Bands",     cls: "as-col-narrow", title: "Time bands — Weekday · Saturday · Sunday counts" },
      { label: "",          cls: "as-col-overrides", title: "Overrides" }
    ]));
    container.firstChild.classList.add(gridClass);

    features.forEach(function (feat, idx) {
      var row = document.createElement("div");
      row.className = "as-row " + gridClass;
      row.dataset.featureType = featureType;
      row.dataset.featureIndex = String(idx);

      if (!feat.properties.attributes) feat.properties.attributes = {};
      var attrs = feat.properties.attributes;

      appendCell(row, buildSwatchCell(featureType, idx, feat), "as-cell-swatch");
      appendCell(row, buildTextCell(
        function () { return feat.properties.name; },
        function (v) { feat.properties.name = v; saveAndRefreshFeaturePanel(); }
      ));
      appendCell(row, buildSelectCell(DIRECTIONS,
        function () { return attrs.direction; },
        function (v) {
          if (v == null) delete attrs.direction; else attrs.direction = v;
          saveAndRefreshFeaturePanel();
        },
        { title: "Direction" }
      ), "as-col-narrow");
      appendCell(row, buildSelectCell(MODES,
        function () { return attrs.mode; },
        function (v) {
          if (v == null) delete attrs.mode; else attrs.mode = v;
          saveAndRefreshFeaturePanel();
        },
        { title: "Mode" }
      ), "as-col-narrow");
      appendCell(row, buildServiceIdCell(attrs, feat, featureType, idx));
      appendCell(row, buildNumberCell(
        function () { return attrs.avgSpeed; },
        function (v) {
          if (v == null) delete attrs.avgSpeed; else attrs.avgSpeed = v;
          saveAndRefreshFeaturePanel();
        },
        { placeholder: "14", min: 0, step: "any", title: "Average speed (mph)" }
      ), "as-col-num");
      appendCell(row, buildNumberCell(
        function () { return attrs.runTime; },
        function (v) {
          if (v == null) delete attrs.runTime; else attrs.runTime = v;
          saveAndRefreshFeaturePanel();
        },
        { placeholder: "—", min: 0, step: "any", title: "Run time (min)" }
      ), "as-col-num");
      var bandsBtn = (typeof App.buildTimeBandsBadge === "function")
        ? App.buildTimeBandsBadge(feat)
        : document.createTextNode("—");
      appendCell(row, bandsBtn, "as-col-narrow as-cell-badge");
      appendOverridesCell(row, featureType, feat);

      container.appendChild(row);
    });
    return true;
  }

  // Service field is a text input with the shared autocomplete datalist
  // so colored/grouped service ids continue to share suggestions.
  function buildServiceIdCell(attrs, feature, featureType, featureIndex) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "as-input";
    inp.placeholder = "e.g. Blue Line";
    inp.title = "Service (pairing key for Route Costing)";
    inp.value = attrs.serviceId != null ? attrs.serviceId : "";

    // Reuse the shared datalist created by the per-feature popup
    var dlId = "fp-service-datalist";
    var dl = document.getElementById(dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = dlId;
      document.body.appendChild(dl);
    }
    function refreshDatalist() {
      dl.innerHTML = "";
      var seen = {};
      [App.routes || [], App.lines || []].forEach(function (arr) {
        arr.forEach(function (f) {
          var s = f.properties.attributes && f.properties.attributes.serviceId;
          if (s && !seen[s]) {
            seen[s] = true;
            var opt = document.createElement("option");
            opt.value = s;
            dl.appendChild(opt);
          }
        });
      });
    }
    refreshDatalist();
    inp.setAttribute("list", dlId);

    inp.addEventListener("change", function () {
      var newVal = inp.value.trim();
      if (newVal) {
        attrs.serviceId = newVal;
        // Inherit color from existing route/line with same serviceId
        var existingColor = null;
        [App.routes || [], App.lines || []].forEach(function (arr) {
          arr.forEach(function (f) {
            if (!existingColor && f.properties.color && f.properties !== feature.properties) {
              var s = f.properties.attributes && f.properties.attributes.serviceId;
              if (s === newVal) existingColor = f.properties.color;
            }
          });
        });
        if (existingColor) {
          feature.properties.color = existingColor;
          if (typeof App.updateFeatureColor === "function") {
            App.updateFeatureColor(featureType, featureIndex, existingColor);
          }
        }
      } else {
        delete attrs.serviceId;
      }
      refreshDatalist();
      saveAndRefreshFeaturePanel();
    });
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") inp.blur(); });
    return inp;
  }

  /* ---- Polygons ---- */

  function renderPolygons(container) {
    var rows = App.polygons || [];
    if (!rows.length) return false;
    container.innerHTML = "";
    container.appendChild(buildHeader([
      { label: "" },
      { label: "Name" },
      { label: "Notes" },
      { label: "", cls: "as-col-overrides", title: "Overrides" }
    ]));
    container.firstChild.classList.add("as-grid-polygons");

    rows.forEach(function (feat, idx) {
      var row = document.createElement("div");
      row.className = "as-row as-grid-polygons";
      row.dataset.featureType = "polygon";
      row.dataset.featureIndex = String(idx);

      if (!feat.properties.attributes) feat.properties.attributes = {};
      var attrs = feat.properties.attributes;

      appendCell(row, buildSwatchCell("polygon", idx, feat), "as-cell-swatch");
      appendCell(row, buildTextCell(
        function () { return feat.properties.name; },
        function (v) { feat.properties.name = v; saveAndRefreshFeaturePanel(); }
      ));
      appendCell(row, buildTextCell(
        function () { return attrs.notes; },
        function (v) {
          if (v === "" || v == null) delete attrs.notes;
          else attrs.notes = v;
          saveAndRefreshFeaturePanel();
        },
        { placeholder: "" }
      ));
      appendOverridesCell(row, "polygon", feat);

      container.appendChild(row);
    });
    return true;
  }

  /* ---- Text Boxes & Labels ---- */

  function renderMarkers(container, featureType, features, gridClass, updateFn) {
    if (!features.length) return false;
    container.innerHTML = "";
    container.appendChild(buildHeader([
      { label: "Name" },
      { label: "Size",       cls: "as-col-narrow" },
      { label: "Background", cls: "as-col-narrow" },
      { label: "Text",       cls: "as-col-narrow" }
    ]));
    container.firstChild.classList.add(gridClass);

    features.forEach(function (feat, idx) {
      var row = document.createElement("div");
      row.className = "as-row " + gridClass;
      row.dataset.featureType = featureType;
      row.dataset.featureIndex = String(idx);

      if (!feat.properties.attributes) feat.properties.attributes = {};
      var attrs = feat.properties.attributes;

      appendCell(row, buildTextCell(
        function () { return feat.properties.name; },
        function (v) {
          feat.properties.name = v;
          if (typeof updateFn === "function") updateFn(idx);
          saveAndRefreshFeaturePanel();
        }
      ));
      appendCell(row, buildSelectCell(FONT_SIZES,
        function () { return attrs.fontSize || feat.properties.fontSize; },
        function (v) {
          attrs.fontSize = v;
          feat.properties.fontSize = v;
          if (typeof updateFn === "function") updateFn(idx);
          saveAndRefreshFeaturePanel();
        },
        { title: "Font size" }
      ), "as-col-narrow");
      appendCell(row, buildColorSwatchCell(
        function () { return attrs.bgColor || feat.properties.bgColor; },
        function (v) {
          attrs.bgColor = v;
          feat.properties.bgColor = v;
          feat.properties.color   = v;
          if (typeof updateFn === "function") updateFn(idx);
          saveAndRefreshFeaturePanel();
        },
        { title: "Background color", defaultColor: "#1a202c" }
      ), "as-col-narrow as-cell-swatch");
      appendCell(row, buildColorSwatchCell(
        function () { return attrs.textColor || feat.properties.textColor; },
        function (v) {
          attrs.textColor = v;
          feat.properties.textColor = v;
          if (typeof updateFn === "function") updateFn(idx);
          saveAndRefreshFeaturePanel();
        },
        { title: "Text color", defaultColor: "#ffffff" }
      ), "as-col-narrow as-cell-swatch");

      container.appendChild(row);
    });
    return true;
  }

  /* ---- Top-level render ---- */

  function showSection(name, visible) {
    var sec = document.querySelector('.as-section[data-section="' + name + '"]');
    if (sec) sec.style.display = visible ? "" : "none";
  }

  function renderAll() {
    if (!isPopupVisible()) return;

    var any = false;
    var pointsTbl   = el("asPointsTable");
    var linesTbl    = el("asLinesTable");
    var routesTbl   = el("asRoutesTable");
    var polysTbl    = el("asPolygonsTable");
    var tbTbl       = el("asTextboxesTable");
    var lblTbl      = el("asLabelsTable");

    var hasP = pointsTbl && renderPoints(pointsTbl);
    var hasL = linesTbl  && renderLineLike(linesTbl,  "line",  App.lines  || [], "as-grid-routelike");
    var hasR = routesTbl && renderLineLike(routesTbl, "route", App.routes || [], "as-grid-routelike");
    var hasG = polysTbl  && renderPolygons(polysTbl);
    var hasT = tbTbl     && renderMarkers(tbTbl, "textbox", App.textBoxes || [], "as-grid-marker", App.updateTextBoxAppearance);
    var hasB = lblTbl    && renderMarkers(lblTbl, "label",   App.labels    || [], "as-grid-marker", App.updateLabelAppearance);

    showSection("point",   !!hasP);
    showSection("line",    !!hasL);
    showSection("route",   !!hasR);
    showSection("polygon", !!hasG);
    showSection("textbox", !!hasT);
    showSection("label",   !!hasB);

    any = hasP || hasL || hasR || hasG || hasT || hasB;
    var emptyEl = el("asEmpty");
    if (emptyEl) emptyEl.style.display = any ? "none" : "";
  }

  /* ---- Module registration ---- */

  App.registerModule({
    id: "attribute-summary",
    name: "Attribute Summary",
    enabled: true,
    system: true,           // skip in Analysis sidebar dropdown
    popupWidth: 960,
    popupHTML: "projects/attribute-summary-popup.html",

    init: function (/* core */) {
      // App.notifyProject() (called after feature add/delete and cache restore)
      // invokes our update() hook, which re-renders. Nothing to wire here.
    },

    onOpen: function (/* core */) {
      renderAll();
    },

    onClose: function (/* core */) {
      // Nothing to clean up — feature state lives on the features themselves.
    },

    update: function (/* core */) {
      // Called when features add/delete or external state changes.
      if (isPopupVisible()) renderAll();
    }
  });

})();
