WW.search = (function () {
  "use strict";

  var U = WW.utils;
  var wrap, input, panel, listEl, statusEl, clearBtn;
  var options = [];
  var activeIndex = -1;
  var controller = null;
  var handlers = {};

  function open() {
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  }

  function setActive(index) {
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach(function (opt, i) {
      opt.node.classList.toggle("is-active", i === activeIndex);
      opt.node.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    });
    var node = options[activeIndex].node;
    input.setAttribute("aria-activedescendant", node.id);
    node.scrollIntoView({ block: "nearest" });
  }

  function reset(statusText) {
    options = [];
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    statusEl.textContent = statusText || "";
    U.clear(listEl);
  }

  function highlight(name, query) {
    var at = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (at < 0) return [name];
    return [name.slice(0, at), U.el("mark", { text: name.slice(at, at + query.length) }), name.slice(at + query.length)];
  }

  function addOption(config) {
    var node = U.el("li", {
      class: "search__option", role: "option", id: "search-opt-" + options.length, "aria-selected": "false"
    },
      U.el("span", { class: "search__option-icon" }, U.icon(config.icon)),
      U.el("span", null,
        U.el("span", { class: "search__option-name" }, config.title),
        config.sub ? U.el("span", { class: "search__option-sub", text: config.sub }) : null),
      config.tag ? U.el("span", { class: "search__option-tag", text: config.tag }) : null);
    node.addEventListener("click", config.run);
    listEl.appendChild(node);
    options.push({ node: node, run: config.run });
  }

  function addPlace(place, query, glyph) {
    addOption({
      icon: glyph || "fa-location-dot",
      title: highlight(place.name, query),
      sub: U.placeSubtitle(place) || "Lat " + place.lat.toFixed(2) + ", lon " + place.lon.toFixed(2),
      tag: place.countryCode,
      run: function () { choose(place); }
    });
  }

  function message(glyph, title, detail, action) {
    var box = U.el("li", { class: "search__message", role: "presentation" },
      U.icon(glyph), U.el("strong", { text: title }), detail ? U.el("small", { text: detail }) : null);
    if (action) {
      box.appendChild(U.el("button", { class: "btn btn--small", type: "button", on: { click: action.run } },
        U.icon("fa-rotate-right"), " " + action.label));
    }
    listEl.appendChild(box);
  }

  function showIdle() {
    var recent = WW.store.getRecent();
    reset(recent.length ? "Recent searches" : "");
    addOption({
      icon: "fa-location-crosshairs", title: ["Use my current location"], sub: "Find the weather where you are",
      run: function () { finish(); if (handlers.onLocate) handlers.onLocate(); }
    });
    recent.forEach(function (place) { addPlace(place, "", "fa-clock-rotate-left"); });
    open();
  }

  function showLoading() {
    reset("Searching…");
    for (var i = 0; i < 3; i++) listEl.appendChild(U.el("li", { class: "skeleton skeleton--row", role: "presentation", style: { margin: "6px 4px" } }));
    open();
  }

  async function run(query) {
    if (controller) controller.abort();
    controller = new AbortController();
    var mine = controller;
    showLoading();

    try {
      var results = await WW.api.searchCities(query, mine.signal);
      if (mine !== controller) return;
      if (!wrap.contains(document.activeElement)) return close();

      if (!results.length) {
        reset("");
        message("fa-map-location-dot", "No places found for “" + query + "”",
          "Check the spelling, or try a larger city nearby.");
        return;
      }
      reset(results.length + (results.length === 1 ? " place found" : " places found"));
      results.forEach(function (place) { addPlace(place, query); });
      setActive(0);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (mine !== controller) return;
      var info = WW.api.explain(err);
      reset("");
      message(info.icon, err.kind === "offline" ? "You’re offline" : "Search isn’t available right now", info.text,
        { label: "Try again", run: function () { run(query); } });
    }
  }

  function syncClearButton() {
    wrap.classList.toggle("has-value", input.value.length > 0);
    clearBtn.hidden = input.value.length === 0;
  }

  var onInput = U.debounce(function () {
    var query = input.value.trim().slice(0, 80);
    syncClearButton();

    if (controller) { controller.abort(); controller = null; }
    if (!wrap.contains(document.activeElement)) return close();
    if (!query) return showIdle();
    if (query.length < 2) {
      reset("");
      message("fa-keyboard", "Keep typing…", "Enter at least 2 letters to search.");
      return open();
    }
    run(query);
  }, WW.config.searchDebounceMs);

  function finish() {
    if (controller) { controller.abort(); controller = null; }
    input.value = "";
    wrap.classList.remove("has-value");
    clearBtn.hidden = true;
    close();
    input.blur();
  }

  function choose(place) {
    finish();
    WW.store.addRecent(place);
    if (handlers.onSelect) handlers.onSelect(place);
  }

  function onKeydown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (panel.hidden) return input.value.trim() ? onInput() : showIdle();
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!panel.hidden) setActive(activeIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!panel.hidden && options.length) options[Math.max(0, activeIndex)].run();
    } else if (event.key === "Escape") {
      if (!panel.hidden) { event.preventDefault(); close(); }
      else if (input.value) { input.value = ""; syncClearButton(); }
    }
  }

  function focus() {
    input.focus();
    input.select();
  }

  function init(callbacks) {
    handlers = callbacks || {};
    wrap = document.getElementById("search");
    input = document.getElementById("search-input");
    panel = document.getElementById("search-panel");
    listEl = document.getElementById("search-list");
    statusEl = document.getElementById("search-status");
    clearBtn = document.getElementById("search-clear");

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("focus", function () { if (panel.hidden) { if (input.value.trim()) onInput(); else showIdle(); } });
    clearBtn.addEventListener("click", function () { input.value = ""; onInput(); input.focus(); });

    panel.addEventListener("pointerdown", function (e) { if (e.target.tagName !== "BUTTON") e.preventDefault(); });
    document.addEventListener("pointerdown", function (e) { if (!wrap.contains(e.target)) close(); });
    wrap.addEventListener("focusout", function (e) { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(); });

    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) || e.target.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); focus(); }
    });
  }

  return { init: init, focus: focus, close: close };
})();
