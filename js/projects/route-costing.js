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

  // ---- Placeholders for later steps ----

  function buildServiceChecklist() {
    // Step 3 will populate this; for now show static empty message.
    var el = document.getElementById("rcServiceList");
    if (!el) return;
    var routes = App.routes || [];
    var lines  = App.lines  || [];
    if (!routes.length && !lines.length) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No routes or lines drawn.</div>';
      return;
    }
    el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">' +
      routes.length + ' route(s) + ' + lines.length + ' line(s) detected. ' +
      'Service assembly coming in Step 3.</div>';
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
