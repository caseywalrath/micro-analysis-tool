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
    var serviceId = attrs.serviceId ? String(attrs.serviceId).trim() : "";
    return {
      featureType:  type,
      featureIndex: idx,
      name:         name,
      direction:    attrs.direction || "Both",
      avgSpeed:     parseFloat(attrs.avgSpeed) || 0,
      serviceId:    serviceId || null,
      lengthMiles:  lengthMi,
      service:      attrs.service || null
    };
  }

  function buildServicesFromFeatures() {
    var services = [];
    var buckets  = {};  // serviceId -> { name, patterns:[] }

    function add(feature, type, idx) {
      var p = collectPattern(feature, type, idx);
      if (p.serviceId) {
        if (!buckets[p.serviceId]) buckets[p.serviceId] = { name: p.serviceId, patterns: [] };
        buckets[p.serviceId].patterns.push(p);
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
        key:      "service-" + k,
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

    // Hard error: 3+ patterns assigned to one Service
    if (ps.length >= 3) {
      svc.warnings.push({
        level: "error",
        msg: ps.length + " patterns assigned to this Service — v1 supports max 2. Split into separate Services."
      });
      return; // stop; other validations don't matter when the Service is invalid
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
             "Set direction to Both, Loop, CW, or CCW, or pair with its opposite under one Service."
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
        ? '<span class="rc-pill rc-pill-group">Paired</span>'
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

  // ---- Cost math (pure functions) ----

  function parseBandTime(s) {
    if (typeof s !== "string") return NaN;
    var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return NaN;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    if (h < 0 || h > 24 || min < 0 || min >= 60) return NaN;
    return h + min / 60;
  }

  function emptyDay() {
    return { trips: 0, revHrs: 0, miles: 0, platHrs: 0, cost: 0 };
  }

  // One-way runtime per pattern, in hours. Requires avgSpeed > 0 (validated upstream).
  function oneWayRuntimeHrs(pattern) {
    if (!(pattern.avgSpeed > 0)) return 0;
    return pattern.lengthMiles / pattern.avgSpeed;
  }

  // Compute round-trip runtime and round-trip miles for a Service.
  // - 2-pattern: sum both one-ways / sum both lengths.
  // - 1-pattern "Both": double one-way / double length.
  // - 1-pattern Loop/CW/CCW: one-way is already the full cycle; length is unchanged.
  function computeRoundTrip(svc) {
    var ps = svc.patterns;
    var oneWays = ps.map(oneWayRuntimeHrs);
    var lenSum  = ps.reduce(function (s, p) { return s + p.lengthMiles; }, 0);
    var oneWaySum = oneWays.reduce(function (s, v) { return s + v; }, 0);

    if (ps.length === 2) {
      return { rtHrs: oneWaySum, rtMiles: lenSum, oneWays: oneWays };
    }
    // Single pattern
    var d = ps[0].direction;
    if (d === "Both") {
      return { rtHrs: 2 * oneWays[0], rtMiles: 2 * ps[0].lengthMiles, oneWays: oneWays };
    }
    // Loop / CW / CCW — one-way IS the full cycle
    return { rtHrs: oneWays[0], rtMiles: ps[0].lengthMiles, oneWays: oneWays };
  }

  function computeLayoverHrs(rtHrs, settings) {
    if (settings.layoverMode === "percent") {
      return rtHrs * (settings.layoverValue / 100);
    }
    return settings.layoverValue / 60;  // minutes → hours
  }

  // Compute one Service's full cost picture. Returns a result object.
  // If the Service has blocking warnings, returns { skipped:true, warnings, name }.
  function computeService(svc, settings) {
    if (hasBlockingWarnings(svc)) {
      return {
        name: svc.name,
        key: svc.key,
        isGroup: svc.isGroup,
        skipped: true,
        warnings: svc.warnings,
        directionSummary: directionSummary(svc),
        patternCount: svc.patterns.length
      };
    }

    var rt = computeRoundTrip(svc);
    var layHrs = computeLayoverHrs(rt.rtHrs, settings);
    var cycleHrs = rt.rtHrs + layHrs;

    var daily = { weekday: emptyDay(), saturday: emptyDay(), sunday: emptyDay() };
    var minHeadway = Infinity;
    var bandRows = [];

    ["weekday", "saturday", "sunday"].forEach(function (day) {
      svc.patterns.forEach(function (p, pi) {
        var bands = (p.service && Array.isArray(p.service[day])) ? p.service[day] : [];
        bands.forEach(function (b) {
          var headway = parseFloat(b && b.frequency);
          if (!(headway > 0)) return;  // skip blank/0 headways (= "no service in this band")

          var from = parseBandTime(b && b.from);
          var to   = parseBandTime(b && b.to);
          if (!isFinite(from) || !isFinite(to)) return;

          var hrs = to - from;
          if (hrs <= 0) hrs += 24;  // handle midnight wrap (e.g. 22:00 → 02:00)
          if (!(hrs > 0)) return;

          var trips     = Math.ceil(hrs * 60 / headway);
          var oneWayHr  = rt.oneWays[pi];
          var bandRevHr = trips * oneWayHr;
          var bandMiles = trips * p.lengthMiles;

          daily[day].trips   += trips;
          daily[day].revHrs  += bandRevHr;
          daily[day].miles   += bandMiles;

          if (headway < minHeadway) minHeadway = headway;

          bandRows.push({
            day:         day,
            patternName: p.name,
            patternIdx:  pi,
            from:        b.from,
            to:          b.to,
            hours:       hrs,
            headwayMin:  headway,
            trips:       trips,
            revHrs:      bandRevHr
          });
        });
      });
    });

    var dh = settings.deadheadPct / 100;
    ["weekday", "saturday", "sunday"].forEach(function (day) {
      daily[day].platHrs = daily[day].revHrs * (1 + dh);
      daily[day].cost    = daily[day].platHrs * settings.costPerHour;
    });

    var daysMap = {
      weekday:  settings.daysWeekday,
      saturday: settings.daysSaturday,
      sunday:   settings.daysSunday
    };

    var annual = { revHrs: 0, platHrs: 0, cost: 0, trips: 0, miles: 0 };
    ["weekday", "saturday", "sunday"].forEach(function (day) {
      var dd = daysMap[day] || 0;
      annual.revHrs  += daily[day].revHrs  * dd;
      annual.platHrs += daily[day].platHrs * dd;
      annual.cost    += daily[day].cost    * dd;
      annual.trips   += daily[day].trips   * dd;
      annual.miles   += daily[day].miles   * dd;
    });

    // Peak vehicles: cycle / min-headway, across all bands/patterns.
    var peakRaw = 0, peakRounded = 0, fleet = 0;
    if (isFinite(minHeadway) && minHeadway > 0) {
      peakRaw     = (cycleHrs * 60) / minHeadway;
      peakRounded = Math.ceil(peakRaw);
      fleet       = Math.ceil(peakRounded * (1 + settings.spareRatio / 100));
    }

    return {
      name:             svc.name,
      key:              svc.key,
      isGroup:          svc.isGroup,
      skipped:          false,
      warnings:         svc.warnings,   // non-blocking warnings if any future soft warnings exist
      patternCount:     svc.patterns.length,
      directionSummary: directionSummary(svc),

      rtMiles:          rt.rtMiles,
      oneWayHrs:        rt.oneWays,     // per-pattern one-way runtimes (hours)
      cycleMin:         cycleHrs * 60,
      layoverMin:       layHrs * 60,
      peakHeadwayMin:   isFinite(minHeadway) ? minHeadway : null,

      daily:  daily,
      annual: annual,

      peakVehiclesRaw:      peakRaw,
      peakVehiclesRounded:  peakRounded,
      fleetWithSpares:      fleet,

      bandBreakdown: bandRows
    };
  }

  function computeSystemSummary(serviceResults, settings) {
    var out = {
      servicesScored:   0,
      servicesSkipped:  0,
      annualCost:       0,
      annualPlatHrs:    0,
      annualRevHrs:     0,
      annualTrips:      0,
      annualMiles:      0,
      dailyTripsWk:     0,
      dailyTripsSa:     0,
      dailyTripsSu:     0,
      fleetSumRounded:  0,   // Σ of each Service's rounded fleet need (standalone)
      fleetSumRaw:      0    // ceil of Σ raw → theoretical floor if perfectly interlined
    };
    var rawSum = 0;
    serviceResults.forEach(function (r) {
      if (r.skipped) { out.servicesSkipped++; return; }
      out.servicesScored++;
      out.annualCost     += r.annual.cost;
      out.annualPlatHrs  += r.annual.platHrs;
      out.annualRevHrs   += r.annual.revHrs;
      out.annualTrips    += r.annual.trips;
      out.annualMiles    += r.annual.miles;
      out.dailyTripsWk   += r.daily.weekday.trips;
      out.dailyTripsSa   += r.daily.saturday.trips;
      out.dailyTripsSu   += r.daily.sunday.trips;
      out.fleetSumRounded += r.peakVehiclesRounded;
      rawSum              += r.peakVehiclesRaw;
    });
    out.fleetSumRaw = Math.ceil(rawSum);
    out.interlineGap = out.fleetSumRounded - out.fleetSumRaw;
    out.costBasisYear = settings.costBasisYear || "";
    return out;
  }

  // ---- Rendering ----

  function fmtInt(v) {
    if (!isFinite(v)) return "—";
    return Math.round(v).toLocaleString();
  }
  function fmtDec(v, digits) {
    if (!isFinite(v)) return "—";
    return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtMoney(v) {
    if (!isFinite(v)) return "—";
    return "$" + Math.round(v).toLocaleString();
  }
  function fmtHeadway(v) {
    if (v == null || !isFinite(v)) return "—";
    return Math.round(v) + " min";
  }
  var DAY_LABELS = { weekday: "Weekday", saturday: "Saturday", sunday: "Sunday" };

  function renderResultsTable(serviceResults) {
    var wrap = document.getElementById("rcResultsTable");
    if (!wrap) return;

    if (!serviceResults.length) {
      wrap.innerHTML = '<div class="tiny" style="color:var(--muted);">No services selected.</div>';
      return;
    }

    var head = [
      '<tr>',
        '<th style="width:18px;"></th>',
        '<th>Service</th>',
        '<th class="rc-num">RT mi</th>',
        '<th class="rc-num">Cycle (min)</th>',
        '<th class="rc-num">Peak headway</th>',
        '<th class="rc-num" title="Weekday / Saturday / Sunday">Daily trips</th>',
        '<th class="rc-num">Daily rev-hr</th>',
        '<th class="rc-num">Daily plat-hr</th>',
        '<th class="rc-num">Annual plat-hr</th>',
        '<th class="rc-num">Annual cost</th>',
        '<th class="rc-num" title="raw / rounded / with spares">Peak veh</th>',
      '</tr>'
    ].join("");

    var rows = "";
    serviceResults.forEach(function (r, idx) {
      if (r.skipped) {
        var tip = (r.warnings || []).map(function (w) { return w.msg; }).join(" \n");
        rows +=
          '<tr class="rc-row rc-row-skipped" data-idx="' + idx + '">' +
            '<td></td>' +
            '<td>' +
              '<span class="rc-warn-badge" title="' + escapeAttr(tip) + '">&#9888;</span> ' +
              escapeHTML(r.name) +
              ' <span class="rc-service-meta">(skipped)</span>' +
            '</td>' +
            '<td colspan="9" class="rc-skip-note">' + escapeHTML((r.warnings[0] && r.warnings[0].msg) || "Skipped") + '</td>' +
          '</tr>';
        return;
      }

      var tripsCell = fmtInt(r.daily.weekday.trips) + " / " +
                      fmtInt(r.daily.saturday.trips) + " / " +
                      fmtInt(r.daily.sunday.trips);
      var vehCell   = fmtDec(r.peakVehiclesRaw, 1) + " / " +
                      fmtInt(r.peakVehiclesRounded) + " / " +
                      fmtInt(r.fleetWithSpares);

      rows +=
        '<tr class="rc-row rc-row-main" data-idx="' + idx + '">' +
          '<td class="rc-caret">&#9656;</td>' +
          '<td>' +
            '<span class="rc-service-name">' + escapeHTML(r.name) + '</span>' +
            '<div class="rc-service-meta">' + escapeHTML(r.directionSummary) + ' &middot; ' +
              r.patternCount + ' pattern' + (r.patternCount === 1 ? '' : 's') + '</div>' +
          '</td>' +
          '<td class="rc-num">' + fmtDec(r.rtMiles, 2) + '</td>' +
          '<td class="rc-num">' + fmtInt(r.cycleMin) + '</td>' +
          '<td class="rc-num">' + fmtHeadway(r.peakHeadwayMin) + '</td>' +
          '<td class="rc-num">' + tripsCell + '</td>' +
          '<td class="rc-num">' + fmtDec(r.daily.weekday.revHrs + r.daily.saturday.revHrs + r.daily.sunday.revHrs, 1) + '</td>' +
          // Note: "Daily plat-hr" shown is weekday-only by convention — the most useful single
          // daily number. Saturday/Sunday totals live in the expand row + annual aggregate.
          '<td class="rc-num">' + fmtDec(r.daily.weekday.platHrs, 1) + '</td>' +
          '<td class="rc-num">' + fmtInt(r.annual.platHrs) + '</td>' +
          '<td class="rc-num rc-cost">' + fmtMoney(r.annual.cost) + '</td>' +
          '<td class="rc-num">' + vehCell + '</td>' +
        '</tr>' +
        '<tr class="rc-row-details" data-idx="' + idx + '" style="display:none;">' +
          '<td></td>' +
          '<td colspan="10">' + buildBandBreakdownHTML(r) + '</td>' +
        '</tr>';
    });

    wrap.innerHTML = '<table class="rc-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';

    // Wire expand toggling
    var mainRows = wrap.querySelectorAll("tr.rc-row-main");
    for (var i = 0; i < mainRows.length; i++) {
      mainRows[i].addEventListener("click", function () {
        var idx = this.getAttribute("data-idx");
        var details = wrap.querySelector('tr.rc-row-details[data-idx="' + idx + '"]');
        if (!details) return;
        var isOpen = details.style.display !== "none";
        details.style.display = isOpen ? "none" : "";
        var caret = this.querySelector(".rc-caret");
        if (caret) caret.innerHTML = isOpen ? "&#9656;" : "&#9662;";
      });
    }
  }

  function buildBandBreakdownHTML(r) {
    if (!r.bandBreakdown || !r.bandBreakdown.length) {
      return '<div class="tiny" style="color:var(--muted);">No service bands.</div>';
    }
    // Group rows by day for readability
    var byDay = { weekday: [], saturday: [], sunday: [] };
    r.bandBreakdown.forEach(function (row) { byDay[row.day].push(row); });

    var html = '<table class="rc-band-table"><thead><tr>' +
      '<th>Day</th><th>Pattern</th><th>Band</th><th class="rc-num">Headway</th>' +
      '<th class="rc-num">Hours</th><th class="rc-num">Trips</th>' +
      '<th class="rc-num">Rev-hr</th><th class="rc-num">Peak veh</th>' +
      '</tr></thead><tbody>';

    ["weekday", "saturday", "sunday"].forEach(function (day) {
      byDay[day].forEach(function (b, i) {
        var peakVeh = Math.ceil((r.cycleMin) / b.headwayMin);
        html +=
          '<tr>' +
            '<td>' + (i === 0 ? DAY_LABELS[day] : '') + '</td>' +
            '<td>' + escapeHTML(b.patternName) + '</td>' +
            '<td>' + escapeHTML(b.from) + '&ndash;' + escapeHTML(b.to) + '</td>' +
            '<td class="rc-num">' + fmtHeadway(b.headwayMin) + '</td>' +
            '<td class="rc-num">' + fmtDec(b.hours, 1) + '</td>' +
            '<td class="rc-num">' + fmtInt(b.trips) + '</td>' +
            '<td class="rc-num">' + fmtDec(b.revHrs, 1) + '</td>' +
            '<td class="rc-num">' + fmtInt(peakVeh) + '</td>' +
          '</tr>';
      });
    });

    html += '</tbody></table>';

    // Show per-day totals line
    var wk = r.daily.weekday, sa = r.daily.saturday, su = r.daily.sunday;
    html += '<div class="rc-day-totals tiny">' +
      'Daily totals — ' +
      'Wk: ' + fmtInt(wk.trips) + ' trips, ' + fmtDec(wk.revHrs, 1) + ' rev-hr, ' + fmtMoney(wk.cost) + ' &middot; ' +
      'Sa: ' + fmtInt(sa.trips) + ' trips, ' + fmtDec(sa.revHrs, 1) + ' rev-hr, ' + fmtMoney(sa.cost) + ' &middot; ' +
      'Su: ' + fmtInt(su.trips) + ' trips, ' + fmtDec(su.revHrs, 1) + ' rev-hr, ' + fmtMoney(su.cost) +
      '</div>';
    return html;
  }

  function renderSummaryTable(summary) {
    var wrap = document.getElementById("rcSummaryTable");
    if (!wrap) return;
    if (!summary) { wrap.innerHTML = ""; return; }

    var rows = [
      ["Services scored",
        fmtInt(summary.servicesScored) +
        (summary.servicesSkipped ? ' <span class="tiny" style="color:var(--muted);">(' + summary.servicesSkipped + ' skipped)</span>' : '')
      ],
      ["Annual operating cost", fmtMoney(summary.annualCost)],
      ["Annual platform hours", fmtInt(summary.annualPlatHrs)],
      ["Annual revenue hours",  fmtInt(summary.annualRevHrs)],
      ["Annual revenue miles",  fmtInt(summary.annualMiles)],
      ["Annual trips",          fmtInt(summary.annualTrips)],
      ["Daily trips (Wk / Sa / Su)",
        fmtInt(summary.dailyTripsWk) + " / " + fmtInt(summary.dailyTripsSa) + " / " + fmtInt(summary.dailyTripsSu)
      ],
      ["Fleet — sum of Service needs (standalone)", fmtInt(summary.fleetSumRounded)],
      ["Fleet — theoretical minimum (interlined)",  fmtInt(summary.fleetSumRaw)],
      ["Interline opportunity (gap)",
        fmtInt(summary.interlineGap) + ' <span class="tiny" style="color:var(--muted);">vehicles potentially savable</span>'
      ]
    ];
    if (summary.costBasisYear) {
      rows.push(["Cost basis",  escapeHTML(summary.costBasisYear)]);
    }

    var html = '<table class="rc-summary-table"><tbody>';
    rows.forEach(function (r) {
      html += '<tr><th>' + escapeHTML(r[0]) + '</th><td>' + r[1] + '</td></tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function showResultsSection(show) {
    var results = document.getElementById("rcResults");
    var empty   = document.getElementById("rcEmptyState");
    if (results) results.style.display = show ? "" : "none";
    if (empty)   empty.style.display   = show ? "none" : "";
  }

  function setExportEnabled(enabled) {
    var btn = document.getElementById("rcExportCSV");
    if (btn) btn.disabled = !enabled;
  }

  // ---- CSV export ----

  function csvCell(v) {
    if (v == null) return "";
    var s = String(v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvRow(arr) { return arr.map(csvCell).join(","); }

  function round1(v) { return isFinite(v) ? Math.round(v * 10) / 10 : ""; }
  function round2(v) { return isFinite(v) ? Math.round(v * 100) / 100 : ""; }
  function roundI(v) { return isFinite(v) ? Math.round(v) : ""; }

  function exportCSV() {
    if (!_lastResult) return;
    var settings = _lastResult.settings;
    var services = _lastResult.services;
    var summary  = _lastResult.summary;

    var now = new Date();
    var stamp = now.getFullYear() + "-" +
                String(now.getMonth() + 1).padStart(2, "0") + "-" +
                String(now.getDate()).padStart(2, "0") + "_" +
                String(now.getHours()).padStart(2, "0") +
                String(now.getMinutes()).padStart(2, "0");

    var lines = [];
    lines.push("# Route Costing Export");
    lines.push("# Generated: " + now.toISOString());
    if (settings.costBasisYear) lines.push("# Cost basis: " + settings.costBasisYear);
    lines.push("# Cost per platform hour ($): " + settings.costPerHour);
    lines.push("# Deadhead %: " + settings.deadheadPct);
    lines.push("# Layover: " + settings.layoverValue +
               (settings.layoverMode === "percent" ? "% of round-trip" : " min"));
    lines.push("# Days/year Wk/Sa/Su: " +
               settings.daysWeekday + "/" + settings.daysSaturday + "/" + settings.daysSunday);
    lines.push("# Spare ratio %: " + settings.spareRatio);
    lines.push("");

    // Per-Service rows
    lines.push(csvRow([
      "Service","Type","Patterns","Direction",
      "RT mi","Cycle (min)","Peak headway (min)",
      "Daily trips (Wk)","Daily trips (Sa)","Daily trips (Su)",
      "Daily rev-hr (Wk)","Daily rev-hr (Sa)","Daily rev-hr (Su)",
      "Daily plat-hr (Wk)","Daily plat-hr (Sa)","Daily plat-hr (Su)",
      "Annual rev-hr","Annual plat-hr","Annual miles","Annual trips","Annual cost ($)",
      "Peak veh raw","Peak veh rounded","Fleet w/spares",
      "Skipped","Warnings"
    ]));

    services.forEach(function (r) {
      if (r.skipped) {
        var warnStr = (r.warnings || []).map(function (w) { return w.msg; }).join(" | ");
        lines.push(csvRow([
          r.name, r.isGroup ? "Paired" : "Solo", r.patternCount, r.directionSummary,
          "","","","","","","","","","","","","","","","","","","","",
          "YES", warnStr
        ]));
        return;
      }
      lines.push(csvRow([
        r.name, r.isGroup ? "Paired" : "Solo", r.patternCount, r.directionSummary,
        round2(r.rtMiles), roundI(r.cycleMin), roundI(r.peakHeadwayMin),
        roundI(r.daily.weekday.trips),  roundI(r.daily.saturday.trips),  roundI(r.daily.sunday.trips),
        round1(r.daily.weekday.revHrs), round1(r.daily.saturday.revHrs), round1(r.daily.sunday.revHrs),
        round1(r.daily.weekday.platHrs),round1(r.daily.saturday.platHrs),round1(r.daily.sunday.platHrs),
        roundI(r.annual.revHrs), roundI(r.annual.platHrs), roundI(r.annual.miles),
        roundI(r.annual.trips),  roundI(r.annual.cost),
        round1(r.peakVehiclesRaw), roundI(r.peakVehiclesRounded), roundI(r.fleetWithSpares),
        "", ""
      ]));
    });

    lines.push("");
    lines.push("# System Summary");
    lines.push(csvRow(["Metric","Value"]));
    lines.push(csvRow(["Services scored", summary.servicesScored]));
    lines.push(csvRow(["Services skipped", summary.servicesSkipped]));
    lines.push(csvRow(["Annual operating cost ($)", roundI(summary.annualCost)]));
    lines.push(csvRow(["Annual platform hours", roundI(summary.annualPlatHrs)]));
    lines.push(csvRow(["Annual revenue hours",  roundI(summary.annualRevHrs)]));
    lines.push(csvRow(["Annual revenue miles",  roundI(summary.annualMiles)]));
    lines.push(csvRow(["Annual trips",          roundI(summary.annualTrips)]));
    lines.push(csvRow(["Daily trips (Wk)", roundI(summary.dailyTripsWk)]));
    lines.push(csvRow(["Daily trips (Sa)", roundI(summary.dailyTripsSa)]));
    lines.push(csvRow(["Daily trips (Su)", roundI(summary.dailyTripsSu)]));
    lines.push(csvRow(["Fleet — sum of Service needs (standalone)", summary.fleetSumRounded]));
    lines.push(csvRow(["Fleet — theoretical minimum (interlined)",  summary.fleetSumRaw]));
    lines.push(csvRow(["Interline opportunity (gap)", summary.interlineGap]));
    if (settings.costBasisYear) lines.push(csvRow(["Cost basis", settings.costBasisYear]));

    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href = url;
    a.download = "route-costing_" + stamp + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
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
    if (_running) return;
    _running = true;
    var selected = getSelectedServices();
    if (!selected.length) {
      setStatus("Select at least one Service.", "warn");
      _running = false;
      return;
    }
    var results = selected.map(function (svc) { return computeService(svc, _settings); });
    var summary = computeSystemSummary(results, _settings);
    _lastResult = { services: results, summary: summary, settings: Object.assign({}, _settings) };
    _stale = false;

    var scored  = summary.servicesScored;
    var skipped = summary.servicesSkipped;
    var msg = "Costed " + scored + " service" + (scored === 1 ? "" : "s");
    if (skipped > 0) msg += " (" + skipped + " skipped — see warnings)";
    setStatus(msg, scored > 0 ? "ok" : "warn");

    renderResultsTable(results);
    renderSummaryTable(summary);
    showResultsSection(true);
    setExportEnabled(scored > 0);

    if (App.cache) App.cache.save();
    _running = false;
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

    // CSV export
    if (byId("rcExportCSV")) {
      byId("rcExportCSV").addEventListener("click", exportCSV);
    }

    // Select all / Clear checklist helpers (checkboxes populated in Step 3)
    if (byId("rcSelectAll")) {
      byId("rcSelectAll").addEventListener("click", function (e) {
        e.preventDefault();
        var boxes = document.querySelectorAll("#rcServiceList input[type=checkbox]");
        for (var j = 0; j < boxes.length; j++) boxes[j].checked = true;
        if (App.cache) App.cache.save();
      });
    }
    if (byId("rcSelectNone")) {
      byId("rcSelectNone").addEventListener("click", function (e) {
        e.preventDefault();
        var boxes = document.querySelectorAll("#rcServiceList input[type=checkbox]");
        for (var j = 0; j < boxes.length; j++) boxes[j].checked = false;
        if (App.cache) App.cache.save();
      });
    }

    // Persist selection changes (event-delegation survives checklist rebuilds)
    if (byId("rcServiceList")) {
      byId("rcServiceList").addEventListener("change", function (e) {
        if (e.target && e.target.type === "checkbox" && App.cache) App.cache.save();
      });
    }
  }

  function onOpen(/* core */) {
    buildServiceChecklist();
    // Refresh settings inputs (in case they haven't been touched yet)
    syncSettingsToInputs(_settings);
    setStatus(null);

    if (_lastResult) {
      renderResultsTable(_lastResult.services);
      renderSummaryTable(_lastResult.summary);
      showResultsSection(true);
      setExportEnabled(_lastResult.summary.servicesScored > 0);
      if (_stale) setStatus("Settings or features changed — re-run to refresh.", "warn");
    } else {
      showResultsSection(false);
      setExportEnabled(false);
    }
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
    showResultsSection(false);
    setExportEnabled(false);
    var rt = document.getElementById("rcResultsTable");
    var st = document.getElementById("rcSummaryTable");
    if (rt) rt.innerHTML = "";
    if (st) st.innerHTML = "";
    setStatus(null);
  }

  // ---- Session persistence ----

  function getSelectedServiceKeys() {
    var el = document.getElementById("rcServiceList");
    if (!el) return null;
    var boxes = el.querySelectorAll("input[type=checkbox]");
    if (!boxes.length) return null;
    var keys = [];
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) keys.push(boxes[i].getAttribute("data-key"));
    }
    return keys;
  }

  var _restoredSelectedKeys = null;  // set by apply(); consumed by buildServiceChecklist

  function saveRcState(/* mode */) {
    var data = {
      version:       1,
      settings:      Object.assign({}, _settings),
      selectedKeys:  getSelectedServiceKeys(),
      lastSummary:   null
    };
    if (_lastResult) {
      // Strip bandBreakdown (large + reconstructible) in light mode; keep per-service totals.
      data.lastSummary = {
        settings: Object.assign({}, _lastResult.settings),
        summary:  Object.assign({}, _lastResult.summary),
        services: _lastResult.services.map(function (r) {
          if (r.skipped) {
            return {
              name: r.name, key: r.key, isGroup: r.isGroup,
              skipped: true, warnings: r.warnings,
              patternCount: r.patternCount, directionSummary: r.directionSummary
            };
          }
          return {
            name: r.name, key: r.key, isGroup: r.isGroup,
            skipped: false, patternCount: r.patternCount,
            directionSummary: r.directionSummary,
            rtMiles: r.rtMiles, cycleMin: r.cycleMin,
            peakHeadwayMin: r.peakHeadwayMin,
            daily: r.daily, annual: r.annual,
            peakVehiclesRaw: r.peakVehiclesRaw,
            peakVehiclesRounded: r.peakVehiclesRounded,
            fleetWithSpares: r.fleetWithSpares,
            bandBreakdown: []  // dropped from persistence; re-run to recompute
          };
        })
      };
    }
    return data;
  }

  function restoreRcState(data) {
    if (!data) return;
    if (data.settings) {
      _settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    }
    if (Array.isArray(data.selectedKeys)) {
      // Migrate legacy "group-…" keys (pre-Service rename) to "service-…"
      // so checkbox selections survive the upgrade.
      _restoredSelectedKeys = data.selectedKeys.map(function (k) {
        return (typeof k === "string" && k.indexOf("group-") === 0)
          ? "service-" + k.slice(6)
          : k;
      });
    }
    if (data.lastSummary && Array.isArray(data.lastSummary.services)) {
      _lastResult = {
        settings: Object.assign({}, data.lastSummary.settings || _settings),
        summary:  data.lastSummary.summary || {},
        services: data.lastSummary.services
      };
    }
  }

  // Hook restored selection into buildServiceChecklist.
  var _origBuildServiceChecklist = buildServiceChecklist;
  buildServiceChecklist = function () {
    _origBuildServiceChecklist();
    if (_restoredSelectedKeys) {
      var el = document.getElementById("rcServiceList");
      if (el) {
        var boxes = el.querySelectorAll("input[type=checkbox]");
        var lookup = {};
        _restoredSelectedKeys.forEach(function (k) { lookup[k] = true; });
        for (var i = 0; i < boxes.length; i++) {
          boxes[i].checked = !!lookup[boxes[i].getAttribute("data-key")];
        }
      }
      _restoredSelectedKeys = null;  // consume once
    }
  };

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

  if (App.cache && App.cache.registerModule) {
    App.cache.registerModule("route-costing", {
      collect: saveRcState,
      apply:   restoreRcState
    });
  }

})();
