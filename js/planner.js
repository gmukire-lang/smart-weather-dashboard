/* ==========================================================================
   Weatherwise: activity planner
   The purpose of the app in one feature: "WHEN should I do it?"
   Pick an activity and how long it takes; the planner scores every possible
   time slot in the next 7 days against what that activity needs (temperature,
   rain, wind, sun, humidity, daylight or darkness) and shows the best slot of
   each day, with the reasons. Results can be sorted and filtered.
   ========================================================================== */

WW.planner = (function () {
  "use strict";

  var U = WW.utils, el = U.el, icon = U.icon;
  var DAY = 86400000, HOUR = 3600000;
  var view = { activity: "run", hours: 2, sort: "best", goodOnly: false };
  var bound = false, lastState = null;

  function n(v, fallback) { return U.isNum(v) ? v : (fallback || 0); }

  /* ── What each activity needs ───────────────────────────────────────────
     score(hour) returns 0–100 for one hour. "when" limits which hours count:
     "day" = daylight only, "night" = darkness only, "waking" = 06:00–22:00. */

  function comfortScore(ideal, w) {
    return function (h) {
      var feels = n(h.feels, h.temp), s = 100;
      if (feels < ideal[0]) s -= (ideal[0] - feels) * w.cold;
      if (feels > ideal[1]) s -= (feels - ideal[1]) * w.hot;
      s -= n(h.pop) * w.pop;
      if (n(h.precip) > 0.2) s -= w.wet;
      if (n(h.wind) > w.windFrom) s -= (n(h.wind) - w.windFrom) * w.wind;
      if (n(h.uv) > w.uvFrom) s -= (n(h.uv) - w.uvFrom) * w.uv;
      return U.clamp(s, 0, 100);
    };
  }

  var ACTIVITIES = {
    run: {
      label: "Running", icon: "fa-person-running", when: "waking",
      needs: "Cool, dry air and light wind",
      score: comfortScore([8, 18], { cold: 3, hot: 4, pop: 0.5, wet: 20, windFrom: 25, wind: 1.5, uvFrom: 7, uv: 6 })
    },
    cycle: {
      label: "Cycling", icon: "fa-person-biking", when: "day",
      needs: "Dry roads, daylight and little wind",
      score: comfortScore([12, 24], { cold: 4, hot: 4, pop: 0.8, wet: 35, windFrom: 15, wind: 2.5, uvFrom: 8, uv: 5 })
    },
    event: {
      label: "Outdoor event", icon: "fa-champagne-glasses", when: "waking",
      needs: "No rain above all, mild and calm",
      score: comfortScore([17, 27], { cold: 4, hot: 5, pop: 1.0, wet: 50, windFrom: 20, wind: 2, uvFrom: 8, uv: 4 })
    },
    farm: {
      label: "Farm & garden work", icon: "fa-seedling", when: "day",
      needs: "Daylight, no heavy heat or strong sun, dry enough to work",
      score: comfortScore([12, 25], { cold: 4, hot: 6, pop: 0.5, wet: 30, windFrom: 30, wind: 1.5, uvFrom: 6, uv: 8 })
    },
    laundry: {
      label: "Drying laundry", icon: "fa-shirt", when: "day",
      needs: "Dry air, a breeze and no rain",
      score: function (h) {
        var s = 100;
        if (n(h.humidity) > 50) s -= (h.humidity - 50) * 1.2;
        s -= n(h.pop);
        if (n(h.precip) > 0) s -= 60;
        if (n(h.temp) < 12) s -= (12 - h.temp) * 5;
        if (n(h.wind) >= 5 && n(h.wind) <= 25) s += 10;
        return U.clamp(s, 0, 100);
      }
    },
    stars: {
      label: "Stargazing", icon: "fa-star", when: "night",
      needs: "A dark, cloudless sky",
      score: function (h) { return U.clamp(100 - n(h.cloud) - n(h.pop) * 0.5 - (n(h.precip) > 0 ? 40 : 0), 0, 100); }
    }
  };

  function rating(score) {
    if (score >= 75) return { label: "Great", color: "var(--s-good)" };
    if (score >= 55) return { label: "Good", color: "var(--s-good)" };
    if (score >= 35) return { label: "Fair", color: "var(--s-moderate)" };
    return { label: "Poor", color: "var(--s-high)" };
  }

  /* ── Finding the best slot of each day ──────────────────────────────── */

  function plan(f) {
    var activity = ACTIVITIES[view.activity], len = view.hours;
    var hours = f.hourly.slice(f.nowIndex, f.nowIndex + 7 * 24);
    var bestByDay = {};

    for (var i = 0; i + len <= hours.length; i++) {
      var slot = hours.slice(i, i + len), ok = true, sum = 0, worst = 100;
      for (var j = 0; j < slot.length; j++) {
        var h = slot[j];
        var clock = new Date(h.time).getUTCHours();
        if ((activity.when === "day" && !h.isDay) || (activity.when === "night" && h.isDay) ||
            (activity.when === "waking" && (clock < 6 || clock >= 22))) { ok = false; break; }
        if (j > 0 && h.time - slot[j - 1].time !== HOUR) { ok = false; break; }
        var s = activity.score(h);
        sum += s; worst = Math.min(worst, s);
      }
      if (!ok) continue;

      // One bad hour spoils a slot, so the worst hour counts as well as the average.
      var score = Math.round(sum / len * 0.7 + worst * 0.3);
      var dayKey = new Date(slot[0].time).toISOString().slice(0, 10);
      if (!bestByDay[dayKey] || score > bestByDay[dayKey].score) {
        bestByDay[dayKey] = {
          day: dayKey, start: slot[0].time, end: slot[len - 1].time + HOUR, score: score, rating: rating(score),
          feels: slot.reduce(function (a, x) { return a + n(x.feels, x.temp); }, 0) / len,
          pop: Math.max.apply(null, slot.map(function (x) { return n(x.pop); })),
          wind: Math.max.apply(null, slot.map(function (x) { return n(x.wind); })),
          cloud: slot.reduce(function (a, x) { return a + n(x.cloud); }, 0) / len,
          humidity: slot.reduce(function (a, x) { return a + n(x.humidity); }, 0) / len,
          code: slot[Math.floor(len / 2)].code, isDay: slot[Math.floor(len / 2)].isDay
        };
      }
    }
    return Object.keys(bestByDay).map(function (k) { return bestByDay[k]; });
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  function dayName(f, time) {
    var today = f.days[0].time;
    var diff = Math.round((U.toMs(new Date(time).toISOString().slice(0, 10)) - today) / DAY);
    return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : U.weekday(time, true);
  }

  function facts(slot) {
    var out = ["Feels " + U.fmtTemp(slot.feels), Math.round(slot.pop) + "% rain", "wind " + U.fmtWind(slot.wind)];
    if (view.activity === "stars") out = [Math.round(slot.cloud) + "% cloud", Math.round(slot.pop) + "% rain"];
    if (view.activity === "laundry") out.splice(1, 0, Math.round(slot.humidity) + "% humidity");
    return out.join(" · ");
  }

  function render(state) {
    if (state) lastState = state;
    var host = document.getElementById("planner-body");
    if (!host || !lastState || !lastState.forecast) return;
    bind();

    var f = lastState.forecast, activity = ACTIVITIES[view.activity];
    var slots = plan(f);
    var top = slots.slice().sort(function (a, b) { return b.score - a.score || a.start - b.start; })[0];

    U.$$("#planner-activity .chip").forEach(function (c) { c.setAttribute("aria-pressed", c.dataset.activity === view.activity ? "true" : "false"); });
    U.$$("#planner-length button").forEach(function (b) { b.setAttribute("aria-pressed", Number(b.dataset.hours) === view.hours ? "true" : "false"); });
    document.getElementById("planner-sort").value = view.sort;
    document.getElementById("planner-good").setAttribute("aria-pressed", view.goodOnly ? "true" : "false");
    document.getElementById("planner-sub").textContent = activity.label + " needs: " + activity.needs.charAt(0).toLowerCase() + activity.needs.slice(1) + ".";

    var shown = slots.filter(function (s) { return !view.goodOnly || s.score >= 55; });
    shown.sort(view.sort === "soon" ? function (a, b) { return a.start - b.start; }
      : function (a, b) { return b.score - a.score || a.start - b.start; });

    if (!slots.length) {
      return U.fill(host, el("div", { class: "state" }, icon("fa-calendar-xmark"),
        el("strong", { text: "No suitable " + view.hours + "-hour slot this week" }),
        el("p", { text: "Try a shorter duration, " + activity.label.toLowerCase() + " needs " + (activity.when === "night" ? "darkness" : activity.when === "day" ? "daylight" : "daytime hours") + " for the whole slot." })));
    }
    if (!shown.length) {
      return U.fill(host, el("div", { class: "state" }, icon("fa-cloud-showers-heavy"),
        el("strong", { text: "No good slots for " + activity.label.toLowerCase() + " this week" }),
        el("p", { text: "The best available is only “" + top.rating.label.toLowerCase() + "”. Turn off the filter to see every day’s best option." }),
        el("button", { class: "btn btn--small", type: "button", on: { click: function () { view.goodOnly = false; render(); } } }, "Show all days")));
    }

    var verdict = top.score >= 55
      ? "Best time this week: " + dayName(f, top.start) + ", " + U.fmtHour(top.start) + "–" + U.fmtHour(top.end) + " (" + top.rating.label.toLowerCase() + ")."
      : "No really good slot this week, the least bad is " + dayName(f, top.start) + ", " + U.fmtHour(top.start) + "–" + U.fmtHour(top.end) + ".";

    U.fill(host,
      el("p", { class: "plan-verdict", role: "status" }, icon(top.score >= 55 ? "fa-circle-check" : "fa-triangle-exclamation"), el("span", { text: verdict })),
      el("ol", { class: "plan-list" }, shown.map(function (s) {
        var info = WW.codes.describe(s.code, s.isDay);
        var isTop = s === top;
        return el("li", { class: "plan" + (isTop ? " is-top" : "") },
          el("div", { class: "plan__when" },
            el("span", { class: "plan__day" }, dayName(f, s.start), isTop ? el("span", { class: "plan__badge", text: "Best" }) : null),
            el("span", { class: "plan__time", text: U.fmtDate(s.start) + " · " + U.fmtHour(s.start) + "–" + U.fmtHour(s.end) })),
          el("div", { class: "plan__sky" }, icon(info.icon), el("span", { text: info.label })),
          el("div", { class: "plan__facts", text: facts(s) }),
          el("div", { class: "plan__score" },
            el("span", { class: "plan__rating", text: s.rating.label + " · " + s.score }),
            el("div", { class: "meter", role: "img", "aria-label": s.rating.label + ", " + s.score + " out of 100" },
              el("span", { class: "meter__fill", style: { "--value": s.score + "%", "--meter": s.rating.color } }))));
      })),
      el("p", { class: "day-summary", role: "status" },
        "Showing the best " + view.hours + "-hour slot for " + shown.length + " of " + slots.length + " days, " +
        (view.sort === "soon" ? "soonest first" : "best first") + ". Scores are out of 100."));
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.getElementById("planner-activity").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (chip && ACTIVITIES[chip.dataset.activity]) { view.activity = chip.dataset.activity; render(); }
    });
    document.getElementById("planner-length").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) { view.hours = Number(b.dataset.hours); render(); }
    });
    document.getElementById("planner-sort").addEventListener("change", function (e) { view.sort = e.target.value; render(); });
    document.getElementById("planner-good").addEventListener("click", function () { view.goodOnly = !view.goodOnly; render(); });
  }

  return { render: render, ACTIVITIES: ACTIVITIES };
})();
