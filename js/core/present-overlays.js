(function () {
  "use strict";
  var App = window.App;

  // ── state ──────────────────────────────────────────────────────────────────
  var _vis  = { legend: false, north: false, title: false };
  var _pos  = {
    legend: { top: 80,  left: 20   },
    north:  { top: 80,  left: null },  // null → computed on first show
    title:  { top: 20,  left: null }   // null → centred on first show
  };
  var _size = {
    legend: { width: null, height: null },
    north:  { width: 80,  height: 100  },
    title:  { width: 280, height: null }
  };
  var _titleText   = "Title";
  var _legendNames = {};   // { "route:0": "...", "group:Blue Line": "..." } custom display names
  var _legendPinned = [];  // ordered array of IDs currently shown in the legend
  var _legendNaturalWidth = null;  // content width at default font — basis for proportional scaling

  var _els    = {};
  var _picker = null;
  var _inited = false;

  // ── helpers ────────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── drag ───────────────────────────────────────────────────────────────────
  function _makeDraggable(el, handle) {
    var ds = null;
    handle.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var r = el.getBoundingClientRect();
      ds = { sx: e.clientX, sy: e.clientY, il: r.left, it: r.top };
    });
    document.addEventListener("mousemove", function (e) {
      if (!ds) return;
      var nl = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ds.il + e.clientX - ds.sx));
      var nt = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, ds.it + e.clientY - ds.sy));
      el.style.left  = nl + "px";
      el.style.top   = nt + "px";
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", function () {
      if (!ds) return;
      var r   = el.getBoundingClientRect();
      var key = el.getAttribute("data-pm");
      if (key) {
        _pos[key] = { top: Math.round(r.top), left: Math.round(r.left) };
        _saveState();
      }
      ds = null;
    });
  }

  // ── resize observation ─────────────────────────────────────────────────────
  function _watchResize(el) {
    if (typeof ResizeObserver === "undefined") return;
    var ro = new ResizeObserver(function () {
      var key = el.getAttribute("data-pm");
      if (!key) return;
      _size[key] = { width: el.offsetWidth, height: el.offsetHeight };
      if (key === "legend") _applyLegendFontSize();
      _saveState();
    });
    ro.observe(el);
  }

  // ── all picker items ───────────────────────────────────────────────────────
  // Returns every feature and every group (by attributes.group) available.
  function _allPickerItems() {
    var items  = [];
    var groups = {};  // groupName -> { color, shape }

    var types = [
      { key: "point",   arr: App.points,   shape: "circle" },
      { key: "line",    arr: App.lines,    shape: "line"   },
      { key: "route",   arr: App.routes,   shape: "line"   },
      { key: "polygon", arr: App.polygons, shape: "rect"   }
    ];

    types.forEach(function (t) {
      if (!t.arr) return;
      t.arr.forEach(function (feat, idx) {
        if (feat.properties && feat.properties.hidden) return;
        var color = (feat.properties && feat.properties.color) ||
                    (typeof App.getTypeDefaultColor === "function"
                      ? App.getTypeDefaultColor(t.key) : "#999");
        var fallback = t.key.charAt(0).toUpperCase() + t.key.slice(1) + " " + (idx + 1);
        var name = (feat.properties && feat.properties.name) || fallback;
        var grpName = feat.properties &&
                      feat.properties.attributes &&
                      feat.properties.attributes.group;

        items.push({
          id:      t.key + ":" + idx,
          label:   name,
          color:   color,
          shape:   t.shape,
          isGroup: false
        });

        if (grpName && !groups[grpName]) {
          groups[grpName] = { color: color, shape: t.shape };
        }
      });
    });

    // Append group entries after individual features
    Object.keys(groups).sort().forEach(function (gName) {
      items.push({
        id:      "group:" + gName,
        label:   gName,
        color:   groups[gName].color,
        shape:   groups[gName].shape,
        isGroup: true
      });
    });

    return items;
  }

  // Resolve a pinned ID to its current display info (null if the feature no longer exists).
  function _resolveItem(id) {
    var all = _allPickerItems();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  // ── legend content ─────────────────────────────────────────────────────────
  function _swatchSVG(shape, color) {
    var c = _esc(color);
    if (shape === "circle") {
      return '<svg width="1em" height="1em" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="' + c + '"/></svg>';
    }
    if (shape === "line") {
      return '<svg width="1.4em" height="1em" viewBox="0 0 20 16"><line x1="2" y1="8" x2="18" y2="8" stroke="' + c + '" stroke-width="3.5" stroke-linecap="round"/></svg>';
    }
    return '<svg width="1em" height="1em" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="' + c + '" opacity="0.75" stroke="' + c + '" stroke-width="1.5"/></svg>';
  }

  // Scale font proportionally to panel width. Only grows above the natural content
  // width; at or below natural width the font stays at the CSS default (no override).
  function _applyLegendFontSize() {
    var el = _els.legend;
    if (!el) return;
    var body = el.querySelector(".pm-legend-body");
    if (!body) return;
    var currentWidth = el.offsetWidth;
    var natural = _legendNaturalWidth;
    if (!natural || currentWidth <= natural + 2) {
      body.style.fontSize = "";
      return;
    }
    // 13px is the base body font size; cap at 32px for readability
    var scale = currentWidth / natural;
    body.style.fontSize = Math.min(32, Math.round(13 * scale)) + "px";
  }

  // Snapshot the tight content width so _applyLegendFontSize has a reliable baseline.
  // Temporarily lifts any inline width so max-content governs during measurement,
  // then restores it before re-applying the scale. Runs inside rAF so the browser
  // has already performed layout on the new innerHTML before we measure.
  function _measureNaturalWidth() {
    var el = _els.legend;
    var body = el && el.querySelector(".pm-legend-body");
    if (!el || !body) return;
    requestAnimationFrame(function () {
      var savedW = el.style.width;
      if (savedW) el.style.width = "";
      _legendNaturalWidth = el.offsetWidth;
      if (savedW) el.style.width = savedW;
      _applyLegendFontSize();
    });
  }

  function _refreshLegend() {
    var body = _els.legend && _els.legend.querySelector(".pm-legend-body");
    if (!body) return;

    // Reset natural-width baseline and clear any previous scaling so the
    // max-content layout is accurate before _measureNaturalWidth runs.
    _legendNaturalWidth = null;
    body.style.fontSize = "";

    if (_legendPinned.length === 0) {
      body.innerHTML = '<div class="pm-legend-empty">Click + to add items</div>';
      _measureNaturalWidth();
      return;
    }

    var rows = [];
    _legendPinned.forEach(function (id) {
      var item = _resolveItem(id);
      if (!item) return;  // feature was deleted
      var name = (_legendNames[id] !== undefined) ? _legendNames[id] : item.label;
      rows.push(
        '<div class="pm-legend-row">' +
          '<span class="pm-legend-swatch">' + _swatchSVG(item.shape, item.color) + '</span>' +
          '<span class="pm-legend-name" contenteditable="true" spellcheck="false" data-key="' + _esc(id) + '">' + _esc(name) + '</span>' +
        '</div>'
      );
    });

    body.innerHTML = rows.length
      ? rows.join("")
      : '<div class="pm-legend-empty">Click + to add items</div>';
    _measureNaturalWidth();
  }

  // ── picker ─────────────────────────────────────────────────────────────────
  function _positionPicker() {
    if (!_els.legend || !_picker) return;
    var lr  = _els.legend.getBoundingClientRect();
    var pw  = 230;
    var left = lr.right + 8;
    if (left + pw > window.innerWidth - 8) {
      left = Math.max(8, lr.left - pw - 8);
    }
    var top = Math.min(lr.top, window.innerHeight - (_picker.offsetHeight || 300) - 8);
    top = Math.max(8, top);
    _picker.style.top  = top  + "px";
    _picker.style.left = left + "px";
  }

  function _buildPickerBody() {
    var body = _picker && _picker.querySelector(".pm-picker-body");
    if (!body) return;

    var all      = _allPickerItems();
    var features = all.filter(function (i) { return !i.isGroup; });
    var groups   = all.filter(function (i) { return  i.isGroup; });

    if (all.length === 0) {
      body.innerHTML = '<div class="pm-picker-empty">No features on map</div>';
      return;
    }

    var html = "";

    function itemRow(item) {
      var checked = _legendPinned.indexOf(item.id) >= 0 ? " checked" : "";
      var labelText = item.isGroup ? item.label + " (group)" : item.label;
      return '<label class="pm-picker-row">' +
        '<input type="checkbox" class="pm-picker-check" value="' + _esc(item.id) + '"' + checked + '>' +
        '<span class="pm-picker-swatch">' + _swatchSVG(item.shape, item.color) + '</span>' +
        '<span class="pm-picker-label">' + _esc(labelText) + '</span>' +
        '</label>';
    }

    if (features.length) {
      html += '<div class="pm-picker-section-label">Features</div>';
      features.forEach(function (item) { html += itemRow(item); });
    }

    if (groups.length) {
      html += '<div class="pm-picker-section-label">Groups</div>';
      groups.forEach(function (item) { html += itemRow(item); });
    }

    body.innerHTML = html;
  }

  function _openPicker() {
    if (!_picker) return;
    _buildPickerBody();
    _picker.style.display = "flex";
    _positionPicker();
  }

  function _closePicker() {
    if (_picker) _picker.style.display = "none";
  }

  function _commitPickerSelection() {
    if (!_picker) return;
    var checks = _picker.querySelectorAll(".pm-picker-check");
    var selectedIds = [];
    checks.forEach(function (cb) { if (cb.checked) selectedIds.push(cb.value); });

    // Preserve order of already-pinned items; append newly selected ones.
    var newPinned = _legendPinned.filter(function (id) {
      return selectedIds.indexOf(id) >= 0;
    });
    selectedIds.forEach(function (id) {
      if (newPinned.indexOf(id) < 0) newPinned.push(id);
    });

    _legendPinned = newPinned;
    _refreshLegend();
    _closePicker();
    _saveState();
  }

  function _clearLegend() {
    _legendPinned = [];
    _refreshLegend();
    // Uncheck all boxes in picker if it's open
    if (_picker) {
      _picker.querySelectorAll(".pm-picker-check").forEach(function (cb) {
        cb.checked = false;
      });
    }
    _saveState();
  }

  // ── visibility ─────────────────────────────────────────────────────────────
  function _applyPosSize(key) {
    var el = _els[key];
    if (!el) return;
    var p = _pos[key];
    var s = _size[key];
    if (p.left === null) {
      if (key === "north") {
        p.left = Math.max(0, window.innerWidth - (s.width || 80) - 20);
        p.top  = p.top || 80;
      } else {
        p.left = Math.max(0, Math.round((window.innerWidth - (s.width || 280)) / 2));
        p.top  = p.top || 20;
      }
    }
    el.style.top   = (p.top  || 0) + "px";
    el.style.left  = (p.left || 0) + "px";
    el.style.right = "auto";
    if (s.width)  el.style.width  = s.width  + "px";
    if (s.height) el.style.height = s.height + "px";
  }

  function _setVisible(key, show) {
    var el = _els[key];
    if (!el) return;
    var inPresent = document.body.classList.contains("present-mode");
    var visible   = inPresent && show;
    el.style.display = visible ? "block" : "none";
    if (visible) _applyPosSize(key);
    // Close picker when legend is hidden
    if (key === "legend" && !visible) _closePicker();
  }

  function _updateAll() {
    ["legend", "north", "title"].forEach(function (k) { _setVisible(k, _vis[k]); });
  }

  // ── dropdown toggle checkmarks ─────────────────────────────────────────────
  function _refreshToggles() {
    ["legend", "north", "title"].forEach(function (key) {
      var btn = document.getElementById("pm-toggle-" + key);
      if (!btn) return;
      var check = btn.querySelector(".pm-toggle-check");
      if (check) check.style.visibility = _vis[key] ? "visible" : "hidden";
    });
  }

  // ── persistence ────────────────────────────────────────────────────────────
  function _saveState() {
    if (App.cache && typeof App.cache.save === "function") App.cache.save();
  }

  // ── clear / reset ──────────────────────────────────────────────────────────
  function _clearAll() {
    _vis  = { legend: false, north: false, title: false };
    _pos  = {
      legend: { top: 80, left: 20   },
      north:  { top: 80, left: null },
      title:  { top: 20, left: null }
    };
    _size = {
      legend: { width: null, height: null },
      north:  { width: 80,  height: 100  },
      title:  { width: 280, height: null }
    };
    _titleText          = "Title";
    _legendNames        = {};
    _legendPinned       = [];
    _legendNaturalWidth = null;
    _closePicker();
    _updateAll();
    _refreshToggles();
    _refreshLegend();
    var tt = _els.title && _els.title.querySelector(".pm-title-text");
    if (tt) tt.textContent = _titleText;
  }

  // ── init ───────────────────────────────────────────────────────────────────
  function _init() {
    if (_inited) return;
    _inited = true;

    _els.legend = document.getElementById("pm-legend");
    _els.north  = document.getElementById("pm-north");
    _els.title  = document.getElementById("pm-title");
    _picker     = document.getElementById("pm-legend-picker");

    var elemBtn  = document.getElementById("pm-elements-btn");
    var elemDrop = document.getElementById("pm-elements-dropdown");
    if (!_els.legend || !_els.north || !_els.title || !elemBtn || !elemDrop) return;

    // Map Elements dropdown open/close
    elemBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = elemDrop.style.display !== "none";
      elemDrop.style.display = isOpen ? "none" : "block";
    });
    elemDrop.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function (e) {
      if (elemDrop) elemDrop.style.display = "none";
      // Close picker on outside click (but not if click was on the + button or picker itself)
      if (_picker && _picker.style.display !== "none") {
        var addBtn = document.getElementById("pm-legend-add-btn");
        if (!_picker.contains(e.target) && e.target !== addBtn) {
          _closePicker();
        }
      }
    });

    // Toggle buttons (Legend / North Arrow / Title)
    ["legend", "north", "title"].forEach(function (key) {
      var btn = document.getElementById("pm-toggle-" + key);
      if (!btn) return;
      btn.addEventListener("click", function () {
        _vis[key] = !_vis[key];
        _setVisible(key, _vis[key]);
        if (key === "legend" && _vis.legend) _refreshLegend();
        _refreshToggles();
        _saveState();
      });
    });

    // Sync overlays on present-mode enter/exit and Escape
    var presentBtn  = document.getElementById("present-btn");
    var presentExit = document.getElementById("present-exit");
    if (presentBtn)  presentBtn.addEventListener("click",  function () { _updateAll(); if (_vis.legend) _refreshLegend(); });
    if (presentExit) presentExit.addEventListener("click", function () { _closePicker(); _updateAll(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { _closePicker(); _updateAll(); }
    });

    // Drag
    var dragHandle = _els.legend.querySelector(".pm-drag-handle");
    _makeDraggable(_els.legend, dragHandle || _els.legend);
    _makeDraggable(_els.north,  _els.north);
    _makeDraggable(_els.title,  _els.title);

    // Resize observation
    _watchResize(_els.legend);
    _watchResize(_els.north);
    _watchResize(_els.title);

    // Title: contenteditable
    var titleText = _els.title.querySelector(".pm-title-text");
    if (titleText) {
      titleText.addEventListener("input", function () {
        _titleText = titleText.textContent;
        _saveState();
      });
      titleText.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

    // Legend: save name edits; prevent drag when clicking contenteditable spans
    _els.legend.addEventListener("input", function (e) {
      if (e.target.classList.contains("pm-legend-name")) {
        _legendNames[e.target.getAttribute("data-key")] = e.target.textContent;
        _saveState();
      }
    });
    _els.legend.addEventListener("keydown", function (e) {
      if (e.target.classList.contains("pm-legend-name") && e.key === "Enter") {
        e.preventDefault();
        e.target.blur();
      }
    });
    _els.legend.addEventListener("paste", function (e) {
      if (!e.target.classList.contains("pm-legend-name")) return;
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    _els.legend.addEventListener("mousedown", function (e) {
      if (e.target.classList.contains("pm-legend-name")) e.stopPropagation();
    });

    // + button: toggle picker
    var addBtn = document.getElementById("pm-legend-add-btn");
    if (addBtn) {
      addBtn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      addBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (_picker && _picker.style.display !== "none") {
          _closePicker();
        } else {
          _openPicker();
        }
      });
    }

    // Picker: close button
    var closeBtn = document.getElementById("pm-picker-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        _closePicker();
      });
    }

    // Picker: "Add to Legend" button
    var pickerAdd = document.getElementById("pm-picker-add");
    if (pickerAdd) {
      pickerAdd.addEventListener("click", function (e) {
        e.stopPropagation();
        _commitPickerSelection();
      });
    }

    // Picker: "Clear Legend" button
    var pickerClear = document.getElementById("pm-picker-clear");
    if (pickerClear) {
      pickerClear.addEventListener("click", function (e) {
        e.stopPropagation();
        _clearLegend();
      });
    }

    // Keep picker open when clicking inside it
    if (_picker) {
      _picker.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    _updateAll();
    _refreshToggles();
  }

  // ── cache module registration ──────────────────────────────────────────────
  if (App.cache && typeof App.cache.registerModule === "function") {
    App.cache.registerModule("present-overlays", {
      collect: function () {
        return {
          vis:          _vis,
          pos:          _pos,
          size:         _size,
          titleText:    _titleText,
          legendNames:  _legendNames,
          legendPinned: _legendPinned
        };
      },
      apply: function (data) {
        if (!data) return;
        if (data.vis)                    _vis          = data.vis;
        if (data.pos)                    _pos          = data.pos;
        if (data.size)                   _size         = data.size;
        if (data.titleText !== undefined) _titleText   = data.titleText;
        if (data.legendNames)            _legendNames  = data.legendNames;
        if (data.legendPinned)           _legendPinned = data.legendPinned;
        if (_inited) {
          _updateAll();
          _refreshToggles();
          _refreshLegend();
          var tt = _els.title && _els.title.querySelector(".pm-title-text");
          if (tt) tt.textContent = _titleText;
        }
      }
    });
  }

  // ── public API ─────────────────────────────────────────────────────────────
  App.clearPresentOverlays = _clearAll;

  _init();
}());
