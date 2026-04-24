// js/projects/route-costing.js
// Route Costing: high-level transit service costing module. Reads feature
// attributes (length, avg speed, direction, service bands) and module-wide
// Costing Settings to estimate daily/annual operating cost, trips, rev-hrs,
// plat-hrs, and peak vehicles per Service.
//
// Depends on: App namespace, App.popup, App.cache (session persistence).
// Step 2: skeleton — registration, popup wiring, Settings modal only.
// No public API.

(function () {
  "use strict";
  var App = window.App = window.App || {};

  // ---- Defaults (module-wide costing settings) ----

  var DEFAULT_SETTINGS = {
    costPerHour:    150,    // $ per platform hour
    deadheadPct:    15,     // % added to revenue hours to get platform hours
    layoverMode:    "minutes", // "minutes" | "percent"
    layoverValue:   10,     // minutes or percent (per mode)
    daysWeekday:    255,
    daysSaturday:   52,
    daysSunday:     58,
    spareRatio:     15,     // % added to peak vehicles for planning fleet
    costBasisYear:  ""      // free-text label (e.g. "2024 NTD")
  };

  // ---- Module-local state ----

  var _settings        = Object.assign({}, DEFAULT_SETTINGS);
  var _pendingSettings = null;    // temp copy while Settings modal is open
  var _lastServices    = null;    // last-assembled Service[] from buildServicesFromFeatures()
  var _lastResult      = null;    // { services:[...], summary:{...}, settings } (Step 5)
  var _stale           = false;
  var _running         = false;
  var _initialized     = false;

  // ---- DOM guard: only touch DOM when this module's popup is open ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "route-costing";
  }

  // ---- Status ----

  function setStatus(msg, kind) {
    if (!isPopupVisible()) return;
    var el = document.getElementById("rcStatus");
    var txt = document.getElementById("rcStatusText");
    if (!el || !txt) return;
    if (!msg) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.className = "rf-status" + (kind ? " " + kind : "");
    txt.textContent = msg;
  }

  // ---- Costing Settings modal ----

  function openSettingsModal() {
    _pendingSettings = Object.assign({}, _settings);
    syncSettingsToInputs(_pendingSettings);
    var modal = document.getElementById("rcSettingsModal");
    if (modal) modal.style.display = "flex";
  }

  function closeSettingsModal(confirm) {
    if (confirm) {
      _settings = Object.assign({}, _pendingSettings);
      if (_lastResult) markStale();
      if (App.cache) App.cache.save();
    }
    _pendingSettings = null;
    var modal = document.getElementById("rcSettingsModal");
    if (modal) modal.style.display = "none";
  }

  function resetSettingsToDefaults() {
    _pendingSettings = Object.assign({}, DEFAULT_SETTINGS);
    syncSettingsToInputs(_pendingSettings);
  }

  function syncSettingsToInputs(s) {
    var byId = function (id) { return document.getElementById(id); };
    if (byId("rcCostPerHour"))   byId("rcCostPerHour").value   = s.costPerHour;
    if (byId("rcDeadheadPct"))   byId("rcDeadheadPct").value   = s.deadheadPct;
    if (byId("rcLayoverValue"))  byId("rcLayoverValue").value  = s.layoverValue;
    if (byId("rcDaysWeekday"))   byId("rcDaysWeekday").value   = s.daysWeekday;
    if (byId("rcDaysSaturday"))  byId("rcDaysSaturday").value  = s.daysSaturday;
    if (byId("rcDaysSunday"))    byId("rcDaysSunday").value    = s.daysSunday;
    if (byId("rcSpareRatio"))    byId("rcSpareRatio").value    = s.spareRatio;
    if (byId("rcCostBasisYear")) byId("rcCostBasisYear").value = s.costBasisYear || "";
    var radios = document.querySelectorAll('input[name="rcLayoverMode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = (radios[i].value === s.layoverMode);
    }
    updateLayoverUnitLabel();
    updateDaysSum();
  }

  function readSettingsFromInputs() {
    var byId = function (id) { return document.getElementById(id); };
    var num = function (el, def) {
      var v = el ? parseFloat(el.value) : NaN;
      return isFinite(v) ? v : def;
    };
    var mode = "minutes";
    var radios = document.querySelectorAll('input[name="rcLayoverMode"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) { mode = radios[i].value; break; }
    }
    _pendingSettings = {
      costPerHour:   num(byId("rcCostPerHour"),   DEFAULT_SETTINGS.costPerHour),
      deadheadPct:   num(byId("rcDeadheadPct"),   DEFAULT_SETTINGS.deadheadPct),
      layoverMode:   mode,
      layoverValue:  num(byId("rcLayoverValue"),  DEFAULT_SETTINGS.layoverValue),
      daysWeekday:   num(byId("rcDaysWeekday"),   DEFAULT_SETTINGS.daysWeekday),
      daysSaturday:  num(byId("rcDaysSaturday"),  DEFAULT_SETTINGS.daysSaturday),
      daysSunday:    num(byId("rcDaysSunday"),    DEFAULT_SETTINGS.daysSunday),
      spareRatio:    num(byId("rcSpareRatio"),    DEFAULT_SETTINGS.spareRatio),
      costBasisYear: (byId("rcCostBasisYear") && byId("rcCostBasisYear").value) || ""
    };
  }

  function updateLayoverUnitLabel() {
    var label = document.getElementById("rcLayoverValueLabel");
    if (!label) return;
    var mode = "minutes";
    var radios = document.querySelectorAll('input[name="rcLayoverMode"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) { mode = radios[i].value; break; }
    }
    label.textContent = (mode === "percent") ? "Layover (% of round-trip)" : "Layover (min)";
  }

  function updateDaysSum() {
    var byId = function (id) { return document.getElementById(id); };
    var sum = (parseFloat(byId("rcDaysWeekday")  && byId("rcDaysWeekday").value)  || 0)
            + (parseFloat(byId("rcDaysSaturday") && byId("rcDaysSaturday").value) || 0)
            + (parseFloat(byId("rcDaysSunday")   && byId("rcDaysSunday").value)   || 0);
    var out = byId("rcDaysSum");
    var wrap = byId("rcDaysSumWarn");
    if (out) out.textContent = Math.round(sum);
    if (wrap) wrap.style.color = (sum > 366) ? "#c0392b" : "";
  }

  // ---- Service assembly ----

  // Valid direction opposites for 2-pattern Services (sorted, "|"-joined key).
  var VALID_PAIR_KEYS = {
    "NB|SB": true,
    "EB|WB": true,
    "Inbound|Outbound": true,
    "CCW|CW": true
  };

  // Single-pattern directions that represent a complete cycle.
  var SOLO_OK_DIRECTIONS = { "Both": true, "Loop": true, "CW": true, "CCW": true };

  function collectPattern(feature, type, idx) {
    var attrs = (feature.properties && feature.properties.attributes) || {};
    var name  = (feature.properties && feature.properties.name) ||
                (type.charAt(0).toUpperCase() + type.slice(1) + " " + (idx + 1));
    var lengthMi = 0;
    try { lengthMi = (typeof turf !== "undefined") ? turf.length(feature, { units: "miles" }) : 0; }
    catch (e) { lengthMi = 0; }
    var group = attrs.group ? String(attrs.group).trim() : "";
    return {
      featureType:  type,
      featureIndex: idx,
      name:         name,
      direction:    attrs.direction || "Both",
      avgSpeed:     parseFloat(attrs.avgSpeed) || 0,
      group:        group || null,
      lengthMiles:  lengthMi,
      service:      attrs.service || null
    };
  }

  function buildServicesFromFeatures() {
    var services = [];
    var buckets  = {};  // group name -> { name, patterns:[] }

    function add(feature, type, idx) {
      var p = collectPattern(feature, type, idx);
      if (p.group) {
        if (!buckets[p.group]) buckets[p.group] = { name: p.group, patterns: [] };
        buckets[p.group].patterns.push(p);
      } else {
        services.push({
          key:      "solo-" + type + "-" + idx,
          name:     p.name,
          isGroup:  false,
          patterns: [p],
          warnings: []
        });
      }
    }

    (App.routes || []).forEach(function (f, i) { add(f, "route", i); });
    (App.lines  || []).forEach(function (f, i) { add(f, "line",  i); });

    Object.keys(buckets).sort().forEach(function (k) {
      var b = buckets[k];
      services.push({
        key:      "group-" + k,
        name:     b.name,
        isGroup:  true,
        patterns: b.patterns,
        warnings: []
      });
    });

    services.forEach(validateService);
    return services;
  }

  function validateService(svc) {
    var ps = svc.patterns;

    // Hard error: 3+ patterns in a group
    if (ps.length >= 3) {
      svc.warnings.push({
        level: "error",
        msg: ps.length + " patterns in group — v1 supports max 2. Split into separate groups."
      });
      return; // stop; other validations don't matter when the group is invalid
    }

    // 2-pattern: must be valid opposites
    if (ps.length === 2) {
      var key = [ps[0].direction, ps[1].direction].sort().join("|");
      if (!VALID_PAIR_KEYS[key]) {
        svc.warnings.push({
          level: "error",
          msg: "Directions not valid opposites (" + ps[0].direction + " + " + ps[1].direction +
               "). Valid pairs: NB+SB, EB+WB, Inbound+Outbound, CW+CCW."
        });
      }
    }

    // 1-pattern: direction must represent a full cycle
    if (ps.length === 1 && !SOLO_OK_DIRECTIONS[ps[0].direction]) {
      svc.warnings.push({
        level: "error",
        msg: "Single-direction pattern (" + ps[0].direction + ") has no pair. " +
             "Set direction to Both, Loop, CW, or CCW, or group with its opposite."
      });
    }

    // Missing avgSpeed
    ps.forEach(function (p) {
      if (!(p.avgSpeed > 0)) {
        svc.warnings.push({
          level: "error",
          msg: "\"" + p.name + "\" is missing Avg speed."
        });
      }
    });

    // No service bands defined on any pattern
    var hasAnyBand = ps.some(function (p) {
      var s = p.service || {};
      var hasBandWithHeadway = function (arr) {
        return Array.isArray(arr) && arr.some(function (b) {
          var f = parseFloat(b && b.frequency);
          return isFinite(f) && f > 0;
        });
      };
      return hasBandWithHeadway(s.weekday) || hasBandWithHeadway(s.saturday) || hasBandWithHeadway(s.sunday);
    });
    if (!hasAnyBand) {
      svc.warnings.push({
        level: "error",
        msg: "No service bands with a headway defined. Add bands via the Attributes popup."
      });
    }
  }

  function directionSummary(svc) {
    return svc.patterns.map(function (p) { return p.direction; }).join(" + ");
  }

  function hasBlockingWarnings(svc) {
    return svc.warnings.some(function (w) { return w.level === "error"; });
  }

  // ---- Checklist rendering ----

  function buildServiceChecklist() {
    var el = document.getElementById("rcServiceList");
    if (!el) return;

    // Capture existing check state so a rebuild from update() preserves user choices
    var prev = {};
    var prevBoxes = el.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < prevBoxes.length; i++) {
      prev[prevBoxes[i].getAttribute("data-key")] = prevBoxes[i].checked;
    }

    var services = buildServicesFromFeatures();
    _lastServices = services;

    if (!services.length) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">' +
        'No routes or lines drawn. Draw features and set their attributes (direction, speed, service bands) to cost.</div>';
      return;
    }

    var html = "";
    services.forEach(function (svc) {
      var blocked = hasBlockingWarnings(svc);
      var checkedAttr = (prev[svc.key] === false) ? "" : "checked";
      var warnIcon = "";
      if (svc.warnings.length) {
        var tip = svc.warnings.map(function (w) { return w.msg; }).join(" \n");
        warnIcon = ' <span class="rc-warn-badge" title="' + escapeAttr(tip) + '">&#9888;</span>';
      }
      var typeBadge = svc.isGroup
        ? '<span class="rc-pill rc-pill-group">Group</span>'
        : '<span class="rc-pill rc-pill-solo">Solo</span>';

      html +=
        '<label class="rc-service-row' + (blocked ? ' rc-service-blocked' : '') + '">' +
          '<input type="checkbox" data-key="' + escapeAttr(svc.key) + '" ' + checkedAttr + '>' +
          '<span class="rc-service-main">' +
            '<span class="rc-service-name">' + escapeHTML(svc.name) + warnIcon + '</span>' +
            '<span class="rc-service-meta">' +
              typeBadge + ' ' +
              escapeHTML(directionSummary(svc)) + ' &middot; ' +
              svc.patterns.length + ' pattern' + (svc.patterns.length === 1 ? '' : 's') +
            '</span>' +
          '</span>' +
        '</label>';
    });
    el.innerHTML = html;
  }

  function getSelectedServices() {
    if (!_lastServices) return [];
    var el = document.getElementById("rcServiceList");
    if (!el) return [];
    var checks = {};
    var boxes = el.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) {
      checks[boxes[i].getAttribute("data-key")] = boxes[i].checked;
    }
    return _lastServices.filter(function (s) { return checks[s.key]; });
  }

  // ---- Small escapers (no external dep) ----

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHTML(s).replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
  }

  function runCosting() {
    setStatus("Costing engine not yet implemented (Step 4).", "warn");
  }

  function markStale() {
    _stale = true;
    if (isPopupVisible()) setStatus("Settings changed — re-run costing.", "warn");
  }

  // ---- Lifecycle ----

  function init(/* core */) {
    if (_initialized) return;
    _initialized = true;

    var byId = function (id) { return document.getElementById(id); };

    // Settings modal open
    if (byId("rcSettingsBtn")) {
      byId("rcSettingsBtn").addEventListener("click", openSettingsModal);
    }
    // Settings modal actions
    if (byId("rcSettingsConfirm")) {
      byId("rcSettingsConfirm").addEventListener("click", function () {
        readSettingsFromInputs();
        closeSettingsModal(true);
      });
    }
    if (byId("rcSettingsCancel")) {
      byId("rcSettingsCancel").addEventListener("click", function () {
        closeSettingsModal(false);
      });
    }
    if (byId("rcResetSettings")) {
      byId("rcResetSettings").addEventListener("click", resetSettingsToDefaults);
    }
    // Layover mode radios — flip unit label live
    var radios = document.querySelectorAll('input[name="rcLayoverMode"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].addEventListener("change", updateLayoverUnitLabel);
    }
    // Days sum live updater
    ["rcDaysWeekday","rcDaysSaturday","rcDaysSunday"].forEach(function (id) {
      if (byId(id)) byId(id).addEventListener("input", updateDaysSum);
    });

    // Cost Services button
    if (byId("rcCostBtn")) {
      byId("rcCostBtn").addEventListener("click", runCosting);
    }

    // Select all / Clear checklist helpers (checkboxes populated in Step 3)
    if (byId("rcSelectAll")) {
      byId("rcSelectAll").addEventListener("click", function (e) {
        e.preventDefault();
        var boxes = document.querySelectorAll("#rcServiceList input[type=checkbox]");
        for (var j = 0; j < boxes.length; j++) boxes[j].checked = true;
      });
    }
    if (byId("rcSelectNone")) {
      byId("rcSelectNone").addEventListener("click", function (e) {
        e.preventDefault();
        var boxes = document.querySelectorAll("#rcServiceList input[type=checkbox]");
        for (var j = 0; j < boxes.length; j++) boxes[j].checked = false;
      });
    }
  }

  function onOpen(/* core */) {
    buildServiceChecklist();
    // Refresh settings inputs (in case they haven't been touched yet)
    syncSettingsToInputs(_settings);
    setStatus(null);
  }

  function onClose(/* core */) {
    // No cleanup; state lives in closure.
  }

  async function update(/* core */) {
    if (!isPopupVisible()) return;
    buildServiceChecklist();
  }

  function clearAll() {
    _lastResult = null;
    _stale = false;
    if (!isPopupVisible()) return;
    var res = document.getElementById("rcResults");
    var empty = document.getElementById("rcEmptyState");
    if (res) res.style.display = "none";
    if (empty) empty.style.display = "";
    setStatus(null);
  }

  // ---- Register module ----

  App.registerModule({
    id:         "route-costing",
    name:       "Route Costing",
    enabled:    true,
    popupWidth: 960,
    popupHTML:  "projects/route-costing-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    clear:   function ()     { clearAll(); },
    update:  async function (core) { await update(core); }
  });

})();
