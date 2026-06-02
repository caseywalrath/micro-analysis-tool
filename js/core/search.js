(function () {
  var App = window.App = window.App || {};

  var NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  var DEBOUNCE_MS = 350;
  var MIN_QUERY_LEN = 3;

  var ZOOM_BY_TYPE = {
    continent: 3,
    country: 5,
    state: 7,
    county: 9,
    city: 12,
    town: 12,
    village: 13,
    hamlet: 14,
    district: 13,
    locality: 14,
    neighbourhood: 14,
    suburb: 14,
    borough: 13,
    quarter: 14,
    road: 16,
    street: 16,
    house: 17,
    building: 17,
    residential: 15,
    postcode: 13
  };
  var DEFAULT_ZOOM = 13;

  var _timer = null;
  var _abortCtrl = null;
  var _highlightIdx = -1;
  var _results = [];

  var _input = document.getElementById("search-input");
  var _clearBtn = document.getElementById("search-clear");
  var _dropdown = document.getElementById("search-results");
  var _wrapper = document.getElementById("search-wrapper");

  function geocode(query, signal) {
    var center = App.map ? App.map.getCenter() : null;
    var url = NOMINATIM_URL +
      "?format=json&addressdetails=1&limit=5&q=" + encodeURIComponent(query);
    if (center) {
      url += "&viewbox=" +
        (center.lng - 2) + "," + (center.lat + 2) + "," +
        (center.lng + 2) + "," + (center.lat - 2) +
        "&bounded=0";
    }
    return fetch(url, {
      signal: signal,
      headers: { "Accept": "application/json" }
    }).then(function (r) { return r.json(); });
  }

  function typeLabel(r) {
    var t = r.type || "";
    if (t === "administrative") {
      var ac = r.address ? r.address.country_code : "";
      if (r.addresstype === "state") return "state";
      if (r.addresstype === "county") return "county";
      if (r.addresstype === "city") return "city";
      if (r.addresstype === "town") return "town";
      if (r.addresstype === "village") return "village";
      if (r.addresstype) return r.addresstype;
    }
    if (t === "residential" || t === "house" || t === "building") return t;
    if (r.addresstype) return r.addresstype;
    return t || "place";
  }

  function contextLine(r) {
    if (!r.address) return "";
    var parts = [];
    if (r.address.city && r.address.city !== r.name) parts.push(r.address.city);
    else if (r.address.town && r.address.town !== r.name) parts.push(r.address.town);
    else if (r.address.village && r.address.village !== r.name) parts.push(r.address.village);
    if (r.address.county && r.address.county !== r.name) parts.push(r.address.county);
    if (r.address.state && r.address.state !== r.name) parts.push(r.address.state);
    if (r.address.country && r.address.country !== "United States") parts.push(r.address.country);
    return parts.join(", ");
  }

  function flyToResult(r) {
    if (!App.map) return;
    var lon = parseFloat(r.lon);
    var lat = parseFloat(r.lat);
    if (r.boundingbox && r.boundingbox.length === 4) {
      var s = parseFloat(r.boundingbox[0]);
      var n = parseFloat(r.boundingbox[1]);
      var w = parseFloat(r.boundingbox[2]);
      var e = parseFloat(r.boundingbox[3]);
      if (Math.abs(n - s) > 0.001 || Math.abs(e - w) > 0.001) {
        App.map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 800, maxZoom: 18 });
        return;
      }
    }
    var tl = typeLabel(r);
    var zoom = ZOOM_BY_TYPE[tl] || DEFAULT_ZOOM;
    App.map.flyTo({ center: [lon, lat], zoom: zoom, duration: 800 });
  }

  function showDropdown(items) {
    _results = items;
    _highlightIdx = -1;
    _dropdown.innerHTML = "";
    if (!items || items.length === 0) {
      _dropdown.innerHTML = '<div class="search-no-results">No results found</div>';
      _dropdown.style.display = "block";
      return;
    }
    items.forEach(function (r, i) {
      var row = document.createElement("div");
      row.className = "search-result-item";
      row.setAttribute("role", "option");

      var tl = typeLabel(r);
      var name = r.display_name.split(",")[0];
      var ctx = contextLine(r);

      var html = '<div class="search-result-body">' +
        '<span class="search-result-name">' + escHtml(name) + '</span>';
      if (ctx) html += '<span class="search-result-context">' + escHtml(ctx) + '</span>';
      html += '</div>' +
        '<span class="search-result-type">' + escHtml(tl) + '</span>';
      row.innerHTML = html;

      row.addEventListener("click", function (e) {
        e.stopPropagation();
        selectResult(r);
      });
      _dropdown.appendChild(row);
    });
    _dropdown.style.display = "block";
  }

  function hideDropdown() {
    _dropdown.style.display = "none";
    _results = [];
    _highlightIdx = -1;
  }

  function highlightRow(idx) {
    var rows = _dropdown.querySelectorAll(".search-result-item");
    rows.forEach(function (r, i) {
      r.classList.toggle("search-result-active", i === idx);
    });
    _highlightIdx = idx;
  }

  function selectResult(r) {
    var name = r.display_name.split(",")[0];
    _input.value = name;
    _clearBtn.style.display = "";
    hideDropdown();
    flyToResult(r);
    if (typeof App.setStatus === "function") App.setStatus("Navigated to " + name);
  }

  function clearSearch() {
    _input.value = "";
    _clearBtn.style.display = "none";
    hideDropdown();
    if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
    clearTimeout(_timer);
  }

  function onInput() {
    var q = _input.value.trim();
    _clearBtn.style.display = q ? "" : "none";
    clearTimeout(_timer);
    if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }

    if (q.length < MIN_QUERY_LEN) {
      hideDropdown();
      return;
    }

    _dropdown.innerHTML = '<div class="search-loading">Searching…</div>';
    _dropdown.style.display = "block";

    _timer = setTimeout(function () {
      _abortCtrl = new AbortController();
      geocode(q, _abortCtrl.signal)
        .then(function (data) {
          _abortCtrl = null;
          showDropdown(data);
        })
        .catch(function (err) {
          if (err.name === "AbortError") return;
          _abortCtrl = null;
          _dropdown.innerHTML = '<div class="search-no-results">Search unavailable</div>';
          _dropdown.style.display = "block";
        });
    }, DEBOUNCE_MS);
  }

  function onKeydown(e) {
    if (!_dropdown || _dropdown.style.display === "none") {
      if (e.key === "Enter") {
        e.preventDefault();
        onInput();
      }
      return;
    }
    var rows = _dropdown.querySelectorAll(".search-result-item");
    var len = rows.length;
    if (!len) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightRow((_highlightIdx + 1) % len);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightRow((_highlightIdx - 1 + len) % len);
    } else if (e.key === "Enter") {
      e.preventDefault();
      var idx = _highlightIdx >= 0 ? _highlightIdx : 0;
      if (_results[idx]) selectResult(_results[idx]);
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  if (_input) {
    _input.addEventListener("input", onInput);
    _input.addEventListener("keydown", onKeydown);
  }
  if (_clearBtn) {
    _clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      clearSearch();
      _input.focus();
    });
  }

  document.addEventListener("click", function (e) {
    if (_wrapper && !_wrapper.contains(e.target)) {
      hideDropdown();
    }
  });

  App.clearSearch = clearSearch;
})();
