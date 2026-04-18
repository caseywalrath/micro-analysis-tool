// js/projects/corridor-scoring.js
// Corridor Scoring: registers as an analysis module, opens in a 2-column popup,
// produces a ranked composite score per selected corridor using the per-route CDI engine.
// Depends on: App namespace, TPI namespace (tpi-scoring.js), RidershipModel (ridership-scoring.js),
//   App.popup (popup.js), turf (CDN).
// Step 1: scaffolding + static Settings column.
// No public API.

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var TPI = window.TPI;

  // ---- Module-local state (persists across popup open/close) ----

  var _weights           = TPI ? TPI.getDefaultWeights() : {};
  var _pendingWeights    = null;   // temp copy while Adjust Weights modal is open (Step 2)
  var _featureFilter     = null;   // { routeIndices, lineIndices } or null (= all)
  var _lastResult        = null;   // { routeCDIs, geoLevel, year, apportionByArea, unionPolygon, weights } (Step 3+)
  var _stale             = false;
  var _running           = false;
  var _initialized       = false;
  var _apportionByArea   = false;

  // ---- DOM guard: only touch DOM when popup is open for this module ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "corridor-scoring";
  }

  // ---- Feature filter helpers (routes + lines only per plan) ----

  function getFeatureFilter() {
    var el = document.getElementById("csFeatureList");
    if (!el) return null;
    var boxes = el.querySelectorAll("input[type=checkbox]");
    if (!boxes.length) return null;
    var routeIndices = [], lineIndices = [];
    var allChecked = true;
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      var type = cb.getAttribute("data-type");
      var idx  = parseInt(cb.getAttribute("data-idx"), 10);
      if (cb.checked) {
        if      (type === "route") routeIndices.push(idx);
        else if (type === "line")  lineIndices.push(idx);
      } else {
        allChecked = false;
      }
    }
    if (allChecked) return null; // no filter needed (all selected)
    return { routeIndices: routeIndices, lineIndices: lineIndices };
  }

  // ---- Feature checklist (routes + lines) ----

  function buildFeatureChecklist() {
    var el = document.getElementById("csFeatureList");
    if (!el) return;

    // Capture current check state before rebuilding
    var prevState = {};
    var prev = el.querySelectorAll("input[type=checkbox]");
    for (var pi = 0; pi < prev.length; pi++) {
      prevState[prev[pi].getAttribute("data-type") + ":" + prev[pi].getAttribute("data-idx")] = prev[pi].checked;
    }

    el.innerHTML = "";
    var hasFeatures = false;

    function addRow(type, idx, name, badge) {
      hasFeatures = true;
      var key = type + ":" + idx;
      var checked = (key in prevState) ? prevState[key] : true;
      var row = document.createElement("div");
      row.className = "rf-feature-check-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-type", type);
      cb.setAttribute("data-idx", String(idx));
      cb.checked = checked;

      var lbl = document.createElement("label");
      lbl.style.cssText = "flex:1;cursor:pointer;";
      lbl.textContent = name;

      var badgeEl = document.createElement("span");
      badgeEl.className = "rf-feature-type-badge";
      badgeEl.textContent = badge;

      lbl.addEventListener("click", function (e) { e.preventDefault(); cb.checked = !cb.checked; markStale(); });
      cb.addEventListener("change", markStale);

      row.appendChild(cb);
      row.appendChild(lbl);
      row.appendChild(badgeEl);
      el.appendChild(row);
    }

    var routes = App.routes || [];
    var lines  = App.lines  || [];

    for (var ri = 0; ri < routes.length; ri++) {
      addRow("route", ri,
        (routes[ri].properties && routes[ri].properties.name) || ("Route " + (ri + 1)),
        "R");
    }
    for (var li = 0; li < lines.length; li++) {
      addRow("line", li,
        (lines[li].properties && lines[li].properties.name) || ("Line " + (li + 1)),
        "L");
    }

    if (!hasFeatures) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No routes or lines drawn.</div>';
    }
  }

  // ---- Weight sliders (inside modal) ----

  function buildWeightSliders() {
    var container = document.getElementById("csWeightSliders");
    if (!container || !TPI) return;
    container.innerHTML = "";

    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (_weights[f.id] != null) ? _weights[f.id] : (f.defaultWeight || 0);

      var row = document.createElement("div");
      row.className = "tpi-slider-row";
      row.innerHTML =
        '<label class="tpi-slider-label" title="' + (f.description || "") + '">' + f.label + '</label>' +
        '<input type="range" class="tpi-slider cs-slider" min="0" max="100" step="5" value="' + w + '" data-factor="' + f.id + '">' +
        '<input type="number" class="tpi-slider-value" id="csW_' + f.id + '" value="' + w + '" min="0" max="100" step="1" data-factor="' + f.id + '">';
      container.appendChild(row);

      var slider   = row.querySelector("input[type=range]");
      var numInput = row.querySelector("input[type=number]");
      slider.addEventListener("input",  onModalSliderChange);
      numInput.addEventListener("change", onModalNumberChange);
    }
    updateModalWeightSum();
  }

  function syncSlidersToWeights(weights) {
    if (!TPI) return;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (weights[f.id] != null) ? weights[f.id] : 0;
      var slider   = document.querySelector('.cs-slider[data-factor="' + f.id + '"]');
      var numInput = document.getElementById("csW_" + f.id);
      if (slider)   slider.value   = String(w);
      if (numInput) numInput.value = String(w);
    }
    updateModalWeightSum();
  }

  function onModalSliderChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    _pendingWeights[factorId] = parseInt(e.target.value, 10);
    var numInput = document.getElementById("csW_" + factorId);
    if (numInput) numInput.value = String(_pendingWeights[factorId]);
    updateModalWeightSum();
  }

  function onModalNumberChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    var raw      = parseInt(e.target.value, 10);
    var clamped  = isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
    e.target.value = String(clamped);
    _pendingWeights[factorId] = clamped;
    var slider = document.querySelector('.cs-slider[data-factor="' + factorId + '"]');
    if (slider) slider.value = String(clamped);
    updateModalWeightSum();
  }

  function updateModalWeightSum() {
    if (!TPI) return 0;
    var weights = _pendingWeights || _weights;
    var sum = 0;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) sum += (weights[factors[i].id] || 0);

    var sumEl      = document.getElementById("csWeightSum");
    var warnEl     = document.getElementById("csWeightWarn");
    var confirmBtn = document.getElementById("csWeightsConfirm");
    if (sumEl)      { sumEl.textContent = String(sum); sumEl.style.color = sum === 100 ? "" : "#e53e3e"; }
    if (warnEl)     warnEl.style.visibility = sum === 100 ? "hidden" : "visible";
    if (confirmBtn) confirmBtn.disabled = (sum !== 100);
    return sum;
  }

  function openWeightsModal() {
    _pendingWeights = Object.assign({}, _weights);
    syncSlidersToWeights(_pendingWeights);
    var modal = document.getElementById("csWeightsModal");
    if (modal) modal.style.display = "";
  }

  function closeWeightsModal(confirm) {
    var modal = document.getElementById("csWeightsModal");
    if (modal) modal.style.display = "none";
    if (confirm && _pendingWeights) {
      var oldJSON = JSON.stringify(_weights);
      _weights    = Object.assign({}, _pendingWeights);
      if (JSON.stringify(_weights) !== oldJSON) markStale();
    }
    _pendingWeights = null;
  }

  function resetModalToDefaults() {
    if (!TPI) return;
    _pendingWeights = TPI.getDefaultWeights();
    syncSlidersToWeights(_pendingWeights);
  }

  // ---- LODES warning icon visibility ----

  function updateLodesWarnings() {
    var warnBtn = document.getElementById("csLodesWarnBtn");
    if (warnBtn) warnBtn.style.display = App.lodesData ? "none" : "";
  }

  // ---- Stale banner (wired in Step 3; stub here for checklist hooks) ----

  function markStale() {
    _stale = true;
    if (!isPopupVisible()) return;
    var banner = document.getElementById("csStaleBanner");
    if (banner && _lastResult) banner.style.display = "";
  }

  // ---- Status helper (filled out in Step 3) ----

  function setStatus(msg) {
    var statusEl = document.getElementById("csStatus");
    var textEl   = document.getElementById("csStatusText");
    if (!statusEl || !textEl) return;
    statusEl.style.display = msg ? "" : "none";
    textEl.textContent = msg || "";
  }

  // ---- Popup lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Geography level change
    var geoLevel = document.getElementById("csGeoLevel");
    if (geoLevel) geoLevel.addEventListener("change", markStale);

    // ACS year change
    var yearSel = document.getElementById("csYearSelect");
    if (yearSel) yearSel.addEventListener("change", markStale);

    // Apportion-by-area checkbox
    var apportionCb = document.getElementById("csApportionByArea");
    if (apportionCb) {
      apportionCb.checked = _apportionByArea;
      apportionCb.addEventListener("change", function () {
        _apportionByArea = apportionCb.checked;
        markStale();
      });
    }

    // Select all / clear
    var selectAll = document.getElementById("csSelectAll");
    if (selectAll) {
      selectAll.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#csFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = true; });
        markStale();
      });
    }
    var selectNone = document.getElementById("csSelectNone");
    if (selectNone) {
      selectNone.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#csFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
        markStale();
      });
    }

    // Adjust Weights modal
    var weightsBtn = document.getElementById("csWeightsBtn");
    if (weightsBtn) weightsBtn.addEventListener("click", openWeightsModal);

    var confirmBtn = document.getElementById("csWeightsConfirm");
    if (confirmBtn) confirmBtn.addEventListener("click", function () { closeWeightsModal(true); });

    var cancelBtn = document.getElementById("csWeightsCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { closeWeightsModal(false); });

    var resetBtn = document.getElementById("csResetWeights");
    if (resetBtn) resetBtn.addEventListener("click", resetModalToDefaults);

    // Score Corridors — wired fully in Step 3. Stub for now.
    var scoreBtn = document.getElementById("csScoreBtn");
    if (scoreBtn) {
      scoreBtn.addEventListener("click", function () {
        setStatus("Scoring flow — coming in Step 3.");
      });
    }

    // Populate weight sliders (in modal) with current _weights
    buildWeightSliders();
  }

  function onOpen(core) {
    var apportionCb = document.getElementById("csApportionByArea");
    if (apportionCb) apportionCb.checked = _apportionByArea;

    buildFeatureChecklist();
    updateLodesWarnings();

    if (_stale) markStale();
  }

  function onClose(core) {
    // State persists in closure
  }

  async function update(core) {
    // Fires on feature/LODES changes even when popup closed — guard DOM writes.
    if (!isPopupVisible()) return;
    buildFeatureChecklist();
    updateLodesWarnings();
  }

  // ---- Register as analysis module ----

  App.registerModule({
    id:         "corridor-scoring",
    name:       "Corridor Scoring",
    enabled:    true,
    popupWidth: 960,
    popupHTML:  "projects/corridor-scoring-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    update:  async function (core) { await update(core); }
  });

})();
