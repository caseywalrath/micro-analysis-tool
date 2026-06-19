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

  /* ---- Multi-select + bulk edit (Routes & Lines only) ---- */

  // Selected feature indices per type. Survives cell edits (which don't rebuild
  // the grid); cleared by renderAll() on structural change unless preserved.
  var _selected = { line: new Set(), route: new Set() };

  function tableIdForType(type) {
    return type === "line" ? "asLinesTable" : "asRoutesTable";
  }

  function makeCheckbox(cls) {
    var c = document.createElement("input");
    c.type = "checkbox";
    c.className = cls;
    return c;
  }

  function updateBulkBar(type) {
    var bar = el("as-bulk-bar-" + type);
    if (!bar) return;
    var n = _selected[type].size;
    bar.style.display = n > 0 ? "" : "none";
    var c = bar.querySelector(".as-bulk-count");
    if (c) c.textContent = n + " selected";
  }

  function syncRowChecks(type) {
    var tbl = el(tableIdForType(type));
    if (!tbl) return;
    tbl.querySelectorAll(".as-row:not(.as-row-header)").forEach(function (r) {
      var i = parseInt(r.dataset.featureIndex, 10);
      var on = _selected[type].has(i);
      var cb = r.querySelector(".as-rowcheck");
      if (cb) cb.checked = on;
      r.classList.toggle("as-selected", on);
    });
    var selAll = tbl.querySelector(".as-rowcheck-all");
    if (selAll) {
      var total = tbl.querySelectorAll(".as-row:not(.as-row-header)").length;
      selAll.checked = total > 0 && _selected[type].size === total;
    }
    updateBulkBar(type);
  }

  function onRowToggle(type, idx, row, checked) {
    if (checked) _selected[type].add(idx); else _selected[type].delete(idx);
    row.classList.toggle("as-selected", checked);
    syncRowChecks(type);
  }

  function toggleAll(type, count, checked) {
    _selected[type].clear();
    if (checked) { for (var i = 0; i < count; i++) _selected[type].add(i); }
    syncRowChecks(type);
  }

  function clearSelectionType(type) {
    _selected[type].clear();
    syncRowChecks(type);
  }

  function buildBulkBar(type) {
    var bar = document.createElement("div");
    bar.className = "as-bulk-bar";
    bar.id = "as-bulk-bar-" + type;
    bar.style.display = "none";

    var count = document.createElement("span");
    count.className = "as-bulk-count";
    bar.appendChild(count);

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "as-bulk-edit-btn";
    editBtn.textContent = "Bulk edit…";
    editBtn.addEventListener("click", function () { openBulkEditForm(type); });
    bar.appendChild(editBtn);

    var clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "as-bulk-clear-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", function () { clearSelectionType(type); });
    bar.appendChild(clearBtn);

    return bar;
  }

  // ---- Bulk-edit form (per-field include checkboxes) ----
  function openBulkEditForm(type) {
    var indices = Array.from(_selected[type]);
    if (!indices.length) return;
    var arr = (type === "line") ? (App.lines || []) : (App.routes || []);

    var form = document.createElement("div");
    form.className = "as-bulk-form";
    var fields = [];

    function addField(key, label, inputEl, readFn, opts) {
      opts = opts || {};
      var frow = document.createElement("div");
      frow.className = "as-bulk-frow";
      var inc = makeCheckbox("as-bulk-inc");
      var lab = document.createElement("label");
      lab.className = "as-bulk-flabel";
      lab.textContent = label;
      frow.appendChild(inc);
      frow.appendChild(lab);
      frow.appendChild(inputEl);
      // Disabled until "include" is checked (so an empty value can be applied).
      if (opts.isBands) { inputEl.classList.add("as-disabled"); }
      else { inputEl.disabled = true; }
      inc.addEventListener("change", function () {
        if (opts.isBands) inputEl.classList.toggle("as-disabled", !inc.checked);
        else inputEl.disabled = !inc.checked;
      });
      form.appendChild(frow);
      fields.push({ key: key, inc: inc, read: readFn, opts: opts });
    }

    function plainSelect(options) {
      var s = document.createElement("select");
      s.className = "as-input as-select";
      options.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o; opt.textContent = o === "" ? "—" : o;
        s.appendChild(opt);
      });
      return s;
    }
    function numInput(ph) {
      var i = document.createElement("input");
      i.type = "number"; i.className = "as-input as-input-num"; i.min = 0; i.step = "any";
      if (ph) i.placeholder = ph;
      return i;
    }
    function textInput(ph) {
      var i = document.createElement("input");
      i.type = "text"; i.className = "as-input";
      if (ph) i.placeholder = ph;
      return i;
    }

    var dirSel = plainSelect(DIRECTIONS);
    addField("direction", "Direction", dirSel, function () { return dirSel.value || null; });
    var modeSel = plainSelect(MODES);
    addField("mode", "Mode", modeSel, function () { return modeSel.value || null; });
    var spd = numInput("14");
    addField("avgSpeed", "Avg speed (mph)", spd, function () { return spd.value !== "" ? parseFloat(spd.value) : null; });
    var rt = numInput("e.g. 45");
    addField("runTime", "Run time (min)", rt, function () { return rt.value !== "" ? parseFloat(rt.value) : null; });
    var grp = textInput("e.g. Corridor A");
    addField("group", "Group", grp, function () { return grp.value.trim() || null; });

    // Time bands — reuse the shared editor against a throwaway carrier feature.
    var carrier = { properties: { attributes: {} } };
    var bandsWrap = document.createElement("div");
    bandsWrap.className = "as-bulk-bands";
    if (typeof App.buildServiceScheduleEditor === "function") {
      bandsWrap.appendChild(App.buildServiceScheduleEditor(carrier));
    }
    addField("service", "Time bands", bandsWrap,
      function () { return carrier.properties.attributes.service || null; }, { isBands: true });

    var applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "as-bulk-apply";
    applyBtn.textContent = "Apply to " + indices.length;
    applyBtn.addEventListener("click", function () { applyBulk(type, indices, fields); });
    form.appendChild(applyBtn);

    var label = (type === "line") ? "line" : "route";
    if (typeof App.openMiniPopup === "function") {
      App.openMiniPopup({
        title: "Bulk edit " + indices.length + " " + label + (indices.length > 1 ? "s" : ""),
        content: form,
        anchor: el("as-bulk-bar-" + type)
      });
    }
  }

  function applyBulk(type, indices, fields) {
    var arr = (type === "line") ? (App.lines || []) : (App.routes || []);
    if (App.undo && !App.undo.isRestoring()) App.undo.push();
    indices.forEach(function (i) {
      var feat = arr[i];
      if (!feat) return;
      if (!feat.properties.attributes) feat.properties.attributes = {};
      var a = feat.properties.attributes;
      fields.forEach(function (f) {
        if (!f.inc.checked) return;
        var val = f.read();
        if (f.opts.isBands) {
          if (val) a.service = JSON.parse(JSON.stringify(val)); // deep clone per feature
          else delete a.service;
        } else if (val == null || val === "") {
          delete a[f.key];
        } else {
          a[f.key] = val;
        }
      });
    });
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    renderAll({ preserveSelection: true });
    if (typeof App.closeMiniPopup === "function") App.closeMiniPopup();
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

    // Selection action bar (hidden until rows are checked).
    container.appendChild(buildBulkBar(featureType));

    var hdr = buildHeader([
      { label: "", cls: "as-col-check" },
      { label: "" },
      { label: "Name" },
      { label: "Direction", cls: "as-col-narrow" },
      { label: "Mode",      cls: "as-col-narrow" },
      { label: "Service" },
      { label: "Avg Spd",   cls: "as-col-num", title: "Average speed (mph)" },
      { label: "RunT",      cls: "as-col-num", title: "Run time (minutes, one-way / loop)" },
      { label: "Bands",     cls: "as-col-narrow", title: "Time bands — Weekday · Saturday · Sunday counts" },
      { label: "",          cls: "as-col-overrides", title: "Overrides" }
    ]);
    hdr.classList.add(gridClass);
    var selAll = makeCheckbox("as-rowcheck as-rowcheck-all");
    selAll.title = "Select all";
    selAll.addEventListener("change", function () { toggleAll(featureType, features.length, selAll.checked); });
    hdr.children[0].appendChild(selAll);
    container.appendChild(hdr);

    features.forEach(function (feat, idx) {
      var row = document.createElement("div");
      row.className = "as-row " + gridClass;
      row.dataset.featureType = featureType;
      row.dataset.featureIndex = String(idx);
      if (_selected[featureType].has(idx)) row.classList.add("as-selected");

      if (!feat.properties.attributes) feat.properties.attributes = {};
      var attrs = feat.properties.attributes;

      var cb = makeCheckbox("as-rowcheck");
      cb.checked = _selected[featureType].has(idx);
      (function (i, rowEl, box) {
        box.addEventListener("change", function () { onRowToggle(featureType, i, rowEl, box.checked); });
      })(idx, row, cb);
      appendCell(row, cb, "as-col-check");

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
    updateBulkBar(featureType);
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

  function renderAll(opts) {
    if (!isPopupVisible()) return;

    // Selection clears on structural re-render (add/delete shifts indices);
    // bulk-apply passes preserveSelection so checkboxes survive the rebuild.
    if (!(opts && opts.preserveSelection)) {
      _selected.line.clear();
      _selected.route.clear();
    }

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
