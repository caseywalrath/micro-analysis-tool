// js/core/popup.js
// Generic analysis popup manager: opens module popups, floating map widgets.
// Depends on: App namespace (utils.js).
// Exports: App.popup.open, close, isOpen, currentModuleId,
//          App.popup.showFloatingWidget, App.popup.hideFloatingWidget

(function () {
  "use strict";
  var App = window.App = window.App || {};

  // ---- Internal state ----

  var _currentModuleId = null;    // id of the module whose popup is open (or null)
  var _loadedModules = {};        // { moduleId: slotDOMNode } — per-module persistent body slot
  var _container = null;          // cached #module-popup element
  var _floatingWidgets = {};      // { widgetId: DOM element }

  // ---- Drag state ----
  var _dragging = false;
  var _dragStartX = 0;
  var _dragStartY = 0;
  var _offsetX = 0;
  var _offsetY = 0;

  function getContainer() {
    if (!_container) _container = document.getElementById("module-popup");
    return _container;
  }

  // ---- Popup lifecycle ----

  /**
   * Open a module popup.
   * @param {string} moduleId — must match a registered module's id
   * @param {Map} modules — the _modules Map from app.js
   * @param {function} buildCore — function that returns the core API object
   */
  async function open(moduleId, modules, buildCore) {
    var mod = modules.get(moduleId);
    if (!mod) { console.warn("popup.open: unknown module", moduleId); return; }
    if (!mod.popupHTML) { console.warn("popup.open: module has no popupHTML", moduleId); return; }

    var el = getContainer();
    if (!el) return;

    var dialog = el.querySelector(".module-popup-dialog");
    var titleEl = el.querySelector(".module-popup-title");
    var bodyEl = el.querySelector(".module-popup-body");
    if (!dialog || !bodyEl) return;

    // A freshly opened panel always starts expanded.
    setCollapsed(false);

    // If a different module was open, close it first
    if (_currentModuleId && _currentModuleId !== moduleId) {
      _close(modules, buildCore);
    }

    // Set title and dialog width
    if (titleEl) titleEl.textContent = mod.name || moduleId;
    if (mod.popupWidth) {
      dialog.style.width = mod.popupWidth + "px";
    } else {
      dialog.style.width = "";
    }
    // Narrow "task panel" modules trade width for height. Derived from
    // popupWidth rather than a new registration field, so any module narrowed
    // later picks it up for free. The 620px threshold matches the @container
    // rule in style.css that stacks a two-column popup body.
    dialog.classList.toggle("module-popup-narrow", !!mod.popupWidth && mod.popupWidth <= 620);

    // Hide all existing module slot divs (show only the active module's slot)
    var allSlots = bodyEl.querySelectorAll(".module-body-slot");
    for (var i = 0; i < allSlots.length; i++) allSlots[i].style.display = "none";

    // First open: create a dedicated slot div, fetch HTML, run init
    if (!_loadedModules[moduleId]) {
      var slotEl = document.createElement("div");
      slotEl.className = "module-body-slot";
      bodyEl.appendChild(slotEl);
      try {
        var resp = await fetch(mod.popupHTML);
        if (resp.ok) {
          slotEl.innerHTML = await resp.text();
        }
      } catch (e) {
        console.warn("popup.open: could not load HTML for", moduleId, e);
      }
      _loadedModules[moduleId] = slotEl;
      if (typeof mod.init === "function") {
        mod.init(buildCore());
      }
    }

    // Show this module's slot
    _loadedModules[moduleId].style.display = "";

    // Reset drag offset so popup re-centers
    _offsetX = 0;
    _offsetY = 0;
    dialog.style.transform = "";

    _currentModuleId = moduleId;
    el.style.display = "flex";

    // Call onOpen hook (every time popup opens)
    if (typeof mod.onOpen === "function") {
      mod.onOpen(buildCore());
    }
  }

  /**
   * Close the currently open popup.
   */
  function _close(modules, buildCore) {
    var el = getContainer();
    if (!el) return;
    el.style.display = "none";

    if (_currentModuleId && modules) {
      var mod = modules.get(_currentModuleId);
      if (mod && typeof mod.onClose === "function") {
        mod.onClose(buildCore());
      }
    }
    _currentModuleId = null;
  }

  // Public close — takes no args, uses stored references (set at wiring time)
  var _modulesRef = null;
  var _buildCoreRef = null;

  function close() {
    _close(_modulesRef, _buildCoreRef);
  }

  function isOpen() {
    return _currentModuleId !== null;
  }

  function currentModuleId() {
    return _currentModuleId;
  }

  // ---- Floating widgets ----

  /**
   * Show a floating widget over the map.
   * @param {string} widgetId — unique ID for this widget
   * @param {string} htmlFile — path to HTML fragment (fetched on first show)
   * @param {object} options — { position: "bottom-left", width: 160, title: "..." }
   */
  async function showFloatingWidget(widgetId, htmlFile, options) {
    options = options || {};

    // If already exists, just make it visible
    if (_floatingWidgets[widgetId]) {
      _floatingWidgets[widgetId].style.display = "";
      return;
    }

    // Create widget DOM
    var widget = document.createElement("div");
    widget.className = "floating-widget";
    widget.setAttribute("data-widget-id", widgetId);

    // Position
    var pos = options.position || "bottom-left";
    if (pos === "bottom-left") {
      widget.style.bottom = "36px";
      widget.style.left = "10px";
    } else if (pos === "bottom-right") {
      widget.style.bottom = "36px";
      widget.style.right = "10px";
    } else if (pos === "top-left") {
      widget.style.top = "10px";
      widget.style.left = "10px";
    } else if (pos === "top-right") {
      widget.style.top = "10px";
      widget.style.right = "10px";
    }

    if (options.width) widget.style.width = options.width + "px";

    // Build header + body
    var headerHTML = options.title
      ? '<div class="floating-widget-header">' +
          '<span class="floating-widget-title">' + options.title + '</span>' +
          '<button class="floating-widget-close" aria-label="Close">&times;</button>' +
        '</div>'
      : '';
    widget.innerHTML = headerHTML + '<div class="floating-widget-body"></div>';

    // Load content
    if (htmlFile) {
      try {
        var resp = await fetch(htmlFile);
        if (resp.ok) {
          widget.querySelector(".floating-widget-body").innerHTML = await resp.text();
        }
      } catch (e) {
        console.warn("floating widget load error:", e);
      }
    }

    // Close button
    var closeBtn = widget.querySelector(".floating-widget-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        widget.style.display = "none";
      });
    }

    // Append to map container (positioned absolutely within it)
    var mapEl = document.getElementById("map");
    if (mapEl) {
      mapEl.appendChild(widget);
    }
    _floatingWidgets[widgetId] = widget;
  }

  function hideFloatingWidget(widgetId) {
    var w = _floatingWidgets[widgetId];
    if (w) w.style.display = "none";
  }

  function removeFloatingWidget(widgetId) {
    var w = _floatingWidgets[widgetId];
    if (w && w.parentNode) w.parentNode.removeChild(w);
    delete _floatingWidgets[widgetId];
  }

  // ---- Popup drag support ----

  function setCollapsed(collapsed) {
    var el = getContainer();
    if (!el) return;
    el.classList.toggle("module-popup-collapsed", collapsed);
    var btn = el.querySelector(".module-popup-collapse");
    if (!btn) return;
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
    btn.title = collapsed ? "Expand" : "Collapse";
  }

  function initDrag() {
    var el = getContainer();
    if (!el) return;

    var header = el.querySelector(".module-popup-header");
    var dialog = el.querySelector(".module-popup-dialog");
    if (!header || !dialog) return;

    header.addEventListener("mousedown", function (e) {
      if (e.target.closest(".module-popup-close, .module-popup-collapse")) return;

      e.preventDefault();
      _dragging = true;
      _dragStartX = e.clientX - _offsetX;
      _dragStartY = e.clientY - _offsetY;

      header.classList.add("dragging");
      dialog.classList.add("dragging");
    });

    document.addEventListener("mousemove", function (e) {
      if (!_dragging) return;
      e.preventDefault();

      _offsetX = e.clientX - _dragStartX;
      _offsetY = e.clientY - _dragStartY;
      dialog.style.transform = "translate(" + _offsetX + "px, " + _offsetY + "px)";
    });

    document.addEventListener("mouseup", function () {
      if (!_dragging) return;
      _dragging = false;

      header.classList.remove("dragging");
      dialog.classList.remove("dragging");
    });
  }

  // ---- Wiring (called once from app.js on map load) ----

  function wire(modules, buildCore) {
    _modulesRef = modules;
    _buildCoreRef = buildCore;

    var el = getContainer();
    if (!el) return;

    // Close button
    var closeBtn = el.querySelector(".module-popup-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", close);
    }

    var collapseBtn = el.querySelector(".module-popup-collapse");
    if (collapseBtn) {
      collapseBtn.addEventListener("click", function () {
        setCollapsed(!el.classList.contains("module-popup-collapsed"));
      });
    }

    // Initialize popup dragging
    initDrag();
  }

  // ---- Public API ----

  App.popup = {
    open: open,
    close: close,
    isOpen: isOpen,
    currentModuleId: currentModuleId,
    showFloatingWidget: showFloatingWidget,
    hideFloatingWidget: hideFloatingWidget,
    removeFloatingWidget: removeFloatingWidget,
    wire: wire
  };

})();
