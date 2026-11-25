/* ==========================================================================
   Weatherwise: app controller
   Owns the state, loads data, decides what to show when something fails,
   and wires up every control on the page.

   Failure strategy, in order:
     1. Air quality fails        → forecast still shows; that card offers a retry.
     2. Forecast fails, cached   → show the saved forecast with a clear "saved X ago" banner.
     3. Forecast fails, on screen→ keep what is on screen, explain in a toast.
     4. Nothing to show at all   → full-page message with "Try again".
   ========================================================================== */

WW.app = (function () {
  "use strict";

  var U = WW.utils, api = WW.api, store = WW.store, cfg = WW.config;
  var DAY = 86400000;

  var state = WW.state = {
    place: null,
    forecast: null,
    air: null,
    airError: null,
    insights: null,
    stale: null,          // { savedAt, error } when showing a saved forecast
    selectedDay: null,    // "YYYY-MM-DD" or null for "next 24 hours"
    metric: "temp",
    tableView: false,
    dailySort: "date",
    dailyFilter: "all"
  };

  var controller = null;
  var failedPlace = null; // what "Try again" should reload

  function byId(id) { return document.getElementById(id); }

  /* ── Loading states ─────────────────────────────────────────────────── */

  function setBusy(busy) {
    var dash = byId("dashboard");
    dash.classList.toggle("is-loading", busy && !state.forecast);
    dash.classList.toggle("is-refreshing", busy && !!state.forecast);
    dash.setAttribute("aria-busy", busy ? "true" : "false");
    byId("btn-refresh").classList.toggle("is-busy", busy);
  }

  function showFatal(error) {
    var info = api.explain(error);
    byId("fatal-icon").className = "fa-solid " + info.icon;
    byId("fatal-title").textContent = info.title;
    byId("fatal-text").textContent = info.text;
    byId("fatal").hidden = false;
    byId("dashboard").hidden = true;
    byId("stale-banner").hidden = true;
    document.title = "Weatherwise | Smart Weather Dashboard";
  }

  function showDashboard() {
    byId("fatal").hidden = true;
    byId("dashboard").hidden = false;

    state.insights = WW.insights.build(state.forecast, state.air);
    WW.render.all(state);
    WW.cities.setCurrent(U.placeId(state.forecast.place));

    var banner = byId("stale-banner");
    if (state.stale) {
      var why = api.explain(state.stale.error);
      byId("stale-text").textContent = why.title + ". Showing the forecast we saved " +
        U.fmtAgo(Date.now() - state.stale.savedAt) + ", it may be out of date.";
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  /** A saved forecast was correct when it was fetched; move its "now" to the present. */
  function rehydrate(entry) {
    var f = entry.forecast;
    if (!f || !Array.isArray(f.hourly) || !Array.isArray(f.days)) return null;
    var now = U.nowAt(f.utcOffset);
    var hourStart = now - (now % 3600000);
    var nowIndex = f.hourly.findIndex(function (h) { return h.time >= hourStart; });
    var days = f.days.filter(function (d) { return d.time + DAY > now; });
    if (nowIndex < 0 || !days.length || f.hourly.length - nowIndex < 6) return null; // too old to be useful
    f.nowIndex = nowIndex;
    f.days = days;
    return f;
  }

  /* ── Loading a place ────────────────────────────────────────────────── */

  async function load(place, options) {
    options = options || {};
    if (controller) controller.abort();
    controller = new AbortController();
    var mine = controller;
    place = store.matchSaved(place) || place;
    var samePlace = state.forecast && U.placeId(state.forecast.place) === U.placeId(place);

    state.place = place;
    setBusy(true);

    var results = await Promise.allSettled([
      api.getForecast(place, mine.signal),
      api.getAirQuality(place, mine.signal)
    ]);
    if (mine !== controller) return; // a newer load has replaced this one

    var forecast = results[0], air = results[1];

    if (forecast.status === "fulfilled") {
      state.forecast = forecast.value;
      state.air = air.status === "fulfilled" ? air.value : null;
      state.airError = air.status === "rejected" ? air.reason : null;
      state.stale = null;
      failedPlace = null;
      if (!samePlace) state.selectedDay = null;
      if (state.selectedDay && !state.forecast.days.some(function (d) { return d.date === state.selectedDay; })) state.selectedDay = null;

      store.setLast(place);
      store.setCache(place, { forecast: state.forecast, air: state.air });
      setBusy(false);
      showDashboard();
      if (options.announce) U.toast("Showing weather for " + place.name + ".", { type: "success" });
      return;
    }

    // ── The forecast failed ──
    var error = forecast.reason;
    setBusy(false);
    if (error && error.name === "AbortError") return;
    failedPlace = place;

    var cached = store.getCache(place);
    var saved = cached && rehydrate(cached);
    if (saved) {
      state.forecast = saved;
      state.air = cached.air;
      state.airError = null;
      state.stale = { savedAt: cached.savedAt, error: error };
      if (!samePlace) state.selectedDay = null;
      showDashboard();
      return;
    }

    if (state.forecast) {
      // Keep what is on screen rather than replacing it with an error page.
      state.place = state.forecast.place;
      if (samePlace) {
        state.stale = { savedAt: state.forecast.fetchedAt, error: error };
        showDashboard();
      } else if (!options.quiet) {
        U.toast("Couldn’t load " + place.name + ". " + api.explain(error).text, {
          type: "error", action: { label: "Try again", onClick: function () { load(place); } }
        });
      }
      return;
    }

    showFatal(error);
  }

  function retry() {
    load(failedPlace || state.place || store.getLast() || cfg.defaultPlace);
    WW.cities.refresh();
  }

  async function retryAir() {
    if (!state.forecast) return;
    var place = state.forecast.place;
    state.airError = null;
    WW.render.air(state);
    try {
      state.air = await api.getAirQuality(place);
    } catch (err) {
      state.airError = err;
    }
    if (!state.forecast || U.placeId(state.forecast.place) !== U.placeId(place)) return;
    state.insights = WW.insights.build(state.forecast, state.air);
    WW.render.all(state);
  }

  /* ── Location ───────────────────────────────────────────────────────── */

  async function locate() {
    var button = byId("btn-locate");
    button.classList.add("is-busy");
    button.querySelector("i").className = "fa-solid fa-spinner";

    try {
      var pos = await api.devicePosition();
      var place;
      try {
        place = await api.reverseGeocode(pos.lat, pos.lon);
      } catch (e) {
        // The name lookup failed, but we still have coordinates, carry on with those.
        place = { id: pos.lat.toFixed(2) + "," + pos.lon.toFixed(2), name: "My location", admin1: "", country: "", countryCode: "", lat: pos.lat, lon: pos.lon };
      }
      await load(place, { announce: true });
    } catch (geo) {
      if (geo && geo.geo && geo.geo !== "denied") {
        // No precise fix available (e.g. plain-http page or no GPS): fall back to the approximate area.
        try {
          var rough = await api.approximateLocation();
          await load(rough);
          U.toast("Precise location isn’t available here, so this is your approximate area: " + rough.name + ".");
        } catch (e2) {
          U.toast(geo.message, { type: "error" });
        }
      } else {
        U.toast((geo && geo.message) || "We couldn’t find your location. Search for your city instead.", { type: "error" });
      }
    } finally {
      button.classList.remove("is-busy");
      button.querySelector("i").className = "fa-solid fa-location-crosshairs";
    }
  }

  /* ── Small state changes ────────────────────────────────────────────── */

  function selectDay(date) {
    state.selectedDay = date;
    if (!state.forecast) return;
    WW.render.hourly(state);
    WW.render.daily(state);
    if (date) {
      var card = byId("hourly-title").closest(".card");
      var box = card.getBoundingClientRect();
      if (box.top < 80 || box.bottom > window.innerHeight) {
        card.scrollIntoView({ behavior: U.prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
    }
  }

  function setDailyFilter(filter) {
    state.dailyFilter = filter;
    if (state.forecast) WW.render.daily(state);
  }

  function toggleSave() {
    if (!state.forecast) return;
    var place = state.forecast.place;
    if (store.isSaved(place)) {
      store.removeCity(U.placeId(place));
      U.toast(place.name + " removed from your cities.");
    } else {
      var result = store.addCity(place);
      if (result === "full") {
        return U.toast("You can save up to " + cfg.maxSavedCities + " cities. Remove one to add another.", { type: "error" });
      }
      U.toast(place.name + " saved to your cities.", { type: "success" });
    }
    WW.render.saveButton(state);
    WW.cities.refresh();
  }

  /* ── Settings ───────────────────────────────────────────────────────── */

  function applyTheme() {
    var theme = store.settings.theme;
    if (theme === "auto") theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#131412" : "#f3eee4");
  }

  function syncSettingsUi() {
    U.$$("[data-setting]").forEach(function (group) {
      U.$$("button", group).forEach(function (b) {
        b.setAttribute("aria-pressed", store.settings[group.dataset.setting] === b.dataset.value ? "true" : "false");
      });
    });
    U.$$("#unit-toggle button").forEach(function (b) {
      b.setAttribute("aria-pressed", store.settings.temp === b.dataset.unit ? "true" : "false");
    });
  }

  function changeSetting(key, value) {
    store.setSetting(key, value);
    syncSettingsUi();
    if (key === "theme") applyTheme();
    if (key === "motion") WW.scene.setMotion(value === "on");
    if (state.forecast) showDashboard();   // units / clock changed: re-render with the same data, no refetch
    WW.cities.render();
  }

  /* ── Wiring ─────────────────────────────────────────────────────────── */

  function bind() {
    byId("btn-refresh").addEventListener("click", function () { retry(); });
    byId("btn-save").addEventListener("click", toggleSave);
    byId("btn-locate").addEventListener("click", locate);
    byId("stale-retry").addEventListener("click", retry);
    byId("fatal-retry").addEventListener("click", retry);
    byId("fatal-search").addEventListener("click", function () { WW.search.focus(); });

    byId("unit-toggle").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) changeSetting("temp", b.dataset.unit);
    });

    var dialog = byId("settings-dialog");
    byId("btn-settings").addEventListener("click", function () {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    });
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) return dialog.close();           // click on the backdrop
      var b = e.target.closest("[data-setting] button");
      if (b) changeSetting(b.closest("[data-setting]").dataset.setting, b.dataset.value);
    });

    byId("metric-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !state.forecast) return;
      state.metric = b.dataset.metric;
      WW.render.hourly(state);
    });
    byId("btn-table").addEventListener("click", function () {
      state.tableView = !state.tableView;
      if (state.forecast) WW.render.hourly(state);
    });

    byId("daily-sort").addEventListener("change", function (e) {
      state.dailySort = e.target.value;
      if (state.forecast) WW.render.daily(state);
    });
    byId("daily-filter").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (chip) setDailyFilter(chip.dataset.filter);
    });

    // Connection changes
    function syncOnline() { byId("offline-banner").hidden = navigator.onLine !== false; }
    window.addEventListener("offline", syncOnline);
    window.addEventListener("online", function () {
      syncOnline();
      if (state.stale || !state.forecast) { U.toast("Back online, refreshing.", { type: "success" }); retry(); }
    });
    syncOnline();

    // Keep things fresh: the clock every 30 s, the data every few minutes and when the tab returns.
    setInterval(function () {
      if (!state.forecast) return;
      WW.render.clock(state);
      WW.render.footer(state);
    }, 30000);

    function refreshIfOld() {
      if (document.hidden || !state.forecast || navigator.onLine === false) return;
      if (Date.now() - state.forecast.fetchedAt > cfg.refreshMinutes * 60000) {
        load(state.forecast.place, { quiet: true });
        WW.cities.refresh();
      }
    }
    setInterval(refreshIfOld, 60000);
    document.addEventListener("visibilitychange", refreshIfOld);

    if (window.matchMedia) {
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      var onScheme = function () { if (store.settings.theme === "auto") applyTheme(); };
      if (media.addEventListener) media.addEventListener("change", onScheme);
    }

    var topbar = document.querySelector(".topbar");
    var onScroll = function () { topbar.classList.toggle("is-stuck", window.scrollY > 4); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  async function start() {
    applyTheme();
    syncSettingsUi();
    WW.scene.init();
    WW.chart.init();
    WW.search.init({ onSelect: function (place) { load(place); window.scrollTo({ top: 0, behavior: U.prefersReducedMotion() ? "auto" : "smooth" }); }, onLocate: locate });
    WW.cities.init({
      onOpen: function (place) { load(place); window.scrollTo({ top: 0, behavior: U.prefersReducedMotion() ? "auto" : "smooth" }); },
      onChange: function () { WW.render.saveButton(state); }
    });
    bind();

    WW.cities.refresh();

    // Where to start: the last city viewed, else the visitor's approximate area, else a default.
    var place = store.getLast();
    if (!place) {
      try { place = await api.approximateLocation(); }
      catch (e) { place = cfg.defaultPlace; }
    }
    load(place);
  }

  // Scripts are loaded with "defer", so the DOM is already parsed here. Starting on the
  // next tick lets this module finish defining WW.app before anything calls into it.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, 0);

  return {
    load: load, retry: retry, retryAir: retryAir, locate: locate,
    selectDay: selectDay, setDailyFilter: setDailyFilter
  };
})();
