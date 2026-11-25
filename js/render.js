WW.render = (function () {
  "use strict";

  var U = WW.utils, el = U.el, icon = U.icon;
  var HOUR = 3600000, DAY = 86400000;

  function byId(id) { return document.getElementById(id); }

  function clock(state) {
    var f = state.forecast;
    if (!f) return;
    var now = U.nowAt(f.utcOffset);
    var where = U.placeSubtitle(f.place);
    byId("place-meta").textContent = (where ? where + " · " : "") +
      U.weekday(now, true) + " " + U.fmtDate(now) + ", " + U.fmtTime(now) + " local time";
  }

  function hero(state) {
    var f = state.forecast, c = f.current, today = f.days[0];
    var info = WW.codes.describe(c.code, c.isDay);

    byId("place-name").textContent = f.place.name;
    clock(state);
    byId("now-temp").textContent = U.fmtTemp(c.temp);
    U.fill(byId("now-label"), icon(info.icon), info.label);
    byId("now-sub").textContent = "Feels like " + U.fmtTemp(c.feels) + " · High " + U.fmtTemp(today.max) + " · Low " + U.fmtTemp(today.min);

    var headline = byId("now-headline");
    U.fill(headline, icon("fa-wand-magic-sparkles"), el("span", { text: state.insights.headline }));
    headline.hidden = false;

    document.title = U.fmtTemp(c.temp) + " " + f.place.name + " | Weatherwise";
    saveButton(state);
  }

  function saveButton(state) {
    var button = byId("btn-save");
    if (!state.forecast) return;
    var saved = WW.store.isSaved(state.forecast.place);
    button.setAttribute("aria-pressed", saved ? "true" : "false");
    button.setAttribute("aria-label", saved ? "Remove " + state.forecast.place.name + " from my cities" : "Save " + state.forecast.place.name + " to my cities");
    U.fill(button, icon("fa-star", saved ? "solid" : "regular"), el("span", { text: saved ? "Saved" : "Save city" }));
  }

  function brief(state) {
    U.fill(byId("brief-list"), state.insights.items.map(function (item) {
      return el("li", { class: "brief__item", data: { tone: item.tone } },
        el("span", { class: "brief__icon" }, icon(item.icon)),
        el("div", null,
          el("p", { class: "brief__title", text: item.title }),
          el("p", { class: "brief__detail", text: item.detail })));
    }));

    U.fill(byId("activity-list"), state.insights.activities.map(function (a) {
      return el("li", { class: "activity" },
        el("div", { class: "activity__top" },
          el("span", { class: "activity__name" }, icon(a.icon), a.label),
          el("span", { class: "activity__rating", text: a.rating.label })),
        el("div", { class: "meter", role: "img", "aria-label": a.label + ": " + a.rating.label + ", " + a.score + " out of 100" },
          el("span", { class: "meter__fill", style: { "--value": a.score + "%", "--meter": a.rating.color } })));
    }));
  }

  function chartHours(state) {
    var f = state.forecast;
    if (state.selectedDay) {
      var start = U.toMs(state.selectedDay);
      var picked = f.hourly.filter(function (h) { return h.time >= start && h.time < start + DAY; });
      if (picked.length) return { hours: picked, nowFirst: false };
    }
    return { hours: f.hourly.slice(f.nowIndex, f.nowIndex + 24), nowFirst: true };
  }

  function hourly(state) {
    var f = state.forecast, view = chartHours(state);
    var sub = byId("hourly-sub");

    if (view.nowFirst) {
      sub.textContent = "Next 24 hours in " + f.place.name;
    } else {
      var start = U.toMs(state.selectedDay);
      U.fill(sub, U.weekday(start, true) + " " + U.fmtDate(start) + " in " + f.place.name + " · ",
        el("button", { class: "link-btn", type: "button", on: { click: function () { WW.app.selectDay(null); } } },
          "Back to next 24 hours"));
    }

    U.$$("#metric-tabs button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.metric === state.metric ? "true" : "false");
    });

    var chartEl = byId("chart"), tableWrap = byId("hourly-table-wrap"), tableBtn = byId("btn-table");
    tableBtn.setAttribute("aria-pressed", state.tableView ? "true" : "false");
    chartEl.hidden = state.tableView;
    tableWrap.hidden = !state.tableView;
    U.$$("#metric-tabs button").forEach(function (b) { b.disabled = state.tableView; });
    byId("metric-tabs").style.opacity = state.tableView ? "0.45" : "";

    if (state.tableView) WW.chart.renderTable(tableWrap, view.hours, view.nowFirst);
    else WW.chart.render({ hours: view.hours, metric: state.metric, nowFirst: view.nowFirst });
  }

  function tile(t) {
    return el("article", { class: "tile", style: t.color ? { "--tile-color": t.color } : null },
      el("header", { class: "tile__head" },
        el("span", { class: "tile__icon" }, icon(t.icon)),
        el("h3", { class: "tile__label", text: t.label })),
      el("div", { class: "tile__body" },
        el("div", null,
          el("p", { class: "tile__value" }, t.value, t.unit ? el("span", { class: "tile__unit", text: t.unit }) : null),
          t.tag ? el("p", { class: "tile__tag" }, t.tag) : null),
        t.side || null),
      t.viz ? el("div", { class: "tile__viz" }, t.viz) : null,
      el("p", { class: "tile__note", style: t.viz ? null : { "margin-top": "auto" }, text: t.note }));
  }

  function meter(percent, color, label) {
    return el("div", { class: "meter", role: "img", "aria-label": label },
      el("span", { class: "meter__fill", style: { "--value": U.clamp(percent, 0, 100) + "%", "--meter": color } }));
  }

  function compassDial(direction) {
    var dial = U.svg("svg", { class: "compass", viewBox: "0 0 64 64", role: "img", "aria-label": "Wind from the " + U.compassLong(direction) },
      U.svg("circle", { class: "compass__ring", cx: 32, cy: 32, r: 30 }),
      U.svg("text", { class: "compass__n", x: 32, y: 13 }, "N"));
    [90, 180, 270].forEach(function (deg) {
      var rad = deg * Math.PI / 180;
      dial.appendChild(U.svg("line", {
        class: "compass__tick",
        x1: 32 + Math.sin(rad) * 24, y1: 32 - Math.cos(rad) * 24, x2: 32 + Math.sin(rad) * 28, y2: 32 - Math.cos(rad) * 28
      }));
    });
    var arrow = U.svg("path", { class: "compass__arrow", d: "M32 14 39 34h-5v14h-4V34h-5Z" });
    arrow.style.transform = "rotate(" + ((U.isNum(direction) ? direction : 0) + 180) + "deg)";
    dial.appendChild(arrow);
    return dial;
  }

  function levelScale(levels, weights, position, labelText, ends) {
    var active = Math.min(levels.length - 1, Math.floor(position.index));
    return el("div", { class: "scale", role: "img", "aria-label": labelText },
      el("div", { class: "scale__track" },
        levels.map(function (level, i) {
          return el("span", { class: "scale__seg" + (i === active ? " is-on" : ""), style: { "--seg": level.color, "--w": String(weights[i]) } });
        }),
        el("span", { class: "scale__pin", style: { "--at": (U.clamp(position.fraction, 0.02, 0.98) * 100).toFixed(1) + "%" } })),
      el("div", { class: "scale__ends" }, el("span", { text: ends[0] }), el("span", { text: ends[1] })));
  }

  function sunPath(progress, isDay) {
    var p = U.clamp(progress, 0, 1);
    var x = 100 - 88 * Math.cos(Math.PI * p), y = 56 - 48 * Math.sin(Math.PI * p);
    var g = U.svg("svg", { class: "sunpath", viewBox: "0 0 200 64", "aria-hidden": "true" },
      U.svg("path", { class: "sunpath__arc", d: "M12,56 A88,48 0 0 1 188,56" }),
      U.svg("line", { class: "sunpath__ground", x1: 0, x2: 200, y1: 56.5, y2: 56.5 }));
    if (isDay) {
      g.appendChild(U.svg("path", { class: "sunpath__done", d: "M12,56 A88,48 0 0 1 " + x.toFixed(1) + "," + y.toFixed(1) }));
      g.appendChild(U.svg("circle", { class: "sunpath__sun", cx: x.toFixed(1), cy: y.toFixed(1), r: 6 }));
    }
    return g;
  }

  function miniBars(hours) {
    return el("div", { class: "minibars", "aria-hidden": "true" }, hours.map(function (h) {
      return el("span", { style: { "--h": Math.max(6, U.isNum(h.pop) ? h.pop : 0) + "%" }, class: U.isNum(h.pop) && h.pop >= 50 ? "is-high" : "" });
    }));
  }

  function tiles(state) {
    var f = state.forecast, c = f.current, today = f.days[0];
    var hourNow = f.hourly[f.nowIndex] || {};
    var next24 = f.hourly.slice(f.nowIndex, f.nowIndex + 24);
    var out = [];

    var w = c.wind || 0;
    var windWord = w < 6 ? "Calm" : w < 20 ? "Light breeze" : w < 39 ? "Moderate breeze" : w < 62 ? "Strong wind" : w < 89 ? "Gale" : "Storm force";
    out.push(tile({
      icon: "fa-wind", label: "Wind", color: "var(--c-wind)",
      value: String(U.windValue(w)), unit: U.windUnit(), tag: windWord, side: compassDial(c.windDir),
      note: "From the " + U.compassLong(c.windDir) + " (" + U.compass(c.windDir) + ") · gusts " + U.fmtWind(c.gust)
    }));

    var nextRain = next24.find(function (h) { return U.isNum(h.pop) && h.pop >= 50; });
    out.push(tile({
      icon: "fa-cloud-rain", label: "Rain today", color: "var(--c-rain)",
      value: U.fmtPrecip(today.precipSum).split(" ")[0], unit: U.fmtPrecip(today.precipSum).split(" ")[1],
      tag: U.fmtPercent(today.pop) + " chance",
      viz: miniBars(next24.slice(0, 12)),
      note: nextRain ? "Next 12 hours shown · rain likely " + (nextRain === next24[0] ? "within the hour" : "around " + U.fmtHour(nextRain.time))
        : "Next 12 hours shown · no rain expected"
    }));

    var uvNow = U.isNum(hourNow.uv) ? hourNow.uv : 0;
    var uv = WW.insights.uvLevel(uvNow);
    out.push(tile({
      icon: "fa-sun", label: "UV index", color: "var(--c-uv)",
      value: String(Math.round(uvNow)), tag: uv.label,
      viz: levelScale(WW.insights.UV_LEVELS, [3, 3, 2, 3, 2], { index: uv.index, fraction: uvNow / 13 },
        "UV index " + Math.round(uvNow) + ", " + uv.label, ["0", "11+"]),
      note: uv.advice + (U.isNum(today.uvMax) ? " Peak today: " + Math.round(today.uvMax) + "." : "")
    }));

    var dew = hourNow.dew;
    var dewWord = !U.isNum(dew) ? "" : dew < 10 ? "the air feels dry" : dew < 16 ? "comfortable" : dew < 21 ? "a little humid" : "muggy";
    out.push(tile({
      icon: "fa-droplet", label: "Humidity", color: "var(--c-rain)",
      value: String(Math.round(c.humidity)), unit: "%",
      viz: meter(c.humidity, "var(--c-rain)", "Humidity " + Math.round(c.humidity) + " percent"),
      note: U.isNum(dew) ? "Dew point " + U.fmtTemp(dew) + ", " + dewWord : "Relative humidity right now"
    }));

    var isDay = c.isDay, now = c.time;
    var progress = (now - today.sunrise) / (today.sunset - today.sunrise);
    var nextEvent, nextLabel;
    if (now < today.sunrise) { nextEvent = today.sunrise; nextLabel = "sunrise"; }
    else if (now < today.sunset) { nextEvent = today.sunset; nextLabel = "sunset"; }
    else { nextEvent = f.days[1] ? f.days[1].sunrise : today.sunrise + DAY; nextLabel = "sunrise"; }
    out.push(tile({
      icon: nextLabel === "sunset" ? "fa-moon" : "fa-sun", label: "Sun", color: "var(--c-uv)",
      value: U.fmtTime(nextEvent), unit: nextLabel,
      viz: el("div", null, sunPath(progress, isDay),
        el("div", { class: "suntimes" },
          el("span", null, icon("fa-arrow-up"), U.fmtTime(today.sunrise)),
          el("span", null, U.fmtTime(today.sunset), icon("fa-arrow-down")))),
      note: U.fmtDuration(today.sunset - today.sunrise) + " of daylight · " + nextLabel + " in " + U.fmtDuration(Math.max(0, nextEvent - now))
    }));

    var before = f.hourly[f.nowIndex - 3];
    var change = before && U.isNum(before.pressure) && U.isNum(c.pressure) ? c.pressure - before.pressure : 0;
    var trend = change > 1 ? ["fa-arrow-trend-up", "Rising", "Rising pressure usually means the weather is settling."]
      : change < -1 ? ["fa-arrow-trend-down", "Falling", "Falling pressure can mean rain or wind is on the way."]
        : ["fa-arrows-left-right", "Steady", "Steady pressure, no big change expected soon."];
    out.push(tile({
      icon: "fa-gauge", label: "Pressure",
      value: U.isNum(c.pressure) ? String(Math.round(c.pressure)) : "–", unit: "hPa",
      tag: [icon(trend[0]), " " + trend[1]],
      note: trend[2]
    }));

    var vis = hourNow.visibility;
    var visWord = !U.isNum(vis) ? "" : vis >= 10000 ? "Clear view" : vis >= 4000 ? "Good" : vis >= 1000 ? "Hazy" : "Poor";
    var visText = U.fmtDistance(vis).split(" ");
    out.push(tile({
      icon: "fa-eye", label: "Visibility",
      value: visText[0], unit: visText[1], tag: visWord,
      note: !U.isNum(vis) ? "Not reported for this location." : vis >= 10000 ? "You can see distant hills and landmarks."
        : vis >= 4000 ? "Fine for driving and walking." : vis >= 1000 ? "Haze or mist, take care on the roads." : "Fog, drive slowly with lights on."
    }));

    var cloud = U.isNum(c.cloud) ? c.cloud : 0;
    var cloudWord = cloud < 12 ? "Clear skies" : cloud < 40 ? "Mostly clear" : cloud < 70 ? "Partly cloudy" : cloud < 90 ? "Mostly cloudy" : "Overcast";
    out.push(tile({
      icon: "fa-cloud", label: "Cloud cover",
      value: String(Math.round(cloud)), unit: "%",
      viz: meter(cloud, "var(--ink-2)", "Cloud cover " + Math.round(cloud) + " percent"),
      note: cloudWord + " right now"
    }));

    U.fill(byId("tiles"), out);
    byId("conditions-sub").textContent = "Measured at " + U.fmtTime(c.time) + " local time";
  }

  var DAY_SORTS = {
    date: { label: "date", compare: function (a, b) { return a.time - b.time; } },
    warm: { label: "warmest first", compare: function (a, b) { return U.tempValue(b.max) - U.tempValue(a.max) || a.time - b.time; } },
    cool: { label: "coolest first", compare: function (a, b) { return U.tempValue(a.min) - U.tempValue(b.min) || a.time - b.time; } },
    wet: { label: "wettest first", compare: function (a, b) { return (b.precipSum || 0) - (a.precipSum || 0) || (b.pop || 0) - (a.pop || 0) || a.time - b.time; } },
    wind: { label: "windiest first", compare: function (a, b) { return Math.round(b.windMax || 0) - Math.round(a.windMax || 0) || a.time - b.time; } },
    uv: { label: "highest UV first", compare: function (a, b) { return (b.uvMax || 0) - (a.uvMax || 0) || a.time - b.time; } }
  };

  var DAY_FILTERS = {
    all: { empty: "", test: function () { return true; } },
    dry: { empty: "No dry days in this forecast.", test: function (d) { return (d.pop || 0) < 30 && (d.precipSum || 0) < 1; } },
    wet: { empty: "No rainy days in this forecast.", test: function (d) { return (d.pop || 0) >= 50 || (d.precipSum || 0) >= 1; } },
    weekend: { empty: "No weekend days in this forecast.", test: function (d) { return U.isWeekend(d.time); } }
  };

  function daily(state) {
    var f = state.forecast, days = f.days;
    var sort = DAY_SORTS[state.dailySort] || DAY_SORTS.date;
    var filter = DAY_FILTERS[state.dailyFilter] || DAY_FILTERS.all;

    byId("daily-title").textContent = days.length + "-day forecast";
    byId("daily-sort").value = state.dailySort;
    U.$$("#daily-filter .chip").forEach(function (chip) {
      var key = chip.dataset.filter;
      chip.setAttribute("aria-pressed", key === state.dailyFilter ? "true" : "false");
      var count = chip.querySelector(".chip__count") || chip.appendChild(el("span", { class: "chip__count" }));
      count.textContent = String(days.filter(DAY_FILTERS[key].test).length);
    });

    var lo = Math.min.apply(null, days.map(function (d) { return d.min; }));
    var hi = Math.max.apply(null, days.map(function (d) { return d.max; }));
    var span = Math.max(1, hi - lo);

    var shown = days.filter(filter.test).sort(sort.compare);
    var list = byId("day-list");

    if (!shown.length) {
      U.fill(list, el("li", { class: "state" },
        icon("fa-filter-circle-xmark"),
        el("strong", { text: filter.empty }),
        el("p", { text: "Try a different filter to see more days." }),
        el("button", { class: "btn btn--small", type: "button", on: { click: function () { WW.app.setDailyFilter("all"); } } }, "Show all days")));
      return;
    }

    U.fill(list, shown.map(function (d, rank) {
      var info = WW.codes.describe(d.code, true);
      var isToday = d.date === days[0].date;
      var name = isToday ? "Today" : d.date === (days[1] && days[1].date) ? "Tomorrow" : U.weekday(d.time, true);
      var selected = state.selectedDay === d.date;
      var low = (d.pop || 0) < 20;

      return el("li", null, el("button", {
        class: "day", type: "button", "aria-pressed": selected ? "true" : "false",
        "aria-label": name + ", " + U.fmtDate(d.time) + ": " + info.label + ", high " + U.fmtTemp(d.max) + ", low " + U.fmtTemp(d.min) +
          ", " + U.fmtPercent(d.pop) + " chance of rain, wind up to " + U.fmtWind(d.windMax) + ". " + (selected ? "Showing its hours." : "Show its hours."),
        on: { click: function () { WW.app.selectDay(selected ? null : d.date); } }
      },
        el("span", { class: "day__name" },
          state.dailySort !== "date" ? el("span", { class: "day__rank", text: String(rank + 1) }) : null,
          el("span", { class: "day__full", text: name }),
          el("span", { class: "day__short", text: isToday ? "Today" : U.weekday(d.time) }),
          el("span", { class: "day__date", text: U.fmtDate(d.time) })),
        el("span", { class: "day__icon" }, icon(info.icon)),
        el("span", { class: "day__label", text: info.label }),
        el("span", { class: "day__pop" + (low ? " is-low" : "") }, icon("fa-droplet"), U.fmtPercent(d.pop)),
        el("span", { class: "day__min", text: U.fmtTemp(d.min) }),
        el("span", { class: "day__range" }, el("span", {
          style: { "--from": ((d.min - lo) / span * 100).toFixed(1) + "%", "--to": ((hi - d.max) / span * 100).toFixed(1) + "%" }
        })),
        el("span", { class: "day__max", text: U.fmtTemp(d.max) }),
        el("span", { class: "day__wind" }, icon("fa-wind"), U.fmtWind(d.windMax))));
    }));

    list.appendChild(el("li", { class: "day-summary", role: "status" },
      "Showing " + shown.length + " of " + days.length + " days" + (state.dailySort !== "date" ? ", " + sort.label : "") + "."));
  }

  var POLLUTANTS = [
    { key: "pm25", name: "PM2.5", guide: 15 },
    { key: "pm10", name: "PM10", guide: 45 },
    { key: "o3", name: "Ozone", guide: 100 },
    { key: "no2", name: "NO₂", guide: 25 },
    { key: "so2", name: "SO₂", guide: 40 },
    { key: "co", name: "CO", guide: 4000 }
  ];

  function air(state) {
    var body = byId("air-body"), a = state.air;

    if (!a) {
      if (state.airError) {
        var info = WW.api.explain(state.airError);
        U.fill(body, el("div", { class: "state" },
          icon(info.icon),
          el("strong", { text: "Air quality is unavailable" }),
          el("p", { text: "The rest of the forecast is unaffected. " + info.text }),
          el("button", { class: "btn btn--small", type: "button", on: { click: function () { WW.app.retryAir(); } } },
            icon("fa-rotate-right"), " Try again")));
      } else {
        U.fill(body, el("div", { class: "skeleton", style: { height: "220px" } }));
      }
      return;
    }

    var level = WW.insights.aqiLevel(a.aqi);
    var bounds = [0, 50, 100, 150, 200, 300, 500];
    var within = U.clamp((a.aqi - bounds[level.index]) / (bounds[level.index + 1] - bounds[level.index]), 0, 1);

    var peak = a.trend.reduce(function (best, point) { return !best || point.aqi > best.aqi ? point : best; }, null);
    var outlook = peak ? "Next 24 hours: peaks at " + Math.round(peak.aqi) + " (" + WW.insights.aqiLevel(peak.aqi).label.toLowerCase() + ") around " + U.fmtHour(peak.time) + "." : "";

    U.fill(body,
      el("div", { class: "aqi" },
        el("p", { class: "aqi__value", text: String(Math.round(a.aqi)) }),
        el("div", null,
          el("p", { class: "aqi__label" }, el("span", { class: "aqi__dot", style: { "--dot": level.color } }), level.label),
          el("p", { class: "aqi__advice", text: level.advice }))),
      levelScale(WW.insights.AQI_LEVELS, [1, 1, 1, 1, 1, 1], { index: level.index, fraction: (level.index + within) / 6 },
        "Air quality index " + Math.round(a.aqi) + ", " + level.label, ["Good", "Hazardous"]),
      outlook ? el("p", { class: "air__foot", text: outlook }) : null,
      el("ul", { class: "pollutants" }, POLLUTANTS.filter(function (p) { return U.isNum(a[p.key]); }).map(function (p) {
        var value = a[p.key], ratio = value / p.guide;
        var color = ratio <= 1 ? "var(--s-good)" : ratio <= 2 ? "var(--s-moderate)" : "var(--s-high)";
        var word = ratio <= 1 ? "within" : "above";
        return el("li", { class: "pollutant" },
          el("span", { class: "pollutant__name", text: p.name }),
          el("div", { class: "meter meter--guide", role: "img", "aria-label": p.name + " is " + word + " the WHO guideline" },
            el("span", { class: "meter__fill", style: { "--value": U.clamp(ratio * 50, 2, 100) + "%", "--meter": color } })),
          el("span", { class: "pollutant__value" }, String(value >= 100 ? Math.round(value) : Math.round(value * 10) / 10), el("small", { text: " µg/m³" })));
      })),
      el("p", { class: "air__foot", text: "The mark on each bar is the WHO guideline level for that pollutant." }));
  }

  function footer(state) {
    var f = state.forecast;
    byId("footer-meta").textContent = "Forecast for " + f.place.lat.toFixed(2) + "°, " + f.place.lon.toFixed(2) + "° · time zone " +
      (f.timezone || "local") + (f.tzAbbr ? " (" + f.tzAbbr + ")" : "") + " · fetched " + U.fmtAgo(Date.now() - f.fetchedAt) + ".";
  }

  function all(state) {
    if (!state.forecast) return;
    hero(state);
    brief(state);
    hourly(state);
    tiles(state);
    daily(state);
    air(state);
    footer(state);
    WW.planner.render(state);
    WW.scene.update(state.forecast);
  }

  return { all: all, hero: hero, clock: clock, saveButton: saveButton, hourly: hourly, daily: daily, air: air, footer: footer };
})();
