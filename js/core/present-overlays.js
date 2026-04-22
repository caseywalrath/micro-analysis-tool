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
    legend: { width: 190, height: null },
    north:  { width: 80,  height: 100  },
    title:  { width: 280, height: null }
  };
  var _titleText   = "Title";
  var _legendNames = {};  // { "point": "...", "line": "...", ... } user overrides

  var _els   = {};
  var _inited = false;

  // ── helpers ────────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── drag ───────────────────────────────────────────────────────────────────
  // Each overlay gets an independent drag closure so they don't interfere.
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
      _saveState();
    });
    ro.observe(el);
  }

  // ── legend content ─────────────────────────────────────────────────────────
  function _legendGroups() {
    var types = [
      { key: "point",   label: "Points",   arr: App.points,   shape: "circle" },
      { key: "line",    label: "Lines",    arr: App.lines,    shape: "line"   },
      { key: "route",   label: "Routes",   arr: App.routes,   shape: "line"   },
      { key: "polygon", label: "Polygons", arr: App.polygons, shape: "rect"   }
    ];
    return types
      .filter(function (t) { return t.arr && t.arr.length > 0; })
      .map(function (t) {
        var color = (t.arr[0].properties && t.arr[0].properties.color) ||
                    (typeof App.getTypeDefaultColor === "function"
                      ? App.getTypeDefaultColor(t.key) : "#999");
        return { key: t.key, defaultLabel: t.label, color: color, shape: t.shape };
      });
  }

  function _swatchSVG(shape, color) {
    var c = _esc(color);
    if (shape === "circle") {
      return '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="' + c + '"/></svg>';
    }
    if (shape === "line") {
      return '<svg width="20" height="16" viewBox="0 0 20 16"><line x1="2" y1="8" x2="18" y2="8" stroke="' + c + '" stroke-width="3.5" stroke-linecap="round"/></svg>';
    }
    // rect (polygon)
    return '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="' + c + '" opacity="0.75" stroke="' + c + '" stroke-width="1.5"/></svg>';
  }

  function _refreshLegend() {
    var body = _els.legend && _els.legend.querySelector(".pm-legend-body");
    if (!body) return;
    var groups = _legendGroups();
    if (groups.length === 0) {
      body.innerHTML = '<div class="pm-legend-empty">No features on map</div>';
      return;
    }
    body.innerHTML = groups.map(function (g) {
      var name = (_legendNames[g.key] !== undefined) ? _legendNames[g.key] : g.defaultLabel;
      return '<div class="pm-legend-row">' +
        '<span class="pm-legend-swatch">' + _swatchSVG(g.shape, g.color) + '</span>' +
        '<input class="pm-legend-name" data-key="' + g.key + '" value="' + _esc(name) + '" />' +
        '</div>';
    }).join("");
  }

  // ── visibility ─────────────────────────────────────────────────────────────
  function _applyPosSize(key) {
    var el = _els[key];
    if (!el) return;
    var p = _pos[key];
    var s = _size[key];
    // Compute default position on first open
    if (p.left === null) {
      if (key === "north") {
        p.left = Math.max(0, window.innerWidth - (s.width || 80) - 20);
        p.top  = p.top || 80;
      } else {
        // title: centred horizontally near top
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
      legend: { width: 190, height: null },
      north:  { width: 80,  height: 100  },
      title:  { width: 280, height: null }
    };
    _titleText   = "Title";
    _legendNames = {};
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
    document.addEventListener("click", function () {
      if (elemDrop) elemDrop.style.display = "none";
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
    if (presentExit) presentExit.addEventListener("click", _updateAll);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") _updateAll();
    });

    // Drag
    _makeDraggable(_els.legend, _els.legend.querySelector(".pm-drag-handle") || _els.legend);
    _makeDraggable(_els.north,  _els.north);
    _makeDraggable(_els.title,  _els.title);

    // Resize observation (saves size on user-resize)
    _watchResize(_els.legend);
    _watchResize(_els.north);
    _watchResize(_els.title);

    // Title: contenteditable + prevent title drag when clicking text to edit
    var titleText = _els.title.querySelector(".pm-title-text");
    if (titleText) {
      titleText.addEventListener("input", function () {
        _titleText = titleText.textContent;
        _saveState();
      });
      titleText.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    }

    // Legend: save name edits; prevent drag when clicking inputs
    _els.legend.addEventListener("change", function (e) {
      if (e.target.classList.contains("pm-legend-name")) {
        _legendNames[e.target.getAttribute("data-key")] = e.target.value;
        _saveState();
      }
    });
    _els.legend.addEventListener("mousedown", function (e) {
      if (e.target.classList.contains("pm-legend-name")) e.stopPropagation();
    });

    _updateAll();
    _refreshToggles();
  }

  // ── cache module registration ──────────────────────────────────────────────
  if (App.cache && typeof App.cache.registerModule === "function") {
    App.cache.registerModule("present-overlays", {
      collect: function () {
        return {
          vis:         _vis,
          pos:         _pos,
          size:        _size,
          titleText:   _titleText,
          legendNames: _legendNames
        };
      },
      apply: function (data) {
        if (!data) return;
        if (data.vis)                    _vis         = data.vis;
        if (data.pos)                    _pos         = data.pos;
        if (data.size)                   _size        = data.size;
        if (data.titleText !== undefined) _titleText  = data.titleText;
        if (data.legendNames)            _legendNames = data.legendNames;
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
