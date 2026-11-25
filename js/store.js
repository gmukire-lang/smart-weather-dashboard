/* ==========================================================================
   Weatherwise: local storage
   Preferences, saved cities, recent searches and the last good forecast are
   kept in this browser only. Everything is wrapped in try/catch because
   storage can be blocked (private mode) or full.
   ========================================================================== */

WW.store = (function () {
  "use strict";

  var KEYS = {
    settings: "ww.settings",
    cities: "ww.cities",
    recent: "ww.recent",
    last: "ww.last",
    cache: "ww.cache"
  };

  var DEFAULT_SETTINGS = { temp: "c", wind: "kmh", clock: "24", theme: "auto", motion: "on" };
  var ALLOWED = {
    temp: ["c", "f"], wind: ["kmh", "mph", "ms"], clock: ["24", "12"],
    theme: ["auto", "light", "dark"], motion: ["on", "off"]
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ── Settings ───────────────────────────────────────────────────────── */

  function loadSettings() {
    var saved = read(KEYS.settings, {}) || {};
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      out[key] = ALLOWED[key].indexOf(saved[key]) >= 0 ? saved[key] : DEFAULT_SETTINGS[key];
    });
    return out;
  }

  var settings = loadSettings();

  function setSetting(key, value) {
    if (!ALLOWED[key] || ALLOWED[key].indexOf(value) < 0) return;
    settings[key] = value;
    write(KEYS.settings, settings);
  }

  /* ── Places ─────────────────────────────────────────────────────────── */

  function cleanPlace(p) {
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number" || !p.name) return null;
    return {
      id: String(p.id != null ? p.id : p.lat.toFixed(2) + "," + p.lon.toFixed(2)),
      name: String(p.name), admin1: p.admin1 ? String(p.admin1) : "",
      country: p.country ? String(p.country) : "", countryCode: p.countryCode ? String(p.countryCode) : "",
      lat: p.lat, lon: p.lon
    };
  }

  function cleanList(list) {
    return (Array.isArray(list) ? list : []).map(cleanPlace).filter(Boolean);
  }

  function getCities() {
    var saved = read(KEYS.cities, null);
    if (saved == null) {
      // First visit: start with a small set so the comparison board is useful straight away.
      saved = WW.config.starterCities;
      write(KEYS.cities, saved);
    }
    return cleanList(saved);
  }

  /** The saved city that is the same place as this one (same name, within ~10 km), if any. */
  function matchSaved(place) {
    var id = WW.utils.placeId(place);
    return getCities().find(function (c) {
      return c.id === id || (c.name.toLowerCase() === String(place.name).toLowerCase() &&
        Math.abs(c.lat - place.lat) < 0.1 && Math.abs(c.lon - place.lon) < 0.1);
    }) || null;
  }

  function isSaved(place) {
    var id = WW.utils.placeId(place);
    return getCities().some(function (c) { return c.id === id; });
  }

  /** Returns "added", "exists" or "full". */
  function addCity(place) {
    var clean = cleanPlace(place);
    if (!clean) return "exists";
    var list = getCities();
    if (list.some(function (c) { return c.id === clean.id; })) return "exists";
    if (list.length >= WW.config.maxSavedCities) return "full";
    list.unshift(clean);
    write(KEYS.cities, list);
    return "added";
  }

  function removeCity(id) {
    var list = getCities();
    var index = list.findIndex(function (c) { return c.id === String(id); });
    if (index < 0) return null;
    var removed = list.splice(index, 1)[0];
    write(KEYS.cities, list);
    return { place: removed, index: index };
  }

  function restoreCity(place, index) {
    var list = getCities();
    list.splice(Math.min(index, list.length), 0, place);
    write(KEYS.cities, list);
  }

  function getRecent() { return cleanList(read(KEYS.recent, [])); }

  function addRecent(place) {
    var clean = cleanPlace(place);
    if (!clean) return;
    var list = getRecent().filter(function (p) { return p.id !== clean.id; });
    list.unshift(clean);
    write(KEYS.recent, list.slice(0, 5));
  }

  function clearRecent() { write(KEYS.recent, []); }

  function getLast() { return cleanPlace(read(KEYS.last, null)); }
  function setLast(place) { write(KEYS.last, cleanPlace(place)); }

  /* ── Forecast cache (shown when the API cannot be reached) ──────────── */

  function getCache(place) {
    var cache = read(KEYS.cache, {}) || {};
    var entry = cache[WW.utils.placeId(place)];
    return entry && entry.forecast && entry.forecast.current ? entry : null;
  }

  function setCache(place, bundle) {
    var cache = read(KEYS.cache, {}) || {};
    cache[WW.utils.placeId(place)] = { savedAt: Date.now(), forecast: bundle.forecast, air: bundle.air || null };

    // Keep only the five most recent places so storage never fills up.
    var ids = Object.keys(cache).sort(function (a, b) { return cache[b].savedAt - cache[a].savedAt; });
    ids.slice(5).forEach(function (id) { delete cache[id]; });

    if (!write(KEYS.cache, cache)) {
      // Storage full: keep just this one entry.
      var only = {};
      only[WW.utils.placeId(place)] = cache[WW.utils.placeId(place)];
      write(KEYS.cache, only);
    }
  }

  return {
    settings: settings, setSetting: setSetting,
    getCities: getCities, matchSaved: matchSaved, isSaved: isSaved, addCity: addCity, removeCity: removeCity, restoreCity: restoreCity,
    getRecent: getRecent, addRecent: addRecent, clearRecent: clearRecent,
    getLast: getLast, setLast: setLast,
    getCache: getCache, setCache: setCache
  };
})();
