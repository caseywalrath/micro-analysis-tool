// js/core/feature-attributes.js
// Per-feature attribute popup: floating draggable dialog (singleton).
// Only one popup open at a time; opening a different feature replaces content.
// Exports:
//   App.openAttrPopup(featureType, featureIndex, feature)
//   App.closeAttrPopup()
//   App.isAttrPopupOpen()
//   App.getAttrPopupFeature()  → { featureType, featureIndex } | null

(function () {
  var App = window.App = window.App || {};

  // 24-hour hours for span dropdowns
  var HOURS_24 = [""];  // "0:00" … "23:00"
  for (var _h = 0; _h < 24; _h++) { HOURS_24.push(_h + ":00"); }
  var HOURS_24_SPAN_END = [""];  // "1:00" … "24:00" (shifted forward by one hour)
  for (var _h = 1; _h <= 24; _h++) { HOURS_24_SPAN_END.push(_h + ":00"); }

  var TYPE_LABELS = {
    route:   "Route",
    line:    "Line",
    station: "Point",
    polygon: "Polygon",
    label:   "Label"
  };

  // Field definitions per feature type.
  // Supported types: "text", "number", "select", "checkboxes"
  var ATTR_FIELDS = {
    route: [
      { key: "group",         label: "Group",     type: "text",       placeholder: "e.g. Corridor A", groupPicker: true },
      { key: "direction",     label: "Direction",   type: "select",     options: ["Both","NB","SB","EB","WB","Inbound","Outbound","Loop"] },
      { key: "mode",          label: "Mode",        type: "select",     options: ["Bus","BRT","Light Rail","Streetcar"] },
      { key: "routeId",       label: "Route ID",    type: "text",       placeholder: "e.g. 7, Blue" },
      { key: "frequency",     label: "Frequency",   type: "number",     unit: "min" },
      { key: "spanStart",     label: "Span start",  type: "select",     options: HOURS_24 },
      { key: "spanEnd",       label: "Span end",    type: "select",     options: HOURS_24_SPAN_END },
      { key: "daysOfService", label: "Days",        type: "checkboxes", options: ["M-F","Sat","Sun"] },
      { key: "avgSpeed",      label: "Avg speed",   type: "number",     unit: "mph" }
    ],
    line: [
      { key: "group",    label: "Group", type: "text", placeholder: "e.g. Corridor A", groupPicker: true },
      { key: "lineMode",  label: "Mode",  type: "select", options: ["Light Rail","Commuter Rail","Streetcar","Bus","BRT"] },
      { key: "notes",     label: "Notes", type: "text",   placeholder: "" }
    ],
    station: [
      { key: "group",            label: "Group",    type: "text", placeholder: "e.g. North Corridor", groupPicker: true },
      { key: "stopId",           label: "Stop ID",       type: "text", placeholder: "e.g. 1042" },
      { key: "associatedRoutes", label: "Routes"                                                 }
    ],
    polygon: [
      { key: "group",  label: "Group",  type: "text", placeholder: "e.g. Study Area", groupPicker: true },
      { key: "notes",  label: "Notes",  type: "text", placeholder: "" }
    ],
    label: [
      { key: "labelGroup", label: "Label Group", type: "text",   placeholder: "e.g. Route Numbers", hidden: true },
      { key: "text",       label: "Text",        type: "text",   placeholder: "Map text" },
      { key: "fontSize",   label: "Size",        type: "select", options: ["Small","Medium","Large","XL"] },
      { key: "bgColor",    label: "Background",  type: "color" },
      { key: "textColor",  label: "Text Color",  type: "color" }
    ]
  };

  function saveAttrCache() {
    if (App.undo && !App.undo.isRestoring()) App.undo.push();
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
  }

  /* ---- Field builders ---- */

  function buildSelect(field, attrs) {
    var sel = document.createElement("select");
    sel.className = "fp-attr-input";
    var val = attrs[field.key];
    var noVal = (val === undefined || val === null || val === "");
    field.options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt === "" ? "—" : opt;
      if (opt === "" ? noVal : val === opt) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      attrs[field.key] = sel.value === "" ? null : sel.value;
      saveAttrCache();
    });
    return { el: sel, unit: null };
  }

  function buildCheckboxes(field, attrs) {
    var checked = Array.isArray(attrs[field.key]) ? attrs[field.key] : [];
    var wrapper = document.createElement("div");
    wrapper.className = "fp-attr-checks";
    field.options.forEach(function (opt) {
      var lbl = document.createElement("label");
      lbl.className = "fp-attr-check-label";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked.indexOf(opt) >= 0;
      cb.addEventListener("change", function () {
        var cur = Array.isArray(attrs[field.key]) ? attrs[field.key].slice() : [];
        if (cb.checked) {
          if (cur.indexOf(opt) < 0) cur.push(opt);
        } else {
          cur = cur.filter(function (x) { return x !== opt; });
        }
        attrs[field.key] = cur;
        saveAttrCache();
      });
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode("\u00a0" + opt));
      wrapper.appendChild(lbl);
    });
    return { el: wrapper, unit: null };
  }

  function buildRoutePicker(attrs) {
    var container = document.createElement("div");
    container.className = "fp-route-picker";

    var routes = App.routes || [];
    var lines  = App.lines  || [];

    if (!routes.length && !lines.length) {
      var msg = document.createElement("span");
      msg.className = "fp-attr-unit";
      msg.textContent = "No routes or lines drawn";
      container.appendChild(msg);
      return { el: container, unit: null };
    }

    var current = attrs.associatedRoutes || [];

    function makeCheck(featureType, feature, idProp) {
      var fid  = feature.properties[idProp];
      var name = feature.properties.name;
      var lbl  = document.createElement("label");
      lbl.className = "fp-route-picker-label";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = current.some(function (r) {
        return r.featureType === featureType && r.featureId === fid;
      });
      cb.addEventListener("change", function () {
        var cur = attrs.associatedRoutes || [];
        if (cb.checked) {
          cur = cur.concat([{ featureType: featureType, featureId: fid, name: name }]);
        } else {
          cur = cur.filter(function (r) {
            return !(r.featureType === featureType && r.featureId === fid);
          });
        }
        attrs.associatedRoutes = cur;
        saveAttrCache();
      });
      var dot = document.createElement("span");
      dot.className = "fp-route-picker-dot";
      dot.style.background = feature.properties.color || "#aaa";
      lbl.appendChild(cb);
      lbl.appendChild(dot);
      lbl.appendChild(document.createTextNode("\u00a0" + name));
      container.appendChild(lbl);
    }

    routes.forEach(function (r) { makeCheck("route", r, "routeIdx"); });
    lines.forEach(function  (l) { makeCheck("line",  l, "lineIdx");  });

    return { el: container, unit: null };
  }

  function buildTextOrNumber(field, attrs) {
    var inp = document.createElement("input");
    inp.type = field.type === "number" ? "number" : "text";
    inp.className = "fp-attr-input";
    if (field.placeholder) inp.placeholder = field.placeholder;
    if (field.type === "number") { inp.min = "0"; inp.step = "1"; }
    var val = attrs[field.key];
    inp.value = (val !== undefined && val !== null) ? val : "";
    inp.addEventListener("change", function () {
      attrs[field.key] = field.type === "number"
        ? (inp.value !== "" ? parseFloat(inp.value) : null)
        : inp.value;
      saveAttrCache();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") inp.blur();
    });
    return { el: inp, unit: field.unit || null };
  }

  function buildGroupPicker(field, attrs, feature) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "fp-attr-input";
    if (field.placeholder) inp.placeholder = field.placeholder;
    var val = attrs[field.key];
    inp.value = (val !== undefined && val !== null) ? val : "";

    // Build/refresh a shared datalist with all existing group names
    var dlId = "fp-rg-datalist";
    var dl = document.getElementById(dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = dlId;
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    var seen = {};
    (App.routes || []).forEach(function (r) {
      var g = r.properties.attributes && r.properties.attributes.routeGroup;
      if (g && !seen[g]) {
        seen[g] = true;
        var opt = document.createElement("option");
        opt.value = g;
        dl.appendChild(opt);
      }
    });
    inp.setAttribute("list", dlId);

    inp.addEventListener("change", function () {
      var newVal = inp.value.trim();
      if (newVal) {
        attrs[field.key] = newVal;
        // Inherit color from an existing route in the same group
        var existingColor = null;
        (App.routes || []).forEach(function (r) {
          if (!existingColor && r.properties.color && r.properties !== feature.properties) {
            var g = r.properties.attributes && r.properties.attributes.routeGroup;
            if (g === newVal) existingColor = r.properties.color;
          }
        });
        if (existingColor) {
          feature.properties.color = existingColor;
          var rrEl = document.getElementById("routeBufferRadius");
          var rr = rrEl ? parseFloat(rrEl.value) : 0.5; if (isNaN(rr)) rr = 0.5;
          if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(rr);
        }
      } else {
        delete attrs[field.key];
      }
      saveAttrCache();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") inp.blur();
    });
    return { el: inp, unit: null };
  }

  function buildGenericGroupPicker(field, attrs, featureType) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "fp-attr-input";
    if (field.placeholder) inp.placeholder = field.placeholder;
    var val = attrs[field.key];
    inp.value = (val !== undefined && val !== null) ? val : "";

    var TYPE_TO_ARRAY = { station: "stations", line: "lines", polygon: "polygons" };
    var dlId = "fp-" + featureType + "-group-datalist";
    var dl = document.getElementById(dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = dlId;
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    var seen = {};
    (App[TYPE_TO_ARRAY[featureType]] || []).forEach(function (f) {
      var g = f.properties.attributes && f.properties.attributes[field.key];
      if (g && !seen[g]) {
        seen[g] = true;
        var opt = document.createElement("option");
        opt.value = g;
        dl.appendChild(opt);
      }
    });
    inp.setAttribute("list", dlId);

    inp.addEventListener("change", function () {
      var newVal = inp.value.trim();
      if (newVal) {
        attrs[field.key] = newVal;
      } else {
        delete attrs[field.key];
      }
      saveAttrCache();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") inp.blur();
    });
    return { el: inp, unit: null };
  }

  function buildColorPicker(field, attrs, feature) {
    var btn = document.createElement("button");
    btn.className = "fp-attr-color-swatch";
    btn.style.background = attrs[field.key] || (field.key === "textColor" ? "#ffffff" : "#1a202c");
    btn.title = field.label;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof App.openColorPicker === "function") {
        App.openColorPicker(btn, attrs[field.key] || btn.style.background, function (newColor) {
          attrs[field.key] = newColor;
          btn.style.background = newColor;
          // Sync bgColor → feature.properties for swatch display
          if (field.key === "bgColor") { feature.properties.bgColor = newColor; feature.properties.color = newColor; }
          if (field.key === "textColor") feature.properties.textColor = newColor;
          saveAttrCache();
          // Fire change event so body-level listener can update marker appearance
          btn.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
    });
    return { el: btn, unit: null };
  }

  function buildLabelGroupPicker(field, attrs, feature) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "fp-attr-input";
    if (field.placeholder) inp.placeholder = field.placeholder;
    var val = attrs[field.key];
    inp.value = (val !== undefined && val !== null) ? val : "";

    var dlId = "fp-lg-datalist";
    var dl = document.getElementById(dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = dlId;
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    var seen = {};
    (App.labels || []).forEach(function (l) {
      var g = l.properties.attributes && l.properties.attributes.labelGroup;
      if (g && !seen[g]) {
        seen[g] = true;
        var opt = document.createElement("option");
        opt.value = g;
        dl.appendChild(opt);
      }
    });
    inp.setAttribute("list", dlId);

    inp.addEventListener("change", function () {
      var newVal = inp.value.trim();
      if (newVal) {
        attrs[field.key] = newVal;
        // Inherit color from an existing label in the same group
        var existingColor = null;
        (App.labels || []).forEach(function (l) {
          if (!existingColor && l.properties.color && l.properties !== feature.properties) {
            var g = l.properties.attributes && l.properties.attributes.labelGroup;
            if (g === newVal) existingColor = l.properties.color;
          }
        });
        if (existingColor) {
          feature.properties.color = existingColor;
          feature.properties.bgColor = existingColor;
          if (typeof App.updateLabelAppearance === "function") {
            var idx = (App.labels || []).indexOf(feature);
            if (idx >= 0) App.updateLabelAppearance(idx);
          }
        }
      } else {
        delete attrs[field.key];
      }
      saveAttrCache();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") inp.blur();
    });
    return { el: inp, unit: null };
  }

  function buildUniversalGroupPicker(field, attrs, feature, featureType) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "fp-attr-input";
    if (field.placeholder) inp.placeholder = field.placeholder;
    var val = attrs[field.key];
    inp.value = (val !== undefined && val !== null) ? val : "";

    // Build datalist with all existing universal group names across all feature types
    var dlId = "fp-universal-group-datalist";
    var dl = document.getElementById(dlId);
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = dlId;
      document.body.appendChild(dl);
    }
    dl.innerHTML = "";
    var seen = {};
    var allArrays = [App.stations || [], App.lines || [], App.routes || [], App.polygons || []];
    allArrays.forEach(function (arr) {
      arr.forEach(function (f) {
        var g = f.properties.attributes && f.properties.attributes.group;
        if (g && !seen[g]) {
          seen[g] = true;
          var opt = document.createElement("option");
          opt.value = g;
          dl.appendChild(opt);
        }
      });
    });
    inp.setAttribute("list", dlId);

    inp.addEventListener("change", function () {
      var newVal = inp.value.trim();
      if (newVal) {
        attrs[field.key] = newVal;
        // Inherit color from an existing feature in the same group (any type)
        var existingColor = null;
        allArrays.forEach(function (arr) {
          arr.forEach(function (f) {
            if (!existingColor && f.properties.color && f.properties !== feature.properties) {
              var g = f.properties.attributes && f.properties.attributes.group;
              if (g === newVal) existingColor = f.properties.color;
            }
          });
        });
        if (existingColor) {
          feature.properties.color = existingColor;
          // Trigger re-render for this feature type
          if (typeof App.updateFeatureColor === "function") {
            // Find this feature's index in its array
            var arrMap = { station: App.stations, line: App.lines, route: App.routes, polygon: App.polygons };
            var arr = arrMap[featureType] || [];
            var idx = arr.indexOf(feature);
            if (idx >= 0) App.updateFeatureColor(featureType, idx, existingColor);
          }
        }
      } else {
        delete attrs[field.key];
      }
      saveAttrCache();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") inp.blur();
    });
    return { el: inp, unit: null };
  }

  function buildFieldInput(field, attrs, feature, featureType) {
    if (field.key === "associatedRoutes") return buildRoutePicker(attrs);
    if (field.type === "select")      return buildSelect(field, attrs);
    if (field.type === "checkboxes")  return buildCheckboxes(field, attrs);
    if (field.type === "color")       return buildColorPicker(field, attrs, feature);
    if (field.groupPicker)            return buildUniversalGroupPicker(field, attrs, feature, featureType);
    if (field.key === "labelGroup")   return buildLabelGroupPicker(field, attrs, feature);
    return buildTextOrNumber(field, attrs);
  }

  function buildRow(labelText, inputEl, unitText) {
    var row = document.createElement("div");
    row.className = "fp-attr-row";
    var lbl = document.createElement("label");
    lbl.className = "fp-attr-label";
    lbl.textContent = labelText;
    row.appendChild(lbl);
    row.appendChild(inputEl);
    if (unitText) {
      var unit = document.createElement("span");
      unit.className = "fp-attr-unit";
      unit.textContent = unitText;
      row.appendChild(unit);
    }
    return row;
  }

  /* ---- Floating popup singleton ---- */

  var _popupEl     = null;   // DOM element, created once
  var _currentType = null;   // featureType currently shown
  var _currentIdx  = null;   // featureIndex currently shown
  var _dragState   = null;   // { startX, startY, initLeft, initTop } while dragging

  function buildPopupEl() {
    if (_popupEl) return;

    var el = document.createElement("div");
    el.id = "fp-attr-popup";
    el.style.display = "none";
    el.style.left = "258px";
    el.style.top  = "60px";

    // Header
    var header = document.createElement("div");
    header.className = "fp-attr-popup-header";

    var titleEl = document.createElement("span");
    titleEl.className = "fp-attr-popup-title";
    header.appendChild(titleEl);

    var closeBtn = document.createElement("button");
    closeBtn.className = "fp-attr-popup-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeAttrPopup();
    });
    header.appendChild(closeBtn);
    el.appendChild(header);

    // Body
    var body = document.createElement("div");
    body.className = "fp-attr-popup-body";
    el.appendChild(body);

    document.body.appendChild(el);
    _popupEl = el;

    // ---- Drag support ----
    header.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target === closeBtn || closeBtn.contains(e.target)) return;
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      _dragState = {
        startX:   e.clientX,
        startY:   e.clientY,
        initLeft: rect.left,
        initTop:  rect.top
      };
      header.classList.add("dragging");
    });

    document.addEventListener("mousemove", function (e) {
      if (!_dragState) return;
      var dx = e.clientX - _dragState.startX;
      var dy = e.clientY - _dragState.startY;
      applyClampedPosition(_dragState.initLeft + dx, _dragState.initTop + dy);
    });

    document.addEventListener("mouseup", function () {
      if (_dragState) {
        _dragState = null;
        var hdr = _popupEl && _popupEl.querySelector(".fp-attr-popup-header");
        if (hdr) hdr.classList.remove("dragging");
      }
    });

    // ---- Escape key ----
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && _popupEl && _popupEl.style.display !== "none") {
        closeAttrPopup();
      }
    });

    // ---- Window resize: keep popup within viewport ----
    window.addEventListener("resize", function () {
      if (_popupEl && _popupEl.style.display !== "none") {
        var r = _popupEl.getBoundingClientRect();
        applyClampedPosition(r.left, r.top);
      }
    });
  }

  function applyClampedPosition(left, top) {
    if (!_popupEl) return;
    var pw = _popupEl.offsetWidth  || 320;
    var ph = _popupEl.offsetHeight || 200;
    var minVisible = 40; // keep at least 40px of the popup visible on each side
    left = Math.max(-(pw - minVisible), Math.min(left, window.innerWidth  - minVisible));
    top  = Math.max(0,                  Math.min(top,  window.innerHeight - minVisible));
    _popupEl.style.left = left + "px";
    _popupEl.style.top  = top  + "px";
  }

  function populatePopupBody(featureType, featureIndex, feature) {
    buildPopupEl();

    // Update header title
    _popupEl.querySelector(".fp-attr-popup-title").textContent =
      (TYPE_LABELS[featureType] || featureType) + " Attributes";

    // Update or create color swatch in header
    var headerEl = _popupEl.querySelector(".fp-attr-popup-header");
    var existingSwatch = headerEl.querySelector(".fp-attr-popup-swatch");
    if (existingSwatch) existingSwatch.remove();
    var featureColor = feature.properties.color ||
      (typeof App.getTypeDefaultColor === "function" ? App.getTypeDefaultColor(featureType) : "#999");
    var hdrSwatch = document.createElement("button");
    hdrSwatch.className = "fp-attr-popup-swatch";
    hdrSwatch.style.background = featureColor;
    hdrSwatch.title = "Change color";
    (function (sw, ft, fi, feat) {
      sw.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof App.openColorPicker === "function") {
          App.openColorPicker(sw, feat.properties.color || sw.style.background, function (newColor) {
            feat.properties.color = newColor;
            sw.style.background = newColor;
            if (typeof App.updateFeatureColor === "function") App.updateFeatureColor(ft, fi, newColor);
          });
        }
      });
    })(hdrSwatch, featureType, featureIndex, feature);
    // Insert swatch before title
    var titleEl = headerEl.querySelector(".fp-attr-popup-title");
    headerEl.insertBefore(hdrSwatch, titleEl);

    // Clear and rebuild body
    var body = _popupEl.querySelector(".fp-attr-popup-body");
    body.innerHTML = "";

    // Lazy-init attributes
    if (!feature.properties.attributes) feature.properties.attributes = {};
    var attrs = feature.properties.attributes;

    // Name row (always present)
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "fp-attr-input";
    nameInput.value = feature.properties.name || "";
    nameInput.addEventListener("change", function () {
      feature.properties.name = nameInput.value;
      // Keep the feature row's fp-name display in sync
      var items = document.querySelectorAll(".fp-item");
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.dataset.featureType === featureType &&
            parseInt(el.dataset.featureIndex, 10) === featureIndex) {
          var rowName = el.querySelector(".fp-name");
          if (rowName) rowName.textContent = nameInput.value;
          break;
        }
      }
      saveAttrCache();
    });
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") nameInput.blur();
    });
    body.appendChild(buildRow("Name", nameInput, null));

    // Type-specific fields
    var fields = ATTR_FIELDS[featureType] || [];
    fields.forEach(function (field) {
      if (field.hidden) return;
      var result = buildFieldInput(field, attrs, feature, featureType);
      body.appendChild(buildRow(field.label, result.el, result.unit));
    });

    // Label-specific: sync attribute changes to marker appearance
    if (featureType === "label") {
      body.addEventListener("change", function () {
        if (attrs.text      !== undefined) feature.properties.text      = attrs.text;
        if (attrs.fontSize  !== undefined) feature.properties.fontSize  = attrs.fontSize;
        if (attrs.bgColor   !== undefined) { feature.properties.bgColor = attrs.bgColor; feature.properties.color = attrs.bgColor; }
        if (attrs.textColor !== undefined) feature.properties.textColor = attrs.textColor;
        if (typeof App.updateLabelAppearance === "function") {
          App.updateLabelAppearance(featureIndex);
        }
      });
    }

    _currentType = featureType;
    _currentIdx  = featureIndex;
  }

  /* ---- Public API ---- */

  App.openAttrPopup = function (featureType, featureIndex, feature) {
    buildPopupEl();

    // Toggle: clicking gear on the same feature closes the popup
    if (_popupEl.style.display !== "none" &&
        _currentType === featureType && _currentIdx === featureIndex) {
      closeAttrPopup();
      return;
    }

    var wasOpen = (_popupEl.style.display !== "none");
    populatePopupBody(featureType, featureIndex, feature);

    // Only reset position when opening fresh (preserve dragged position when switching features)
    if (!wasOpen) {
      _popupEl.style.left = "320px";
      _popupEl.style.top  = "60px";
    }
    _popupEl.style.display = "";
  };

  function closeAttrPopup() {
    if (_popupEl) _popupEl.style.display = "none";
    _currentType = null;
    _currentIdx  = null;
  }

  App.closeAttrPopup    = closeAttrPopup;
  App.isAttrPopupOpen   = function () { return !!(_popupEl && _popupEl.style.display !== "none"); };
  App.getAttrPopupFeature = function () {
    if (!App.isAttrPopupOpen()) return null;
    return { featureType: _currentType, featureIndex: _currentIdx };
  };

})();
