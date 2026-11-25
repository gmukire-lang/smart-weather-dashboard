WW.utils = (function () {
  "use strict";

  function applyAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === "class") node.setAttribute("class", value);
      else if (key === "text") node.textContent = value;
      else if (key === "style") Object.keys(value).forEach(function (p) { node.style.setProperty(p, value[p]); });
      else if (key === "on") Object.keys(value).forEach(function (evt) { node.addEventListener(evt, value[evt]); });
      else if (key === "data") Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
      else node.setAttribute(key, value === true ? "" : value);
    });
  }

  function appendKids(node, kids) {
    kids.forEach(function (kid) {
      if (kid == null || kid === false) return;
      if (Array.isArray(kid)) appendKids(node, kid);
      else node.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    applyAttrs(node, attrs);
    appendKids(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    applyAttrs(node, attrs);
    appendKids(node, Array.prototype.slice.call(arguments, 2));
    return node;
  }

  function icon(name, family) {
    return el("i", { class: "fa-" + (family || "solid") + " " + name, "aria-hidden": "true" });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function fill(node) {
    clear(node);
    appendKids(node, Array.prototype.slice.call(arguments, 1));
    return node;
  }

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function isNum(value) { return typeof value === "number" && isFinite(value); }

  function debounce(fn, wait) {
    var timer;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function settings() { return WW.store.settings; }

  function tempValue(c) {
    if (!isNum(c)) return null;
    return Math.round(settings().temp === "f" ? c * 9 / 5 + 32 : c);
  }
  function fmtTemp(c) {
    var v = tempValue(c);
    return v == null ? "–" : (Object.is(v, -0) ? 0 : v) + "°";
  }
  function tempUnit() { return settings().temp === "f" ? "°F" : "°C"; }
  function tempDelta(c) {
    return Math.round(settings().temp === "f" ? c * 9 / 5 : c);
  }

  function windValue(kmh) {
    if (!isNum(kmh)) return null;
    var unit = settings().wind;
    if (unit === "mph") return Math.round(kmh * 0.621371);
    if (unit === "ms") return Math.round(kmh / 3.6 * 10) / 10;
    return Math.round(kmh);
  }
  function windUnit() { return { kmh: "km/h", mph: "mph", ms: "m/s" }[settings().wind]; }
  function fmtWind(kmh) {
    var v = windValue(kmh);
    return v == null ? "–" : v + " " + windUnit();
  }

  function imperial() { return settings().wind === "mph"; }

  function fmtPrecip(mm) {
    if (!isNum(mm)) return "–";
    if (imperial()) return (Math.round(mm / 25.4 * 100) / 100) + " in";
    return (mm >= 10 ? Math.round(mm) : Math.round(mm * 10) / 10) + " mm";
  }
  function fmtDistance(metres) {
    if (!isNum(metres)) return "–";
    var km = metres / 1000;
    if (imperial()) {
      var mi = km * 0.621371;
      return (mi >= 10 ? Math.round(mi) : Math.round(mi * 10) / 10) + " mi";
    }
    return (km >= 10 ? Math.round(km) : Math.round(km * 10) / 10) + " km";
  }
  function fmtPercent(value) { return isNum(value) ? Math.round(value) + "%" : "–"; }

  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var COMPASS_LONG = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };
  function compass(deg) {
    if (!isNum(deg)) return "";
    return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }
  function compassLong(deg) {
    if (!isNum(deg)) return "";
    var eight = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    return COMPASS_LONG[eight];
  }

  function toMs(iso) {
    if (!iso) return NaN;
    return Date.parse(iso.length <= 10 ? iso + "T00:00:00Z" : iso.length === 16 ? iso + ":00Z" : iso + "Z");
  }

  function nowAt(utcOffsetSeconds) {
    return Date.now() + (utcOffsetSeconds || 0) * 1000;
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function fmtTime(ms) {
    if (!isNum(ms)) return "–";
    var d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes();
    if (settings().clock === "12") {
      return (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "am" : "pm");
    }
    return pad(h) + ":" + pad(m);
  }

  function fmtHour(ms) {
    if (!isNum(ms)) return "–";
    var h = new Date(ms).getUTCHours();
    if (settings().clock === "12") return (h % 12 || 12) + " " + (h < 12 ? "am" : "pm");
    return pad(h) + ":00";
  }

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function weekday(ms, long) {
    var name = DAYS[new Date(ms).getUTCDay()];
    return long ? name : name.slice(0, 3);
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }
  function isWeekend(ms) {
    var day = new Date(ms).getUTCDay();
    return day === 0 || day === 6;
  }
  function fmtDuration(ms) {
    var mins = Math.round(ms / 60000);
    return Math.floor(mins / 60) + " h " + pad(mins % 60) + " min";
  }
  function fmtAgo(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  function placeId(place) {
    return String(place.id != null ? place.id : place.lat.toFixed(2) + "," + place.lon.toFixed(2));
  }
  function placeSubtitle(place) {
    var parts = [];
    if (place.admin1 && place.admin1 !== place.name) parts.push(place.admin1);
    if (place.country) parts.push(place.country);
    return parts.join(", ");
  }

  function toast(message, options) {
    options = options || {};
    var host = document.getElementById("toasts");
    if (!host) return;
    var type = options.type || "info";
    var glyph = { info: "fa-circle-info", error: "fa-triangle-exclamation", success: "fa-circle-check" }[type];

    var node = el("div", { class: "toast toast--" + type, role: type === "error" ? "alert" : "status" },
      icon(glyph),
      el("span", { class: "toast__text", text: message })
    );

    function dismiss() {
      if (!node.parentNode) return;
      node.classList.add("is-leaving");
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    }

    if (options.action) {
      node.appendChild(el("button", {
        class: "toast__action", type: "button", text: options.action.label,
        on: { click: function () { options.action.onClick(); dismiss(); } }
      }));
    }
    node.appendChild(el("button", { class: "toast__close", type: "button", "aria-label": "Dismiss", on: { click: dismiss } }, icon("fa-xmark")));

    while (host.children.length >= 3) host.removeChild(host.firstChild);
    host.appendChild(node);
    setTimeout(dismiss, options.duration || (type === "error" ? 7000 : 4500));
  }

  return {
    el: el, svg: svg, icon: icon, clear: clear, fill: fill, $: $, $$: $$,
    clamp: clamp, isNum: isNum, debounce: debounce, seeded: seeded, prefersReducedMotion: prefersReducedMotion,
    tempValue: tempValue, fmtTemp: fmtTemp, tempUnit: tempUnit, tempDelta: tempDelta,
    windValue: windValue, windUnit: windUnit, fmtWind: fmtWind, imperial: imperial,
    fmtPrecip: fmtPrecip, fmtDistance: fmtDistance, fmtPercent: fmtPercent,
    compass: compass, compassLong: compassLong,
    toMs: toMs, nowAt: nowAt, fmtTime: fmtTime, fmtHour: fmtHour, weekday: weekday, fmtDate: fmtDate,
    isWeekend: isWeekend, fmtDuration: fmtDuration, fmtAgo: fmtAgo,
    placeId: placeId, placeSubtitle: placeSubtitle, toast: toast
  };
})();
