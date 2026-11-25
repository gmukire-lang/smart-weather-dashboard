/* ==========================================================================
   Weatherwise: Express server
   Two jobs:
     1. Serve the website (index.html, css/, js/, assets/).
     2. Be the ONLY thing that talks to the weather APIs. The browser calls
        /api/... on this server; the server calls Open-Meteo. Any API key lives
        in the server's environment (.env) and is added here, so it is never
        sent to, or visible in, the browser.

   Extras that come with a proxy: input validation, a short cache (fewer
   upstream calls, faster answers), rate limiting, and security headers.
   ========================================================================== */

"use strict";

require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = (process.env.OPEN_METEO_API_KEY || "").trim(); // secret: never logged, never sent to clients
const HOSTNAME = os.hostname();
const UPSTREAM_TIMEOUT_MS = 8000;

// With a key, Open-Meteo's commercial hosts are used; without one, the free hosts.
const prefix = API_KEY ? "customer-" : "";
const UPSTREAM = {
  forecast: `https://${prefix}api.open-meteo.com/v1/forecast`,
  airQuality: `https://${prefix}air-quality-api.open-meteo.com/v1/air-quality`,
  geocoding: `https://${prefix}geocoding-api.open-meteo.com/v1/search`
};

const app = express();
app.disable("x-powered-by");
// In production a request passes through HAProxy and then Nginx before it gets here.
// Trusting those two hops lets rate limiting see the visitor's real IP address
// instead of treating every visitor as "the load balancer".
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 2);

/* ── Headers on every response ────────────────────────────────────────── */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  // Weather data comes from this server. BigDataCloud is called by the browser
  // directly because it locates the *visitor*; proxying it would locate the server.
  "connect-src 'self' https://api.bigdatacloud.net",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

app.use((req, res, next) => {
  res.set({
    "X-Served-By": HOSTNAME, // shows which web server answered (load-balancer test)
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  next();
});

/* ── Small in-memory cache ────────────────────────────────────────────── */

const cache = new Map(); // url → { expires, body }
const MAX_CACHE_ENTRIES = 500;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { cache.delete(key); return null; }
  return hit.body;
}

function cacheSet(key, body, ttlMs) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value); // drop the oldest
  cache.set(key, { expires: Date.now() + ttlMs, body });
}

/* ── Validation helpers ───────────────────────────────────────────────── */

class BadRequest extends Error {}

/** "1.5,2.5" → validated string; throws if anything is not a number in range. */
function coordinates(value, limit, name) {
  const parts = String(value || "").split(",");
  if (!value || parts.length > 12) throw new BadRequest(`"${name}" is required (up to 12 values).`);
  for (const part of parts) {
    const n = Number(part);
    if (part.trim() === "" || !Number.isFinite(n) || Math.abs(n) > limit) throw new BadRequest(`"${name}" must be numbers between -${limit} and ${limit}.`);
  }
  return parts.map((p) => Number(p)).join(",");
}

/** A comma-separated list of variable names, e.g. "temperature_2m,weather_code". */
function variableList(value) {
  if (value == null || value === "") return undefined;
  if (!/^[a-z0-9_,]{1,600}$/.test(String(value))) throw new BadRequest("Invalid variable list.");
  return String(value);
}

function integer(value, min, max, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`Expected a whole number between ${min} and ${max}.`);
  return n;
}

/* ── The proxy ────────────────────────────────────────────────────────── */

async function callUpstream(base, params, ttlMs) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) query.set(k, v); });
  const publicUrl = `${base}?${query}`;          // cache key: contains no secret

  const cached = cacheGet(publicUrl);
  if (cached) return { status: 200, body: cached, cached: true };

  if (API_KEY) query.set("apikey", API_KEY);     // the key is added here and only here

  let response;
  try {
    response = await fetch(`${base}?${query}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      status: timedOut ? 504 : 502,
      body: { error: true, reason: timedOut ? "The weather service took too long to answer." : "The weather service could not be reached." }
    };
  }

  let body;
  try { body = await response.json(); }
  catch (e) { return { status: 502, body: { error: true, reason: "The weather service sent an unreadable answer." } }; }

  if (!response.ok) {
    // Pass the status on (429, 400, 5xx) but never echo anything that might contain the key.
    const reason = typeof body.reason === "string" ? body.reason.replace(/apikey=[^&\s]*/gi, "apikey=***") : "Upstream error.";
    return { status: response.status, body: { error: true, reason } };
  }

  cacheSet(publicUrl, body, ttlMs);
  return { status: 200, body, cached: false };
}

function route(base, ttlMs, buildParams) {
  return async (req, res) => {
    try {
      const result = await callUpstream(base, buildParams(req.query), ttlMs);
      res.set("Cache-Control", "no-store");
      res.set("X-Cache", result.cached ? "HIT" : "MISS");
      res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof BadRequest) return res.status(400).json({ error: true, reason: err.message });
      console.error("Proxy error:", err.message);
      res.status(500).json({ error: true, reason: "Unexpected server error." });
    }
  };
}

const api = express.Router();

// Registered before the rate limiter so health checks are never throttled.
// Used by the load balancer's health check and handy for debugging.
api.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "ok", server: HOSTNAME, uptimeSeconds: Math.round(process.uptime()), usingApiKey: Boolean(API_KEY) });
});

api.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: true, reason: "Too many requests. Please wait a minute and try again." }
}));

api.get("/forecast", route(UPSTREAM.forecast, 5 * 60 * 1000, (q) => ({
  latitude: coordinates(q.latitude, 90, "latitude"),
  longitude: coordinates(q.longitude, 180, "longitude"),
  current: variableList(q.current),
  hourly: variableList(q.hourly),
  daily: variableList(q.daily),
  timezone: "auto",
  forecast_days: integer(q.forecast_days, 1, 16, 7),
  past_days: integer(q.past_days, 0, 2, 0)
})));

api.get("/air-quality", route(UPSTREAM.airQuality, 10 * 60 * 1000, (q) => ({
  latitude: coordinates(q.latitude, 90, "latitude"),
  longitude: coordinates(q.longitude, 180, "longitude"),
  current: variableList(q.current),
  hourly: variableList(q.hourly),
  timezone: "auto",
  forecast_days: integer(q.forecast_days, 1, 5, 2)
})));

api.get("/geocode", route(UPSTREAM.geocoding, 24 * 60 * 60 * 1000, (q) => {
  const name = String(q.name || "").trim().slice(0, 80);
  if (name.length < 2) throw new BadRequest("\"name\" must be at least 2 characters.");
  return { name, count: integer(q.count, 1, 10, 8), language: "en", format: "json" };
}));

api.use((req, res) => res.status(404).json({ error: true, reason: "Unknown API route." }));

app.use("/api", api);

/* ── The website ──────────────────────────────────────────────────────────
   Only these folders are public. server.js, .env, package.json, deploy/ and
   the README are NOT reachable from the browser.                           */

const staticOptions = { etag: true, lastModified: true, setHeaders: (res) => res.set("Cache-Control", "no-cache") };
app.use("/css", express.static(path.join(__dirname, "css"), staticOptions));
app.use("/js", express.static(path.join(__dirname, "js"), staticOptions));
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "7d" }));

app.get(["/", "/index.html"], (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((req, res) => res.status(404).type("text").send("Not found"));

app.listen(PORT, () => {
  console.log(`Weatherwise running on http://localhost:${PORT}  (server: ${HOSTNAME}, Open-Meteo key: ${API_KEY ? "configured" : "not needed / not set"})`);
});
