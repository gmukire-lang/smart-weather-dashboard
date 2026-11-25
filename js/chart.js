WW.chart = (function () {
  "use strict";

  var U = WW.utils;
  var host, iconsEl, tooltipEl, svgEl, crossEl, dotEl;
  var last = null;
  var layout = null;
  var active = -1;

  var METRICS = {
    temp: {
      label: "Temperature", color: "var(--c-temp)", type: "line",
      value: function (h) { return U.tempValue(h.temp); },
      format: function (v) { return v + "°"; }
    },
    rain: {
      label: "Rain chance", color: "var(--c-rain)", type: "bar", domain: [0, 100], step: 25,
      empty: "No rain expected in these hours",
      value: function (h) { return U.isNum(h.pop) ? Math.round(h.pop) : 0; },
      format: function (v) { return v + "%"; }
    },
    wind: {
      label: "Wind", color: "var(--c-wind)", type: "line", fromZero: true,
      value: function (h) { return U.windValue(h.wind) || 0; },
      format: function (v) { return v + " " + U.windUnit(); },
      tick: function (v) { return String(v); }
    },
    uv: {
      label: "UV index", color: "var(--c-uv)", type: "bar", fromZero: true, minTop: 8,
      empty: "UV index is 0 during these hours",
      value: function (h) { return U.isNum(h.uv) ? Math.round(h.uv * 10) / 10 : 0; },
      format: function (v) { return String(v); }
    }
  };

  function niceScale(min, max, metric) {
    if (metric.domain) return { lo: metric.domain[0], hi: metric.domain[1], step: metric.step };
    if (metric.fromZero) min = 0;
    if (metric.minTop) max = Math.max(max, metric.minTop);
    var rough = Math.max(max - min, 1) / 4;
    var pow = Math.pow(10, Math.floor(Math.log10(rough)));
    var frac = rough / pow;
    var step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    return { lo: lo, hi: hi, step: step };
  }

  function smoothPath(points) {
    if (!points.length) return "";
    var d = "M" + points[0][0].toFixed(1) + "," + points[0][1].toFixed(1);
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      d += " C" + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + "," + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
        " " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + "," + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
        " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    return d;
  }

  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return "M" + x + "," + (y + h) + " V" + (y + r) + " Q" + x + "," + y + " " + (x + r) + "," + y +
      " H" + (x + w - r) + " Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + " V" + (y + h) + " Z";
  }

  function render(options) {
    if (options) last = options;
    if (!host || !last || !last.hours.length) return;

    var hours = last.hours, metric = METRICS[last.metric] || METRICS.temp;
    var W = Math.max(280, host.clientWidth), plotH = W < 520 ? 170 : 210;
    var m = { top: 24, right: 12, bottom: 30, left: 38 };
    var H = m.top + plotH + m.bottom;
    var innerW = W - m.left - m.right;
    var band = innerW / hours.length;
    var values = hours.map(metric.value);
    var scale = niceScale(Math.min.apply(null, values), Math.max.apply(null, values), metric);

    function xAt(i) { return m.left + band * (i + 0.5); }
    function yAt(v) { return m.top + plotH * (1 - (v - scale.lo) / (scale.hi - scale.lo)); }
    layout = { m: m, band: band, xAt: xAt, yAt: yAt, values: values, W: W, plotH: plotH, metric: metric };

    U.clear(host);
    host.style.setProperty("--series", metric.color);

    var every = band * 2 >= 46 ? 2 : band * 3 >= 46 ? 3 : band * 4 >= 46 ? 4 : 6;
    iconsEl = U.el("div", { class: "chart__icons", "aria-hidden": "true" });
    host.appendChild(iconsEl);

    svgEl = U.svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": describe(hours, metric, values) });
    host.appendChild(svgEl);

    var run = null;
    hours.forEach(function (h, i) {
      if (!h.isDay && run == null) run = i;
      if ((h.isDay || i === hours.length - 1) && run != null) {
        var end = h.isDay ? i : i + 1;
        svgEl.appendChild(U.svg("rect", {
          class: "chart__band", x: m.left + band * run, y: m.top, width: band * (end - run), height: plotH, rx: 6
        }));
        run = null;
      }
    });

    for (var v = scale.lo; v <= scale.hi + 1e-9; v += scale.step) {
      var y = Math.round(yAt(v)) + 0.5;
      svgEl.appendChild(U.svg("line", { class: "chart__grid", x1: m.left, x2: W - m.right, y1: y, y2: y }));
      svgEl.appendChild(U.svg("text", { class: "chart__tick", x: m.left - 8, y: y + 4, "text-anchor": "end" },
        (metric.tick || metric.format)(Math.round(v * 10) / 10)));
    }

    hours.forEach(function (h, i) {
      if (i % every !== 0) return;
      var label = i === 0 && last.nowFirst ? "Now" : U.fmtHour(h.time);
      svgEl.appendChild(U.svg("text", { class: "chart__tick", x: xAt(i), y: H - 8, "text-anchor": "middle" }, label));
      var glyph = U.icon(WW.codes.describe(h.code, h.isDay).icon);
      glyph.style.left = (xAt(i) / W * 100) + "%";
      iconsEl.appendChild(glyph);
    });

    var points = values.map(function (val, i) { return [xAt(i), yAt(val)]; });
    if (metric.type === "line") {
      var line = smoothPath(points);
      var base = m.top + plotH;
      svgEl.appendChild(U.svg("path", { class: "chart__area", d: line + " L" + points[points.length - 1][0] + "," + base + " L" + points[0][0] + "," + base + " Z" }));
      svgEl.appendChild(U.svg("path", { class: "chart__line", d: line }));
    } else {
      var bw = Math.max(3, Math.min(24, band - 2));
      values.forEach(function (val, i) {
        var top = yAt(val), hgt = m.top + plotH - top;
        if (hgt < 0.5) return;
        svgEl.appendChild(U.svg("path", { class: "chart__bar", "data-i": i, d: barPath(xAt(i) - bw / 2, top, bw, hgt) }));
      });
    }

    if (metric.empty && Math.max.apply(null, values) <= 0) {
      svgEl.appendChild(U.svg("text", { class: "chart__empty", x: m.left + innerW / 2, y: m.top + plotH / 2, "text-anchor": "middle" }, metric.empty));
    }

    var hi = values.indexOf(Math.max.apply(null, values));
    var lo = values.indexOf(Math.min.apply(null, values));
    labelPoint(hi, -10, true);
    if (metric.type === "line" && lo !== hi && values[lo] !== values[hi]) labelPoint(lo, 20, false);

    crossEl = U.svg("line", { class: "chart__cross", y1: m.top, y2: m.top + plotH, visibility: "hidden" });
    dotEl = U.svg("circle", { class: "chart__dot", r: 5, visibility: "hidden" });
    svgEl.appendChild(crossEl);
    svgEl.appendChild(dotEl);

    tooltipEl = U.el("div", { class: "tooltip", role: "status" });
    host.appendChild(tooltipEl);
    active = -1;
  }

  function labelPoint(i, dy, isHigh) {
    var L = layout, value = L.values[i];
    if (L.metric.type === "bar" && value <= 0) return;
    var x = U.clamp(L.xAt(i), L.m.left + 16, L.W - L.m.right - 16);
    if (dy > 0 && L.yAt(value) + dy > L.m.top + L.plotH - 6) dy = -10;
    if (L.metric.type === "line") {
      svgEl.appendChild(U.svg("circle", { class: "chart__dot", cx: L.xAt(i), cy: L.yAt(value), r: 4 }));
    }
    svgEl.appendChild(U.svg("text", { class: "chart__label", x: x, y: L.yAt(value) + dy, "text-anchor": "middle" },
      L.metric.format(value)));
    void isHigh;
  }

  function describe(hours, metric, values) {
    var hi = Math.max.apply(null, values), lo = Math.min.apply(null, values);
    return metric.label + " for " + hours.length + " hours, from " + metric.format(lo) + " to " + metric.format(hi) +
      ". Highest at " + U.fmtHour(hours[values.indexOf(hi)].time) + ".";
  }

  function row(name, value, color) {
    return U.el("div", { class: "tooltip__row" },
      U.el("span", { class: "tooltip__key", style: { "--key": color || "transparent" } }),
      U.el("span", { class: "tooltip__name", text: name }),
      U.el("span", { class: "tooltip__value", text: value }));
  }

  function show(i) {
    if (!layout || !last) return;
    i = U.clamp(i, 0, last.hours.length - 1);
    if (i === active) return;
    active = i;

    var L = layout, h = last.hours[i], x = L.xAt(i);
    var info = WW.codes.describe(h.code, h.isDay);

    crossEl.setAttribute("x1", x); crossEl.setAttribute("x2", x);
    crossEl.setAttribute("visibility", "visible");
    if (L.metric.type === "line") {
      dotEl.setAttribute("cx", x); dotEl.setAttribute("cy", L.yAt(L.values[i]));
      dotEl.setAttribute("visibility", "visible");
    }
    U.$$(".chart__bar", svgEl).forEach(function (bar) {
      bar.classList.toggle("is-active", Number(bar.getAttribute("data-i")) === i);
    });

    U.fill(tooltipEl,
      U.el("div", { class: "tooltip__head" },
        U.icon(info.icon),
        U.el("span", { text: U.weekday(h.time) + " " + U.fmtHour(h.time) }),
        U.el("span", { text: info.label })),
      row("Temperature", U.fmtTemp(h.temp), "var(--c-temp)"),
      row("Feels like", U.fmtTemp(h.feels)),
      row("Rain chance", U.fmtPercent(h.pop), "var(--c-rain)"),
      row("Rainfall", U.fmtPrecip(h.precip)),
      row("Wind", U.fmtWind(h.wind), "var(--c-wind)"),
      row("UV index", U.isNum(h.uv) ? String(Math.round(h.uv * 10) / 10) : "–", "var(--c-uv)"));

    var scaleX = host.clientWidth / L.W;
    var px = x * scaleX, tipW = tooltipEl.offsetWidth;
    var left = px + 14 + tipW > host.clientWidth ? px - 14 - tipW : px + 14;
    tooltipEl.style.transform = "translate(" + Math.max(0, left).toFixed(0) + "px, 34px)";
    tooltipEl.classList.add("is-visible");
  }

  function hide() {
    active = -1;
    if (!tooltipEl) return;
    tooltipEl.classList.remove("is-visible");
    crossEl.setAttribute("visibility", "hidden");
    dotEl.setAttribute("visibility", "hidden");
    U.$$(".chart__bar.is-active", svgEl).forEach(function (bar) { bar.classList.remove("is-active"); });
  }

  function indexFromEvent(event) {
    var box = svgEl.getBoundingClientRect();
    var x = (event.clientX - box.left) / box.width * layout.W;
    return Math.floor((x - layout.m.left) / layout.band);
  }

  function init() {
    host = document.getElementById("chart");
    if (!host) return;

    host.addEventListener("pointermove", function (e) { if (layout && svgEl) show(indexFromEvent(e)); });
    host.addEventListener("pointerdown", function (e) { if (layout && svgEl) show(indexFromEvent(e)); });
    host.addEventListener("pointerleave", function () { if (document.activeElement !== host) hide(); });
    host.addEventListener("focus", function () { if (active < 0) show(0); });
    host.addEventListener("blur", hide);
    host.addEventListener("keydown", function (e) {
      if (!last) return;
      var next = active;
      if (e.key === "ArrowRight") next = active + 1;
      else if (e.key === "ArrowLeft") next = active - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last.hours.length - 1;
      else if (e.key === "Escape") { hide(); return; }
      else return;
      e.preventDefault();
      show(next);
    });

    if ("ResizeObserver" in window) {
      var seen = 0;
      new ResizeObserver(U.debounce(function () {
        if (host.clientWidth !== seen) { seen = host.clientWidth; render(); }
      }, 120)).observe(host);
    }
  }

  function renderTable(wrap, hours, nowFirst) {
    var head = ["Time", "Conditions", "Temp", "Feels like", "Rain chance", "Rainfall", "Wind", "Humidity", "UV"];
    var table = U.el("table", { class: "table" },
      U.el("caption", { class: "visually-hidden", text: "Hourly forecast" }),
      U.el("thead", null, U.el("tr", null, head.map(function (t) { return U.el("th", { scope: "col", text: t }); }))),
      U.el("tbody", null, hours.map(function (h, i) {
        var info = WW.codes.describe(h.code, h.isDay);
        return U.el("tr", { class: i === 0 && nowFirst ? "is-now" : "" },
          U.el("td", { text: (i === 0 && nowFirst ? "Now · " : U.weekday(h.time) + " ") + U.fmtHour(h.time) }),
          U.el("td", null, U.icon(info.icon), info.label),
          U.el("td", { text: U.fmtTemp(h.temp) }),
          U.el("td", { text: U.fmtTemp(h.feels) }),
          U.el("td", { text: U.fmtPercent(h.pop) }),
          U.el("td", { text: U.fmtPrecip(h.precip) }),
          U.el("td", { text: U.fmtWind(h.wind) }),
          U.el("td", { text: U.fmtPercent(h.humidity) }),
          U.el("td", { text: U.isNum(h.uv) ? String(Math.round(h.uv * 10) / 10) : "–" }));
      })));
    U.fill(wrap, table);
  }

  return { init: init, render: render, renderTable: renderTable };
})();
