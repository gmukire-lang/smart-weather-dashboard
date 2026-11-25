/* ==========================================================================
   Weatherwise: scenery
   Draws the landscape behind the current weather and keeps it in step with
   the forecast: time of day, cloud cover, wind, rain, snow, fog and storms.
   Colours live in css/scene.css; this file only decides *which* mood to show
   and animates the rain / snow canvas.
   ========================================================================== */

WW.scene = (function () {
  "use strict";

  var U = WW.utils;
  var root, card, starsEl, cloudsEl, landEl, bankEl, canvas, ctx, flashEl, orbEl;
  var width = 0, height = 0, dpr = 1;
  var particles = [];
  var precip = { kind: "none", intensity: 0, wind: 0, color: "rgba(255,255,255,.8)" };
  var frame = null, lastTick = 0, flashTimer = null;
  var visible = true, motion = true, cloudKey = "";

  /* ── One-off construction ───────────────────────────────────────────── */

  // Hills are described once, in a 1200 × 320 box, as cubic Bézier segments.
  var HILLS = [
    { cls: "hill-1", start: [0, 150], segs: [[150, 70, 300, 60, 450, 120], [600, 180, 720, 60, 900, 75], [1040, 86, 1130, 140, 1200, 115]] },
    { cls: "hill-2", start: [0, 200], segs: [[180, 140, 330, 160, 500, 205], [680, 250, 800, 150, 980, 165], [1090, 174, 1160, 205, 1200, 195]] },
    { cls: "hill-3", start: [0, 262], segs: [[200, 215, 380, 240, 560, 265], [760, 292, 900, 225, 1200, 250]] }
  ];
  var TREES = [
    { hill: 1, at: [30, 34.5, 53, 82, 86.5], size: [22, 28, 20, 26, 20], far: true },
    { hill: 2, at: [6, 11, 16, 67, 72.5, 92], size: [32, 44, 28, 40, 30, 36], far: false }
  ];

  function hillPath(hill) {
    var d = "M" + hill.start.join(",");
    hill.segs.forEach(function (s) { d += " C" + s.join(","); });
    return d + " L1200,320 L0,320 Z";
  }

  /** Height of a hill's ridge (0–320) at a horizontal position (0–1200). */
  function ridgeAt(hill, x) {
    var p0 = hill.start, best = p0[1], bestDist = Infinity;
    hill.segs.forEach(function (s) {
      for (var t = 0; t <= 1; t += 0.02) {
        var m = 1 - t;
        var px = m * m * m * p0[0] + 3 * m * m * t * s[0] + 3 * m * t * t * s[2] + t * t * t * s[4];
        var py = m * m * m * p0[1] + 3 * m * m * t * s[1] + 3 * m * t * t * s[3] + t * t * t * s[5];
        if (Math.abs(px - x) < bestDist) { bestDist = Math.abs(px - x); best = py; }
      }
      p0 = [s[4], s[5]];
    });
    return best;
  }

  function buildLand() {
    var rand = U.seeded(7);
    HILLS.forEach(function (hill, index) {
      landEl.appendChild(U.svg("svg", { class: "hill", viewBox: "0 0 1200 320", preserveAspectRatio: "none" },
        U.svg("path", { class: hill.cls, d: hillPath(hill) })));

      TREES.filter(function (group) { return group.hill === index; }).forEach(function (group) {
        group.at.forEach(function (percent, i) {
          var y = ridgeAt(hill, percent * 12);
          var tree = U.svg("svg", {
            class: "tree" + (group.far ? " tree--far" : ""), viewBox: "0 0 20 30",
            style: {
              left: percent + "%", bottom: (100 - y / 3.2) + "%", "--size": group.size[i] + "px",
              "--sway": (5 + rand() * 4).toFixed(1) + "s", "--lean": (0.6 + rand() * 1.2).toFixed(2) + "deg"
            }
          }, U.svg("path", { d: "M10 0 17 12h-3.5L19 22h-7.5v8h-3v-8H1l5.5-10H3Z" }));
          landEl.appendChild(tree);
        });
      });
    });
  }

  function buildStars() {
    var rand = U.seeded(42);
    for (var i = 0; i < 46; i++) {
      starsEl.appendChild(U.el("span", {
        class: rand() > 0.8 ? "is-big" : "",
        style: {
          left: (rand() * 100).toFixed(2) + "%", top: (rand() * 100).toFixed(2) + "%",
          "animation-delay": (-rand() * 4).toFixed(2) + "s", "animation-duration": (3 + rand() * 4).toFixed(2) + "s"
        }
      }));
    }
  }

  function buildBank() {
    var rand = U.seeded(11);
    var svgEl = U.svg("svg", { viewBox: "0 0 1200 160", preserveAspectRatio: "none" },
      U.svg("rect", { x: 0, y: 0, width: 1200, height: 70 }));
    for (var x = -20; x < 1240; x += 70 + rand() * 50) {
      svgEl.appendChild(U.svg("ellipse", { cx: x, cy: 62 + rand() * 18, rx: 70 + rand() * 50, ry: 38 + rand() * 34 }));
    }
    bankEl.appendChild(svgEl);
  }

  function cloudShape() {
    return U.svg("svg", { viewBox: "0 0 200 84" },
      U.svg("rect", { x: 18, y: 46, width: 164, height: 36, rx: 18 }),
      U.svg("circle", { cx: 62, cy: 46, r: 26 }),
      U.svg("circle", { cx: 104, cy: 34, r: 34 }),
      U.svg("circle", { cx: 146, cy: 48, r: 24 }));
  }

  /* ── Clouds ─────────────────────────────────────────────────────────── */

  function setClouds(count, wind, lowOnly) {
    var speed = U.clamp(0.6 + (wind || 0) / 22, 0.6, 2.6);
    var key = count + "|" + Math.round(speed * 4) + "|" + lowOnly;
    if (key === cloudKey) return; // nothing changed: let the existing clouds keep drifting
    cloudKey = key;

    U.clear(cloudsEl);
    var rand = U.seeded(count * 13 + 5);
    for (var i = 0; i < count; i++) {
      var far = rand() > 0.55;
      var duration = (far ? 150 : 100) * (0.8 + rand() * 0.5) / speed;
      var cloud = U.el("div", {
        class: "cloud" + (far ? " cloud--far" : ""),
        style: {
          top: ((lowOnly ? 20 : 5) + rand() * 34).toFixed(1) + "%",
          width: "clamp(" + (far ? 70 : 110) + "px, " + (far ? 13 : 20 + rand() * 6).toFixed(1) + "cqw, " + (far ? 130 : 220) + "px)",
          "--dur": duration.toFixed(1) + "s",
          "--delay": (-rand() * duration).toFixed(1) + "s",
          "--rest": (rand() * 85).toFixed(1) + "cqw"
        }
      }, cloudShape());
      cloudsEl.appendChild(cloud);
    }
  }

  /* ── Rain / snow ────────────────────────────────────────────────────── */

  function resize() {
    var box = root.getBoundingClientRect();
    width = box.width; height = box.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (!isAnimating()) draw(0);
  }

  function spawn(anywhere) {
    var scale = height / 480;
    if (precip.kind === "rain") {
      var speed = (520 + Math.random() * 320) * scale;
      return {
        x: Math.random() * (width + 200) - 100,
        y: anywhere ? Math.random() * height : -30,
        len: 10 + Math.random() * 12,
        vy: speed,
        vx: speed * U.clamp(precip.wind / 70, 0.06, 0.55)
      };
    }
    return {
      x: Math.random() * (width + 100) - 50,
      y: anywhere ? Math.random() * height : -10,
      r: 1.2 + Math.random() * 2.4,
      vy: (26 + Math.random() * 44) * scale,
      vx: U.clamp(precip.wind, 0, 40) * 0.9,
      phase: Math.random() * 6.28,
      sway: 10 + Math.random() * 18
    };
  }

  function seed() {
    particles = [];
    if (precip.kind === "none" || !width) return;
    var density = precip.kind === "rain" ? [0, 0.00013, 0.0003, 0.00052] : [0, 0.00009, 0.00018, 0.0003];
    var count = Math.min(420, Math.round(width * height * density[precip.intensity || 1]));
    for (var i = 0; i < count; i++) particles.push(spawn(true));
  }

  function draw(dt) {
    ctx.clearRect(0, 0, width, height);
    if (precip.kind === "none") return;
    ctx.strokeStyle = ctx.fillStyle = precip.color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";

    if (precip.kind === "rain") ctx.beginPath();
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      if (p.y > height + 30 || p.x > width + 120) { particles[i] = p = spawn(false); }

      if (precip.kind === "rain") {
        var k = p.len / p.vy;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * k, p.y - p.len);
      } else {
        p.phase += dt * 1.4;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(p.phase) * p.sway, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
    }
    if (precip.kind === "rain") ctx.stroke();
  }

  function isAnimating() {
    return motion && visible && !document.hidden && precip.kind !== "none";
  }

  function tick(now) {
    frame = null;
    if (!isAnimating()) return;
    var dt = Math.min(0.05, (now - lastTick) / 1000 || 0.016);
    lastTick = now;
    draw(dt);
    frame = requestAnimationFrame(tick);
  }

  function syncLoop() {
    if (isAnimating()) {
      if (!frame) { lastTick = performance.now(); frame = requestAnimationFrame(tick); }
    } else {
      if (frame) { cancelAnimationFrame(frame); frame = null; }
      if (ctx) draw(0); // leave one still frame so rain is still shown without motion
    }
    syncLightning();
  }

  function syncLightning() {
    var stormy = root.dataset.mood === "storm" && motion && visible && !document.hidden;
    if (stormy && !flashTimer) {
      (function schedule() {
        flashTimer = setTimeout(function () {
          flashEl.classList.remove("is-on");
          void flashEl.offsetWidth; // restart the CSS animation
          flashEl.classList.add("is-on");
          schedule();
        }, 4500 + Math.random() * 6500);
      })();
    } else if (!stormy && flashTimer) {
      clearTimeout(flashTimer);
      flashTimer = null;
      flashEl.classList.remove("is-on");
    }
  }

  /* ── Mood: forecast → what the scene shows ──────────────────────────── */

  function sunProgress(f) {
    var now = f.current.time, today = f.days[0];
    var rise = today.sunrise, set = today.sunset, DAY = 86400000;
    if (!U.isNum(rise) || !U.isNum(set)) return 0.5;
    if (f.current.isDay) return U.clamp((now - rise) / (set - rise), 0, 1);
    if (now >= set) {
      var nextRise = f.days[1] && U.isNum(f.days[1].sunrise) ? f.days[1].sunrise : rise + DAY;
      return U.clamp((now - set) / (nextRise - set), 0, 1);
    }
    var prevSet = f.yesterday && U.isNum(f.yesterday.sunset) ? f.yesterday.sunset : set - DAY;
    return U.clamp((now - prevSet) / (rise - prevSet), 0, 1);
  }

  function update(f) {
    if (!root) return;
    var c = f.current, today = f.days[0];
    var info = WW.codes.describe(c.code, c.isDay);
    var group = info.group, time = c.isDay ? "day" : "night";
    var nearEdge = c.isDay && U.isNum(today.sunrise) &&
      (c.time - today.sunrise < 50 * 60000 || today.sunset - c.time < 50 * 60000);

    var mood;
    if (group === "storm") mood = "storm";
    else if (group === "rain" || group === "snow" || group === "fog") mood = group + "-" + time;
    else if (c.code === 3) mood = "overcast-" + time;
    else mood = nearEdge ? "dusk" : "clear-" + time;

    var open = mood === "clear-day" || mood === "clear-night" || mood === "dusk";
    var dark = mood === "storm" || time === "night";

    root.dataset.mood = mood;
    root.dataset.orb = open ? (c.isDay ? "sun" : "moon") : "none";
    root.dataset.stars = mood === "clear-night" ? "on" : "off";
    root.dataset.bank = /^(overcast|rain|snow)|storm/.test(mood) ? "on" : "off";
    root.dataset.fog = group === "fog" ? "on" : "off";

    card.style.setProperty("--now-ink", dark ? "#f6f1e6" : "#1c1b18");
    card.style.setProperty("--now-ink-2", dark ? "rgba(246, 241, 230, 0.78)" : "rgba(28, 27, 24, 0.74)");

    // Sun / moon travel along an arc on the right-hand side of the scene.
    var p = sunProgress(f);
    orbEl.style.left = (50 + p * 44).toFixed(1) + "%";
    orbEl.style.top = (60 - Math.sin(Math.PI * p) * 34).toFixed(1) + "%";

    var cover = U.isNum(c.cloud) ? c.cloud : 50;
    var count = open ? (cover < 12 ? 1 : cover < 40 ? 2 : cover < 70 ? 4 : 5) : (group === "fog" ? 2 : 4);
    setClouds(count, c.wind, !open);

    var kind = group === "storm" ? "rain" : (group === "rain" || group === "snow") ? group : "none";
    var changed = kind !== precip.kind || info.intensity !== precip.intensity;
    precip.kind = kind;
    precip.intensity = info.intensity || 1;
    precip.wind = c.wind || 0;
    precip.color = getComputedStyle(root).getPropertyValue("--particle").trim() || precip.color;
    if (changed) seed();
    syncLoop();
  }

  function setMotion(on) {
    motion = !!on && !U.prefersReducedMotion();
    if (!root) return;
    root.classList.toggle("is-still", !motion);
    syncLoop();
  }

  function init() {
    root = document.getElementById("scene");
    if (!root) return;
    card = document.getElementById("scene-card");
    starsEl = document.getElementById("scene-stars");
    cloudsEl = document.getElementById("scene-clouds");
    landEl = document.getElementById("scene-land");
    bankEl = root.querySelector(".scene__bank");
    orbEl = document.getElementById("scene-orb");
    flashEl = document.getElementById("scene-flash");
    canvas = document.getElementById("scene-precip");
    ctx = canvas.getContext("2d");

    buildLand();
    buildStars();
    buildBank();
    setClouds(2, 8, false);
    setMotion(WW.store.settings.motion === "on");

    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(root);
    else window.addEventListener("resize", resize);
    resize();

    // Don't burn battery animating something nobody can see.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        syncLoop();
      }).observe(root);
    }
    document.addEventListener("visibilitychange", syncLoop);
  }

  return { init: init, update: update, setMotion: setMotion };
})();
