/* ==========================================================================
   Weatherwise: "My cities"
   A comparison board for saved places. All cities are fetched in a single
   API request, then sorted, filtered and searched entirely in the browser.
   ========================================================================== */

WW.cities = (function () {
  "use strict";

  var U = WW.utils, el = U.el, icon = U.icon;
  var view = { sort: "added", filter: "all", query: "" };
  var snapshot = {};      // placeId → current readings
  var error = null;
  var loading = false;
  var controller = null;
  var handlers = {};
  var currentId = null;

  function byName(a, b) { return a.place.name.localeCompare(b.place.name); }

  var SORTS = {
    added: { key: null, compare: null },
    name: { key: null, compare: byName },
    warm: { key: "temp", compare: function (a, b) { return U.tempValue(b.data.temp) - U.tempValue(a.data.temp) || byName(a, b); } },
    cool: { key: "temp", compare: function (a, b) { return U.tempValue(a.data.temp) - U.tempValue(b.data.temp) || byName(a, b); } },
    humid: { key: "humidity", compare: function (a, b) { return b.data.humidity - a.data.humidity || byName(a, b); } },
    wind: { key: "wind", compare: function (a, b) { return Math.round(b.data.wind) - Math.round(a.data.wind) || byName(a, b); } }
  };

  function body() { return document.getElementById("cities-body"); }

  /* ── Data ───────────────────────────────────────────────────────────── */

  async function refresh() {
    var places = WW.store.getCities();
    if (controller) controller.abort();
    if (!places.length) { snapshot = {}; error = null; loading = false; return render(); }

    controller = new AbortController();
    var mine = controller;
    loading = true;
    render();

    try {
      var data = await WW.api.getCitiesSnapshot(places, mine.signal);
      if (mine !== controller) return;
      snapshot = data;
      error = null;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (mine !== controller) return;
      error = err;
    }
    loading = false;
    render();
  }

  function remove(place) {
    var removed = WW.store.removeCity(place.id);
    if (!removed) return;
    render();
    if (handlers.onChange) handlers.onChange();
    U.toast(place.name + " removed from your cities.", {
      action: {
        label: "Undo",
        onClick: function () {
          WW.store.restoreCity(removed.place, removed.index);
          render();
          if (handlers.onChange) handlers.onChange();
        }
      }
    });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  function card(item, rank) {
    var place = item.place, data = item.data;
    var sortKey = SORTS[view.sort].key;
    var where = place.country || U.placeSubtitle(place);

    var content;
    if (data) {
      var info = WW.codes.describe(data.code, data.isDay);
      content = [
        el("div", { class: "city__main" },
          icon(info.icon),
          el("span", { class: "city__temp", text: U.fmtTemp(data.temp) }),
          el("span", { class: "city__cond" }, info.label, el("br"), "H " + U.fmtTemp(data.max) + " · L " + U.fmtTemp(data.min))),
        el("div", { class: "city__stats" },
          el("span", { class: sortKey === "humidity" ? "is-key" : "" }, icon("fa-droplet"), U.fmtPercent(data.humidity)),
          el("span", { class: sortKey === "wind" ? "is-key" : "" }, icon("fa-wind"), U.fmtWind(data.wind)),
          el("span", null, icon("fa-clock", "regular"), U.fmtTime(U.nowAt(data.utcOffset))))
      ];
    } else {
      content = [el("div", { class: "city__stats" }, el("span", null, icon(loading ? "fa-spinner fa-spin" : "fa-circle-exclamation"),
        loading ? "Loading…" : "No reading available"))];
    }

    return el("article", { class: "city" + (place.id === currentId ? " is-current" : "") },
      el("button", {
        class: "city__open", type: "button",
        "aria-label": "Show weather for " + place.name + (where ? ", " + where : "") +
          (data ? ". Now " + U.fmtTemp(data.temp) + ", " + WW.codes.describe(data.code, data.isDay).label : ""),
        on: { click: function () { if (handlers.onOpen) handlers.onOpen(place); } }
      },
        el("div", null,
          place.id === currentId ? el("p", { class: "city__badge" }, icon("fa-location-dot"), "Viewing")
            : sortKey && data ? el("p", { class: "city__badge", text: "#" + (rank + 1) }) : null,
          el("p", { class: "city__name", text: place.name }),
          el("p", { class: "city__where", text: where || " " })),
        content),
      el("button", {
        class: "city__remove", type: "button", "aria-label": "Remove " + place.name + " from my cities", title: "Remove",
        on: { click: function () { remove(place); } }
      }, icon("fa-xmark")));
  }

  function emptyState(glyph, title, text, action) {
    return el("div", { class: "state" }, icon(glyph), el("strong", { text: title }), el("p", { text: text }),
      action ? el("button", { class: "btn btn--small", type: "button", on: { click: action.run } }, action.label) : null);
  }

  function render() {
    var host = body();
    if (!host) return;
    var places = WW.store.getCities();
    var items = places.map(function (place) { return { place: place, data: snapshot[place.id] || null }; });

    // Filter chips show how many cities each one would match.
    U.$$("#cities-filter .chip").forEach(function (chip) {
      var key = chip.dataset.filter;
      chip.setAttribute("aria-pressed", key === view.filter ? "true" : "false");
      var count = chip.querySelector(".chip__count") || chip.appendChild(el("span", { class: "chip__count" }));
      count.textContent = String(items.filter(function (it) { return key === "all" || (it.data && WW.codes.bucket(it.data.code) === key); }).length);
    });
    document.getElementById("cities-sub").textContent = places.length
      ? places.length + (places.length === 1 ? " saved city" : " saved cities") + " · tap one to open it"
      : "Compare the places you care about";

    if (!places.length) {
      return U.fill(host, emptyState("fa-star", "No saved cities yet",
        "Search for a city, then press “Save city” to pin it here and compare it with others.",
        { label: "Search for a city", run: function () { WW.search.focus(); } }));
    }

    if (error && !Object.keys(snapshot).length) {
      var info = WW.api.explain(error);
      return U.fill(host, emptyState(info.icon, "Couldn’t load your cities", info.text, { label: "Try again", run: refresh }));
    }

    var query = view.query.trim().toLowerCase();
    var shown = items.filter(function (it) {
      var matchesText = !query || (it.place.name + " " + it.place.country + " " + it.place.admin1).toLowerCase().indexOf(query) >= 0;
      var matchesSky = view.filter === "all" || (it.data && WW.codes.bucket(it.data.code) === view.filter);
      return matchesText && matchesSky;
    });

    var sorter = SORTS[view.sort];
    if (sorter.compare) {
      shown.sort(function (a, b) {
        if (sorter.key) { // cities without a reading always go last
          if (!a.data || !b.data) return (a.data ? 0 : 1) - (b.data ? 0 : 1);
        }
        return sorter.compare(a, b);
      });
    }

    if (!shown.length) {
      return U.fill(host, emptyState("fa-filter-circle-xmark", "No cities match",
        query ? "Nothing in your list matches “" + view.query.trim() + "” with this filter." : "None of your cities has this weather right now.",
        { label: "Clear filters", run: function () { setView({ filter: "all", query: "" }); } }));
    }

    U.fill(host,
      el("div", { class: "city-grid" }, shown.map(card)),
      el("p", { class: "day-summary", role: "status" },
        "Showing " + shown.length + " of " + places.length + (places.length === 1 ? " city" : " cities") + "." +
        (error ? " Couldn’t refresh just now, these are the last readings we got." : "")));
  }

  function setView(patch) {
    Object.assign(view, patch);
    document.getElementById("cities-sort").value = view.sort;
    var input = document.getElementById("cities-query");
    if (input.value !== view.query) input.value = view.query;
    render();
  }

  function setCurrent(id) { currentId = id; render(); }

  function init(callbacks) {
    handlers = callbacks || {};
    document.getElementById("cities-sort").addEventListener("change", function (e) { setView({ sort: e.target.value }); });
    document.getElementById("cities-query").addEventListener("input", function (e) { setView({ query: e.target.value }); });
    document.getElementById("cities-filter").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (chip) setView({ filter: chip.dataset.filter });
    });
  }

  return { init: init, refresh: refresh, render: render, setCurrent: setCurrent };
})();
