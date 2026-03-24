// js/core/feature-attributes.js
// Per-feature attribute panel: slide-down form that opens below each feature
// panel row. Supports different field sets per feature type.
// Exports: App.buildAttrPanel(featureType, featureIndex, feature, onDelete)
//          App.toggleAttrPanel(itemEl)

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
    station: "Station",
    polygon: "Polygon",
    label:   "Label"
  };

  // Field definitions per feature type.
  // Supported types: "text", "number", "select", "checkboxes"
  var ATTR_FIELDS = {
    route: [
      { key: "routeGroup",    label: "Route Group", type: "text",       placeholder: "e.g. Route 7" },
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
      { key: "lineMode", label: "Mode",  type: "select", options: ["Light Rail","Commuter Rail","Streetcar","Bus","BRT"] },
      { key: "notes",    label: "Notes", type: "text",   placeholder: "" }
    ],
    station: [],
    polygon: [
      { key: "notes", label: "Notes", type: "text", placeholder: "" }
    ],
    label: [
      { key: "labelGroup", label: "Label Group", type: "text",   placeholder: "e.g. Route Numbers" },
      { key: "text",       label: "Text",        type: "text",   placeholder: "Map text" },
      { key: "fontSize",   label: "Size",        type: "select", options: ["Small","Medium","Large","XL"] },
      { key: "bgColor",    label: "Background",  type: "color" },
      { key: "textColor",  label: "Text Color",  type: "color" }
    ]
  };

  var TRASH_SVG =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '</svg>';

  function saveAttrCache() {
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
          // Fire change event so panel-level listener can update marker appearance
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

  function buildFieldInput(field, attrs, feature) {
    if (field.type === "select")      return buildSelect(field, attrs);
    if (field.type === "checkboxes")  return buildCheckboxes(field, attrs);
    if (field.type === "color")       return buildColorPicker(field, attrs, feature);
    if (field.key === "routeGroup")   return buildGroupPicker(field, attrs, feature);
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

  /* ---- Public: build the attribute panel div ---- */

  App.buildAttrPanel = function (featureType, featureIndex, feature, onDelete) {
    // Lazy-init: attributes stored directly on the feature's properties
    if (!feature.properties.attributes) feature.properties.attributes = {};
    var attrs = feature.properties.attributes;

    var panel = document.createElement("div");
    panel.className = "fp-attr-panel";
    panel.style.display = "none";

    // --- Top bar: label + delete icon ---
    var topbar = document.createElement("div");
    topbar.className = "fp-attr-topbar";
    var title = document.createElement("span");
    title.className = "fp-attr-title";
    title.textContent = (TYPE_LABELS[featureType] || featureType) + " Attributes";
    topbar.appendChild(title);

    var delBtn = document.createElement("button");
    delBtn.className = "fp-attr-delete";
    delBtn.title = "Delete feature";
    delBtn.innerHTML = TRASH_SVG;
    topbar.appendChild(delBtn);
    panel.appendChild(topbar);

    // --- Inline delete confirmation ---
    var confirmRow = document.createElement("div");
    confirmRow.className = "fp-attr-confirm";
    confirmRow.style.display = "none";
    var confirmText = document.createElement("span");
    confirmText.textContent = "Delete this feature?";
    var yesBtn = document.createElement("button");
    yesBtn.className = "fp-attr-confirm-yes";
    yesBtn.textContent = "Delete";
    var noBtn = document.createElement("button");
    noBtn.className = "fp-attr-confirm-no";
    noBtn.textContent = "Cancel";
    confirmRow.appendChild(confirmText);
    confirmRow.appendChild(yesBtn);
    confirmRow.appendChild(noBtn);
    panel.appendChild(confirmRow);

    delBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      confirmRow.style.display = "";
      delBtn.style.display = "none";
    });
    yesBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof onDelete === "function") onDelete();
    });
    noBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      confirmRow.style.display = "none";
      delBtn.style.display = "";
    });

    // --- Name row (always present) ---
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "fp-attr-input";
    nameInput.value = feature.properties.name || "";
    nameInput.addEventListener("change", function () {
      feature.properties.name = nameInput.value;
      // Keep the row's fp-name input in sync
      var wrapper = panel.parentElement;
      if (wrapper) {
        var rowName = wrapper.querySelector(".fp-name");
        if (rowName) rowName.textContent = nameInput.value;
      }
      saveAttrCache();
    });
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") nameInput.blur();
    });
    panel.appendChild(buildRow("Name", nameInput, null));

    // --- Type-specific fields ---
    var fields = ATTR_FIELDS[featureType] || [];
    fields.forEach(function (field) {
      var result = buildFieldInput(field, attrs, feature);
      panel.appendChild(buildRow(field.label, result.el, result.unit));
    });

    // --- Label-specific: sync attribute changes to marker appearance ---
    if (featureType === "label") {
      panel.addEventListener("change", function () {
        // Sync stored properties from attributes
        if (attrs.text !== undefined)      feature.properties.text = attrs.text;
        if (attrs.fontSize !== undefined)  feature.properties.fontSize = attrs.fontSize;
        if (attrs.bgColor !== undefined)   { feature.properties.bgColor = attrs.bgColor; feature.properties.color = attrs.bgColor; }
        if (attrs.textColor !== undefined) feature.properties.textColor = attrs.textColor;
        if (typeof App.updateLabelAppearance === "function") {
          App.updateLabelAppearance(featureIndex);
        }
      });
    }

    return panel;
  };

  /* ---- Public: toggle open/closed ---- */

  App.toggleAttrPanel = function (itemEl) {
    var wrapper = itemEl.closest
      ? itemEl.closest(".fp-item-wrapper")
      : itemEl.parentElement;
    if (!wrapper) return;
    var panel = wrapper.querySelector(".fp-attr-panel");
    var btn = itemEl.querySelector(".fp-expand");
    if (!panel) return;

    var isOpen = panel.style.display !== "none";
    panel.style.display = isOpen ? "none" : "";
    if (btn) btn.classList.toggle("open", !isOpen);

    // Reset confirm state when closing
    if (isOpen) {
      var confirmRow = panel.querySelector(".fp-attr-confirm");
      var delBtn = panel.querySelector(".fp-attr-delete");
      if (confirmRow) confirmRow.style.display = "none";
      if (delBtn) delBtn.style.display = "";
    }
  };

})();
