// js/core/undo.js
// Undo/redo stack using full-state snapshots from cache.js.
// Depends on: App.cache (cache.js) — collectState, applyState.
// Exports: App.undo

(function () {
  var App = window.App;
  var _undoStack = [];
  var _redoStack = [];
  var MAX_STACK = 50;
  var _restoring = false;

  function snapshot() {
    return JSON.parse(JSON.stringify(App.cache.collectState("light")));
  }

  function push() {
    if (_restoring) return;
    _undoStack.push(snapshot());
    if (_undoStack.length > MAX_STACK) _undoStack.shift();
    _redoStack.length = 0;
    updateButtons();
  }

  function undo() {
    if (_undoStack.length === 0) return;
    _redoStack.push(snapshot());
    var state = _undoStack.pop();
    restore(state);
    updateButtons();
  }

  function redo() {
    if (_redoStack.length === 0) return;
    _undoStack.push(snapshot());
    var state = _redoStack.pop();
    restore(state);
    updateButtons();
  }

  function restore(state) {
    _restoring = true;
    try {
      App.cache.applyState(state);
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
      App.cache.save();
    } finally {
      _restoring = false;
    }
  }

  function updateButtons() {
    var undoBtn = document.getElementById("undo-btn");
    var redoBtn = document.getElementById("redo-btn");
    if (undoBtn) undoBtn.disabled = (_undoStack.length === 0);
    if (redoBtn) redoBtn.disabled = (_redoStack.length === 0);
  }

  function isRestoring() { return _restoring; }

  App.undo = {
    push: push,
    undo: undo,
    redo: redo,
    canUndo: function () { return _undoStack.length > 0; },
    canRedo: function () { return _redoStack.length > 0; },
    updateButtons: updateButtons,
    isRestoring: isRestoring
  };
})();
