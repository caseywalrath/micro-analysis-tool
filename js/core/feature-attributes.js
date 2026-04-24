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

  var TYPE_LABELS = {
    route:   "Route",
    line:    "Line",
    point:   "Point",
    polygon: "Polygon",
    label:   "Label",
    textbox: "Text Box"
  };

  // Service schedule day sections, rendered in this order
  var SERVICE_DAYS = [
    { id: "weekday",  label: "Weekday"  },
    { id: "saturday", label: "Saturday" },
    { id: "sunday",   label: "Sunday"   }
  ];

  // Shared route/line fields — line mirrors route exactly
  var ROUTE_FIELDS = [
    { key: "group",     label: "Group",     type: "text",   placeholder: "e.g. Corridor A", groupPicker: true },
    { key: "direction", label: "Direction", type: "select", options: ["Both","NB","SB","EB","WB","Inbound","Outbound","Loop"] },
    { key: "mode",      label: "Mode",      type: "select", options: ["Bus","BRT","Light Rail","Streetcar"] },
    { key: "routeId",   label: "Route ID",  type: "text",   placeholder: "e.g. 7, Blue" },
    { key: "avgSpeed",  label: "Avg speed", type: "number", unit: "mph", defaultValue: 14 }
  ];

  // Field definitions per feature type.
  // Supported types: "text", "number", "select", "checkboxes"
  var ATTR_FIELDS = {
    route: ROUTE_FIELDS,
    line:  ROUTE_FIELDS,
    point: [
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
      { key: "fontSize",   label: "Size",        type: "select", options: ["Small","Medium","Large","XL"] },
      { key: "bgColor",    label: "Background",  type: "color" },
      { key: "textColor",  label: "Text Color",  type: "color" }
    ],
    textbox: [
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

    var TYPE_TO_ARRAY = { point: "points", line: "lines", polygon: "polygons" };
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
    var allArrays = [App.points || [], App.lines || [], App.routes || [], App.polygons || []];
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
            var arrMap = { point: App.points, line: App.lines, route: App.routes, polygon: App.polygons };
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

  /* ---- Service schedule (Weekday / Saturday / Sunday time bands) ---- */

  function _emptyBand() {
    return { from: "", to: "", frequency: null };
  }

  function _ensureService(attrs) {
    if (!attrs.service) {
      attrs.service = {
        weekday:  [_emptyBand()],
        saturday: [],
        sunday:   [],
        sundayMirrorsSaturday: false
      };
    } else {
      if (!Array.isArray(attrs.service.weekday))  attrs.service.weekday  = [];
      if (!Array.isArray(attrs.service.saturday)) attrs.service.saturday = [];
      if (!Array.isArray(attrs.service.sunday))   attrs.service.sunday   = [];
    }
    return attrs.service;
  }

  function buildServiceSchedule(attrs) {
    var svc = _ensureService(attrs);

    var container = document.createElement("div");
    container.className = "fp-svc";

    var sectionEls = {}; // id → { bandsEl, addBtn, mirrorWrap }

    SERVICE_DAYS.forEach(function (day) {
      var section = document.createElement("div");
      section.className = "fp-svc-section";
      section.dataset.day = day.id;

      var title = document.createElement("div");
      title.className = "fp-svc-section-title";
      title.textContent = day.label;
      section.appendChild(title);

      var header = document.createElement("div");
      header.className = "fp-svc-header";
      ["FROM", "TO", "FREQUENCY"].forEach(function (h) {
        var s = document.createElement("span");
        s.textContent = h;
        header.appendChild(s);
      });
      section.appendChild(header);

      var bandsEl = document.createElement("div");
      bandsEl.className = "fp-svc-bands";
      section.appendChild(bandsEl);

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "fp-svc-add";
      addBtn.textContent = "+ Add time band";
      addBtn.addEventListener("click", function () {
        svc[day.id].push(_emptyBand());
        renderBands(day.id);
        saveAttrCache();
      });
      section.appendChild(addBtn);

      sectionEls[day.id] = { bandsEl: bandsEl, addBtn: addBtn, section: section };
      container.appendChild(section);
    });

    // Mirror Saturday toggle (inside the Sunday section)
    var sundaySection = sectionEls.sunday.section;
    var mirrorWrap = document.createElement("label");
    mirrorWrap.className = "fp-svc-mirror";
    var mirrorCb = document.createElement("input");
    mirrorCb.type = "checkbox";
    mirrorCb.checked = !!svc.sundayMirrorsSaturday;
    mirrorWrap.appendChild(mirrorCb);
    mirrorWrap.appendChild(document.createTextNode(" Mirror Saturday"));
    sundaySection.appendChild(mirrorWrap);
    sectionEls.sunday.mirrorCb = mirrorCb;

    var mirrorPreview = document.createElement("div");
    mirrorPreview.className = "fp-svc-mirror-preview";
    sundaySection.insertBefore(mirrorPreview, sectionEls.sunday.addBtn);
    sectionEls.sunday.mirrorPreview = mirrorPreview;

    mirrorCb.addEventListener("change", function () {
      svc.sundayMirrorsSaturday = mirrorCb.checked;
      applySundayMirrorState();
      saveAttrCache();
    });

    function renderBand(dayId, bandIdx) {
      var band = svc[dayId][bandIdx];
      var row = document.createElement("div");
      row.className = "fp-svc-band";

      var fromInp = document.createElement("input");
      fromInp.type = "text";
      fromInp.className = "fp-svc-time";
      fromInp.placeholder = "HH:MM";
      fromInp.maxLength = 5;
      fromInp.pattern = "^([01][0-9]|2[0-3]):[0-5][0-9]$";
      fromInp.value = band.from || "";
      fromInp.addEventListener("input", function () {
        var v = fromInp.value.replace(/[^0-9:]/g, "");
        if (/^\d{2}$/.test(v)) v = v + ":";
        fromInp.value = v;
      });
      fromInp.addEventListener("blur", function () {
        band.from = /^\d{2}:\d{2}$/.test(fromInp.value) ? fromInp.value : "";
        if (dayId === "saturday") refreshSundayMirrorPreview();
        saveAttrCache();
      });

      var toInp = document.createElement("input");
      toInp.type = "text";
      toInp.className = "fp-svc-time";
      toInp.placeholder = "HH:MM";
      toInp.maxLength = 5;
      toInp.pattern = "^([01][0-9]|2[0-3]):[0-5][0-9]$";
      toInp.value = band.to || "";
      toInp.addEventListener("input", function () {
        var v = toInp.value.replace(/[^0-9:]/g, "");
        if (/^\d{2}$/.test(v)) v = v + ":";
        toInp.value = v;
      });
      toInp.addEventListener("blur", function () {
        band.to = /^\d{2}:\d{2}$/.test(toInp.value) ? toInp.value : "";
        if (dayId === "saturday") refreshSundayMirrorPreview();
        saveAttrCache();
      });

      var everyInp = document.createElement("input");
      everyInp.type = "number";
      everyInp.className = "fp-svc-every";
      everyInp.min = "1";
      everyInp.step = "1";
      everyInp.value = (band.frequency != null) ? band.frequency : "";
      everyInp.addEventListener("change", function () {
        band.frequency = everyInp.value !== "" ? parseFloat(everyInp.value) : null;
        if (dayId === "saturday") refreshSundayMirrorPreview();
        saveAttrCache();
      });

      var unit = document.createElement("span");
      unit.className = "fp-svc-unit";
      unit.textContent = "min";

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "fp-svc-del";
      delBtn.title = "Remove time band";
      delBtn.innerHTML = "&times;";
      delBtn.addEventListener("click", function () {
        svc[dayId].splice(bandIdx, 1);
        renderBands(dayId);
        if (dayId === "saturday") refreshSundayMirrorPreview();
        saveAttrCache();
      });

      row.appendChild(fromInp);
      row.appendChild(toInp);
      row.appendChild(everyInp);
      row.appendChild(unit);
      row.appendChild(delBtn);
      return row;
    }

    function renderBands(dayId) {
      var bandsEl = sectionEls[dayId].bandsEl;
      bandsEl.innerHTML = "";
      svc[dayId].forEach(function (_, i) {
        bandsEl.appendChild(renderBand(dayId, i));
      });
    }

    function refreshSundayMirrorPreview() {
      if (!svc.sundayMirrorsSaturday) return;
      var preview = sectionEls.sunday.mirrorPreview;
      preview.innerHTML = "";
      if (!svc.saturday.length) {
        var empty = document.createElement("div");
        empty.className = "fp-svc-mirror-empty";
        empty.textContent = "Saturday has no service bands.";
        preview.appendChild(empty);
        return;
      }
      svc.saturday.forEach(function (band) {
        var row = document.createElement("div");
        row.className = "fp-svc-band fp-svc-band-readonly";
        var f = document.createElement("span"); f.className = "fp-svc-time-ro"; f.textContent = band.from || "—";
        var t = document.createElement("span"); t.className = "fp-svc-time-ro"; t.textContent = band.to || "—";
        var e = document.createElement("span"); e.className = "fp-svc-every-ro"; e.textContent = (band.frequency != null) ? band.frequency : "—";
        var u = document.createElement("span"); u.className = "fp-svc-unit";   u.textContent = "min";
        row.appendChild(f); row.appendChild(t); row.appendChild(e); row.appendChild(u);
        preview.appendChild(row);
      });
    }

    function applySundayMirrorState() {
      var s = sectionEls.sunday;
      if (svc.sundayMirrorsSaturday) {
        s.bandsEl.style.display = "none";
        s.addBtn.style.display = "none";
        s.mirrorPreview.style.display = "";
        refreshSundayMirrorPreview();
      } else {
        s.bandsEl.style.display = "";
        s.addBtn.style.display = "";
        s.mirrorPreview.style.display = "none";
        s.mirrorPreview.innerHTML = "";
      }
    }

    // Initial render
    SERVICE_DAYS.forEach(function (day) { renderBands(day.id); });
    applySundayMirrorState();

    return container;
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

  function fmtLength(miles) {
    if (miles < 0.1) {
      var ft = miles * 5280;
      return ft < 10 ? ft.toFixed(1) + " ft" : Math.round(ft) + " ft";
    }
    return miles < 10 ? miles.toFixed(2) + " mi" : miles.toFixed(1) + " mi";
  }

  function fmtArea(sqMeters) {
    var acres   = sqMeters * 0.000247105;
    var sqMiles = sqMeters * 3.861e-7;
    if (acres < 1)   return Math.round(sqMeters).toLocaleString() + " m\u00B2";
    if (acres < 640) return acres.toFixed(1) + " acres";
    return sqMiles.toFixed(2) + " mi\u00B2";
  }

  function buildReadOnlyValue(text) {
    var span = document.createElement("span");
    span.className = "fp-attr-unit";
    span.textContent = text;
    return span;
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

  // SVG icons for per-feature override buttons
  var _OVR_OPACITY_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="6" stroke-dasharray="3 2"/></svg>';
  var _OVR_BUFFER_SVG  = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/></svg>';
  var _OVR_WIDTH_SVG   = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8" stroke-width="2.5"/></svg>';
  var _OVR_DEFAULT_SVG = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 6.5A4 4 0 1 1 8 2.5"/><polyline points="8 0.5 10.5 2.5 8 4.5"/></svg>';

  // Push updated feature GeoJSON data to MapLibre source so data-driven
  // paint expressions pick up any changed feature.properties immediately.
  // (The wrapped render functions also re-apply paint expressions via _wrapRender.)
  function _pushFeatureLayer(ft) {
    var fnName = { point: "renderPointLayers", line: "renderLineLayers",
                   route: "renderRouteLayers", polygon: "renderPolygonLayers" }[ft];
    if (fnName && typeof App[fnName] === "function") App[fnName]();
  }

  // Inverse of _polyOpacityValues fill component → returns S (0–100)
  function _invertPolyFillOpacity(fill) {
    if (fill <= 0.15) return Math.round(fill * 50 / 0.15);
    return Math.round(50 + (fill - 0.15) * 50 / 0.85);
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

    // Remove existing overrides container, then rebuild it
    var existingOverrides = headerEl.querySelector(".fp-attr-overrides");
    if (existingOverrides) existingOverrides.remove();

    var closeBtn = headerEl.querySelector(".fp-attr-popup-close");
    var overrides = document.createElement("div");
    overrides.className = "fp-attr-overrides";

    if (featureType !== "label" && featureType !== "textbox") {
      // Per-type key mappings
      var TYPE_KEYS = {
        point:   { opacityKey: "pointOpacity",   widthKey: "pointLineWidth",   bufferKey: "bufferRadius" },
        line:    { opacityKey: "lineOpacity",     widthKey: "lineLineWidth",    bufferKey: "lineBufferRadius" },
        route:   { opacityKey: "routeOpacity",    widthKey: "routeLineWidth",   bufferKey: "routeBufferRadius" },
        polygon: { opacityKey: "polygonOpacity",  widthKey: "polygonLineWidth", bufferKey: null }
      };
      var REBUILD_FNS = {
        point:  function (v) { if (typeof App.rebuildBuffers      === "function") App.rebuildBuffers(v); },
        line:   function (v) { if (typeof App.rebuildLineBuffers  === "function") App.rebuildLineBuffers(v); },
        route:  function (v) { if (typeof App.rebuildRouteBuffers === "function") App.rebuildRouteBuffers(v); },
        polygon: null
      };
      var keys = TYPE_KEYS[featureType] || TYPE_KEYS.point;
      var rebuildFn = REBUILD_FNS[featureType] || null;

      // ---- Opacity button ----
      var opacityBtn = document.createElement("button");
      opacityBtn.type = "button";
      opacityBtn.className = "fp-sib";
      opacityBtn.title = "Per-feature opacity";
      opacityBtn.innerHTML = _OVR_OPACITY_SVG;
      if (feature.properties._opacity != null || feature.properties._fillOpacity != null) {
        opacityBtn.classList.add("fp-sib-has-override");
      }
      (function (btn, feat, ft, ok) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var curVal;
          if (ft === "polygon") {
            curVal = (feat.properties._fillOpacity != null)
              ? _invertPolyFillOpacity(feat.properties._fillOpacity)
              : (App.featureSettings ? App.featureSettings[ok] : 50);
          } else {
            curVal = (feat.properties._opacity != null)
              ? feat.properties._opacity * 100
              : (App.featureSettings ? App.featureSettings[ok] : 100);
          }
          if (typeof App._openFpSlider === "function") {
            App._openFpSlider(btn, {
              min: 0, max: 100, step: 1, unit: "%",
              value: curVal,
              onChange: function (S) {
                if (ft === "polygon") {
                  var pc = App._polyOpacityValues(S);
                  feat.properties._fillOpacity   = pc.fill;
                  feat.properties._borderOpacity = pc.border;
                } else {
                  feat.properties._opacity = S / 100;
                }
                _pushFeatureLayer(ft);
                if (typeof App.cache !== "undefined") App.cache.save();
              }
            });
          }
        });
      })(opacityBtn, feature, featureType, keys.opacityKey);
      overrides.appendChild(opacityBtn);

      // ---- Buffer button (not for polygons) ----
      if (featureType !== "polygon") {
        var bufferBtn = document.createElement("button");
        bufferBtn.type = "button";
        bufferBtn.className = "fp-sib";
        bufferBtn.title = "Per-feature buffer radius";
        bufferBtn.innerHTML = _OVR_BUFFER_SVG;
        if (feature.properties._bufferRadius != null) {
          bufferBtn.classList.add("fp-sib-has-override");
        }
        (function (btn, feat, bk, rbFn) {
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            var curVal = (feat.properties._bufferRadius != null)
              ? feat.properties._bufferRadius
              : (App.featureSettings ? App.featureSettings[bk] : 0);
            if (typeof App._openFpSlider === "function") {
              App._openFpSlider(btn, {
                min: 0, max: 2, step: 0.1, unit: "mi",
                value: curVal,
                onChange: function (v) {
                  feat.properties._bufferRadius = v;
                  if (rbFn) rbFn(App.featureSettings ? App.featureSettings[bk] : 0);
                  if (typeof App.cache !== "undefined") App.cache.save();
                }
              });
            }
          });
        })(bufferBtn, feature, keys.bufferKey, rebuildFn);
        overrides.appendChild(bufferBtn);
      }

      // ---- Width button ----
      var widthBtn = document.createElement("button");
      widthBtn.type = "button";
      widthBtn.className = "fp-sib";
      widthBtn.title = "Per-feature line width";
      widthBtn.innerHTML = _OVR_WIDTH_SVG;
      if (feature.properties._lineWidth != null) {
        widthBtn.classList.add("fp-sib-has-override");
      }
      (function (btn, feat, ft, wk) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var curVal = (feat.properties._lineWidth != null)
            ? feat.properties._lineWidth
            : (App.featureSettings ? App.featureSettings[wk] : 1);
          if (typeof App._openFpSlider === "function") {
            App._openFpSlider(btn, {
              min: 0, max: 5, step: 0.1, unit: "×",
              value: curVal,
              onChange: function (v) {
                feat.properties._lineWidth = v;
                _pushFeatureLayer(ft);
                if (typeof App.cache !== "undefined") App.cache.save();
              }
            });
          }
        });
      })(widthBtn, feature, featureType, keys.widthKey);
      overrides.appendChild(widthBtn);

      // ---- Default (reset) button ----
      var defaultBtn = document.createElement("button");
      defaultBtn.type = "button";
      defaultBtn.className = "fp-sib";
      defaultBtn.title = "Reset to global defaults";
      defaultBtn.innerHTML = _OVR_DEFAULT_SVG;
      (function (btn, feat, ft, bk, rbFn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          delete feat.properties._opacity;
          delete feat.properties._fillOpacity;
          delete feat.properties._borderOpacity;
          delete feat.properties._lineWidth;
          delete feat.properties._bufferRadius;
          _pushFeatureLayer(ft);
          if (rbFn) rbFn(App.featureSettings ? (App.featureSettings[bk] || 0) : 0);
          if (typeof App.cache !== "undefined") App.cache.save();
          if (typeof App._closeFpSlider === "function") App._closeFpSlider();
          // Remove has-override indicators
          overrides.querySelectorAll(".fp-sib-has-override").forEach(function (el) {
            el.classList.remove("fp-sib-has-override");
          });
        });
      })(defaultBtn, feature, featureType, keys.bufferKey, rebuildFn);
      overrides.appendChild(defaultBtn);
    }

    headerEl.insertBefore(overrides, closeBtn);

    // Clear and rebuild body
    var body = _popupEl.querySelector(".fp-attr-popup-body");
    body.innerHTML = "";

    // Lazy-init attributes
    if (!feature.properties.attributes) feature.properties.attributes = {};
    var attrs = feature.properties.attributes;

    // Seed field defaults for any missing values (e.g. avgSpeed = 14 mph)
    var typeFields = ATTR_FIELDS[featureType] || [];
    var seededDefault = false;
    typeFields.forEach(function (f) {
      if (f.defaultValue !== undefined && (attrs[f.key] === undefined || attrs[f.key] === null || attrs[f.key] === "")) {
        attrs[f.key] = f.defaultValue;
        seededDefault = true;
      }
    });
    if (seededDefault) saveAttrCache();

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
      // For labels, name IS the displayed map text — update the marker
      if (featureType === "label" && typeof App.updateLabelAppearance === "function") {
        App.updateLabelAppearance(featureIndex);
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

    // Service schedule (routes and lines only) — full-width, below regular fields
    if (featureType === "route" || featureType === "line") {
      body.appendChild(buildServiceSchedule(attrs));
    }

    // Computed measurements (read-only)
    if ((featureType === "route" || featureType === "line") &&
        feature.geometry && feature.geometry.coordinates &&
        feature.geometry.coordinates.length >= 2) {
      var lenMi = turf.length(feature, { units: "miles" });
      body.appendChild(buildRow("Length", buildReadOnlyValue(fmtLength(lenMi)), null));
    }

    if (featureType === "polygon" &&
        feature.geometry && feature.geometry.coordinates &&
        feature.geometry.coordinates[0] &&
        feature.geometry.coordinates[0].length >= 3) {
      var ring    = feature.geometry.coordinates[0];
      var perimMi = turf.length(turf.lineString(ring), { units: "miles" });
      var areaSqM = turf.area(feature);
      body.appendChild(buildRow("Perimeter", buildReadOnlyValue(fmtLength(perimMi)), null));
      body.appendChild(buildRow("Area",      buildReadOnlyValue(fmtArea(areaSqM)),   null));
    }

    // Label/textbox: sync attribute changes to marker appearance
    if (featureType === "label" || featureType === "textbox") {
      body.addEventListener("change", function () {
        if (attrs.fontSize  !== undefined) feature.properties.fontSize  = attrs.fontSize;
        if (attrs.bgColor   !== undefined) { feature.properties.bgColor = attrs.bgColor; feature.properties.color = attrs.bgColor; }
        if (attrs.textColor !== undefined) feature.properties.textColor = attrs.textColor;
        var updFn = featureType === "label" ? App.updateLabelAppearance : App.updateTextBoxAppearance;
        if (typeof updFn === "function") updFn(featureIndex);
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
