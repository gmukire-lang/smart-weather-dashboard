WW.insights = (function () {
  "use strict";

  var U = WW.utils;

  function n(value, fallback) { return U.isNum(value) ? value : (fallback || 0); }
  function avg(list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : 0; }
  function maxOf(list, pick) { return list.reduce(function (m, x) { return Math.max(m, n(pick(x))); }, 0); }

  var UV_LEVELS = [
    { upTo: 3, label: "Low", color: "var(--s-good)", advice: "No protection needed." },
    { upTo: 6, label: "Moderate", color: "var(--s-moderate)", advice: "Wear sunscreen if you’re out for long." },
    { upTo: 8, label: "High", color: "var(--s-elevated)", advice: "Sunscreen and a hat recommended." },
    { upTo: 11, label: "Very high", color: "var(--s-high)", advice: "Seek shade around midday." },
    { upTo: Infinity, label: "Extreme", color: "var(--s-severe)", advice: "Avoid the midday sun." }
  ];

  var AQI_LEVELS = [
    { upTo: 50, label: "Good", color: "var(--s-good)", advice: "Air is clean, a great time to be outside." },
    { upTo: 100, label: "Moderate", color: "var(--s-moderate)", advice: "Fine for most people. Unusually sensitive people may notice it." },
    { upTo: 150, label: "Unhealthy for sensitive groups", color: "var(--s-elevated)", advice: "Children, older adults and people with asthma should take it easy outdoors." },
    { upTo: 200, label: "Unhealthy", color: "var(--s-high)", advice: "Everyone should cut back on hard outdoor exercise." },
    { upTo: 300, label: "Very unhealthy", color: "var(--s-severe)", advice: "Avoid outdoor exertion; keep windows closed." },
    { upTo: Infinity, label: "Hazardous", color: "var(--s-extreme)", advice: "Stay indoors if you can." }
  ];

  function levelOf(levels, value) {
    var v = n(value);
    for (var i = 0; i < levels.length; i++) {
      var inside = levels === AQI_LEVELS ? v <= levels[i].upTo : v < levels[i].upTo;
      if (inside) return Object.assign({ index: i }, levels[i]);
    }
    return Object.assign({ index: levels.length - 1 }, levels[levels.length - 1]);
  }

  function uvLevel(value) { return levelOf(UV_LEVELS, value); }
  function aqiLevel(value) { return levelOf(AQI_LEVELS, value); }

  function rating(score) {
    if (score >= 75) return { label: "Great", color: "var(--s-good)" };
    if (score >= 55) return { label: "Good", color: "var(--s-good)" };
    if (score >= 35) return { label: "Fair", color: "var(--s-moderate)" };
    return { label: "Poor", color: "var(--s-high)" };
  }

  function comfort(hour, ideal, weights) {
    var feels = n(hour.feels, hour.temp);
    var score = 100;
    if (feels < ideal[0]) score -= (ideal[0] - feels) * weights.cold;
    if (feels > ideal[1]) score -= (feels - ideal[1]) * weights.hot;
    score -= n(hour.pop) * weights.pop;
    if (n(hour.precip) > 0.2) score -= weights.wet;
    if (n(hour.wind) > weights.windFrom) score -= (n(hour.wind) - weights.windFrom) * weights.wind;
    if (n(hour.uv) > 7) score -= (n(hour.uv) - 7) * 6;
    return U.clamp(score, 0, 100);
  }

  var OUTDOORS = { cold: 4, hot: 6, pop: 0.6, wet: 25, windFrom: 20, wind: 1.5 };
  var RUNNING = { cold: 3, hot: 4, pop: 0.5, wet: 20, windFrom: 25, wind: 1.5 };
  var CYCLING = { cold: 4, hot: 4, pop: 0.8, wet: 35, windFrom: 15, wind: 2.5 };

  function bestHours(scores, take) {
    return avg(scores.slice().sort(function (a, b) { return b - a; }).slice(0, take));
  }

  function rainInsight(f, next12) {
    var now = WW.codes.describe(f.current.code);
    var wetNow = WW.codes.isWet(f.current.code) || f.current.precip > 0.1;
    var maxPop = Math.round(maxOf(next12, function (h) { return h.pop; }));

    if (wetNow) {
      var word = now.group === "snow" ? "Snowing" : now.group === "storm" ? "Thunderstorms" : "Raining";
      var stop = next12.findIndex(function (h, i) { return i > 0 && n(h.pop) < 30 && n(h.precip) < 0.1; });
      return {
        icon: "fa-umbrella", tone: "alert", title: word + " now",
        detail: stop > 0
          ? "Should ease off around " + U.fmtHour(next12[stop].time) + ". Keep an umbrella handy until then."
          : "Likely to continue through the next 12 hours, dress for it."
      };
    }

    var hit = next12.find(function (h) { return n(h.pop) >= 50 || n(h.precip) >= 0.5; });
    if (hit) {
      var kind = WW.codes.describe(hit.code).group === "snow" ? "Snow" : "Rain";
      return {
        icon: "fa-umbrella", tone: "alert",
        title: kind + " likely " + (hit === next12[0] ? "within the hour" : "around " + U.fmtHour(hit.time)),
        detail: "Up to " + maxPop + "% chance in the next 12 hours, take an umbrella."
      };
    }
    if (maxPop >= 25) {
      return {
        icon: "fa-cloud-sun-rain", tone: "info", title: "A shower is possible",
        detail: "Up to " + maxPop + "% chance in the next 12 hours. An umbrella wouldn’t hurt."
      };
    }
    return {
      icon: "fa-umbrella", tone: "good", title: "No rain expected",
      detail: "Dry for the next 12 hours, leave the umbrella at home."
    };
  }

  function compareInsight(f) {
    var today = f.days[0];
    var range = "Today: high " + U.fmtTemp(today.max) + ", low " + U.fmtTemp(today.min) + ".";
    if (!f.yesterday) return { icon: "fa-temperature-half", tone: "info", title: "High of " + U.fmtTemp(today.max) + " today", detail: range };

    var diff = today.max - f.yesterday.max;
    var shown = Math.abs(U.tempDelta(diff));
    if (Math.abs(diff) < 1.5 || shown === 0) {
      return { icon: "fa-temperature-half", tone: "info", title: "About as warm as yesterday", detail: range };
    }
    return {
      icon: diff > 0 ? "fa-temperature-arrow-up" : "fa-temperature-arrow-down", tone: "info",
      title: shown + "° " + (diff > 0 ? "warmer" : "cooler") + " than yesterday", detail: range
    };
  }

  function uvInsight(f) {
    var endOfDay = f.days[0].time + 86400000;
    var rest = f.hourly.slice(f.nowIndex).filter(function (h) { return h.time < endOfDay; });
    var peak = maxOf(rest, function (h) { return h.uv; });
    var strong = rest.filter(function (h) { return n(h.uv) >= (peak >= 6 ? 6 : 3); });
    var level = uvLevel(peak);

    if (peak < 3 || !strong.length) {
      var tomorrow = f.days[1] && U.isNum(f.days[1].uvMax)
        ? " Tomorrow peaks at " + Math.round(f.days[1].uvMax) + " (" + uvLevel(f.days[1].uvMax).label.toLowerCase() + ")." : "";
      return { icon: "fa-sun", tone: "good", title: "Low UV for the rest of today", detail: "No sun protection needed." + tomorrow };
    }
    var from = U.fmtHour(strong[0].time), to = U.fmtHour(strong[strong.length - 1].time + 3600000);
    return {
      icon: "fa-sun", tone: peak >= 6 ? "alert" : "info",
      title: level.label + " UV, peaking at " + Math.round(peak),
      detail: (peak >= 6 ? "Use sunscreen between " : "Sunscreen is worth it between ") + from + " and " + to + "."
    };
  }

  function outdoorInsight(f) {
    var hours = f.hourly.slice(f.nowIndex, f.nowIndex + 24);
    var best = null;
    for (var i = 0; i < hours.length - 1; i++) {
      if (!hours[i].isDay || !hours[i + 1].isDay) continue;
      var score = (comfort(hours[i], [16, 26], OUTDOORS) + comfort(hours[i + 1], [16, 26], OUTDOORS)) / 2;
      if (!best || score > best.score + 0.5) best = { score: score, a: hours[i], b: hours[i + 1] };
    }
    if (!best || best.score < 50) {
      return {
        icon: "fa-house", tone: "info", title: "No ideal outdoor window",
        detail: "Daylight hours stay rough for the next day, a good one for indoor plans."
      };
    }
    var tomorrow = best.a.time >= f.days[0].time + 86400000;
    return {
      icon: "fa-person-walking", tone: "good",
      title: "Best time outside: " + U.fmtHour(best.a.time) + "–" + U.fmtHour(best.b.time + 3600000) + (tomorrow ? " tomorrow" : ""),
      detail: "Feels like " + U.fmtTemp(avg([n(best.a.feels, best.a.temp), n(best.b.feels, best.b.temp)])) +
        ", " + Math.round(Math.max(n(best.a.pop), n(best.b.pop))) + "% chance of rain, wind " + U.fmtWind(Math.max(n(best.a.wind), n(best.b.wind))) + "."
    };
  }

  function wearInsight(f) {
    var next6 = f.hourly.slice(f.nowIndex, f.nowIndex + 6);
    var feels = avg(next6.map(function (h) { return n(h.feels, h.temp); }));
    var wet = next6.some(function (h) { return n(h.pop) >= 50 || n(h.precip) >= 0.3; });
    var windy = maxOf(next6, function (h) { return h.wind; }) >= 30;

    var title, detail;
    if (feels < 0) { title = "Bundle up: heavy coat, hat and gloves"; detail = "It feels below freezing."; }
    else if (feels < 8) { title = "Wear a warm coat"; detail = "It feels cold over the next few hours."; }
    else if (feels < 15) { title = "A jacket or sweater will do"; detail = "Cool, but comfortable with a layer."; }
    else if (feels < 22) { title = "Light layers"; detail = "Mild, a long sleeve or light jacket is plenty."; }
    else if (feels < 28) { title = "T-shirt weather"; detail = "Warm and comfortable."; }
    else { title = "Light, breathable clothing"; detail = "It’s hot, drink water and take breaks in the shade."; }

    if (wet) detail += " Add something waterproof.";
    else if (windy) detail += " A windproof layer will help.";

    return { icon: "fa-shirt", tone: "info", title: title, detail: "Feels like " + U.fmtTemp(feels) + ". " + detail };
  }

  function alertInsights(f, air, next12) {
    var out = [];
    var gust = Math.max(n(f.current.gust), maxOf(next12, function (h) { return h.gust; }));
    if (gust >= 50) {
      out.push({
        icon: "fa-wind", tone: "alert", title: "Strong gusts up to " + U.fmtWind(gust),
        detail: "Secure loose items outside and take care on exposed roads."
      });
    }
    if (air && n(air.aqi) > 100) {
      var level = aqiLevel(air.aqi);
      out.push({ icon: "fa-mask-face", tone: "alert", title: "Air quality: " + level.label.toLowerCase(), detail: level.advice });
    }
    return out;
  }

  function activities(f, air) {
    var next12 = f.hourly.slice(f.nowIndex, f.nowIndex + 12);
    var next24 = f.hourly.slice(f.nowIndex, f.nowIndex + 24);
    var airPenalty = air && n(air.aqi) > 100 ? (air.aqi - 100) * 0.4 : 0;

    var running = bestHours(next12.map(function (h) { return comfort(h, [8, 18], RUNNING); }), 3) - airPenalty;
    var cycling = bestHours(next12.map(function (h) { return comfort(h, [12, 24], CYCLING); }), 3) - airPenalty;

    var daylight = next12.filter(function (h) { return h.isDay; });
    var laundry = daylight.length < 2 ? 10 : bestHours(daylight.map(function (h) {
      var score = 100;
      if (n(h.humidity) > 50) score -= (h.humidity - 50) * 1.2;
      score -= n(h.pop);
      if (n(h.precip) > 0) score -= 60;
      if (n(h.temp) < 10) score -= (10 - h.temp) * 3;
      if (n(h.wind) >= 5 && n(h.wind) <= 25) score += 10;
      return U.clamp(score, 0, 100);
    }), 3);

    var night = next24.filter(function (h) { return !h.isDay; });
    var stars = !night.length ? 0 : U.clamp(100 - avg(night.map(function (h) { return n(h.cloud); })) -
      avg(night.map(function (h) { return n(h.pop); })) * 0.5, 0, 100);

    return [
      { icon: "fa-person-running", label: "Running", score: running },
      { icon: "fa-person-biking", label: "Cycling", score: cycling },
      { icon: "fa-shirt", label: "Drying laundry", score: laundry },
      { icon: "fa-star", label: "Stargazing", score: stars }
    ].map(function (a) {
      a.score = Math.round(U.clamp(a.score, 0, 100));
      a.rating = rating(a.score);
      return a;
    });
  }

  function build(f, air) {
    var next12 = f.hourly.slice(f.nowIndex, f.nowIndex + 12);
    var rain = rainInsight(f, next12);
    var compare = compareInsight(f);

    var items = alertInsights(f, air, next12)
      .concat([rain, outdoorInsight(f), uvInsight(f), wearInsight(f), compare])
      .slice(0, 5);

    return {
      headline: rain.title + ". " + compare.title + ".",
      items: items,
      activities: activities(f, air)
    };
  }

  return { build: build, uvLevel: uvLevel, aqiLevel: aqiLevel, AQI_LEVELS: AQI_LEVELS, UV_LEVELS: UV_LEVELS };
})();
