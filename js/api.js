/* ==========================================================================
   Weatherwise: API layer
   All network access goes through request(), which adds:
     • a timeout (a hung request never leaves the page spinning forever)
     • automatic retries with back-off for network errors and 5xx responses
     • one error type (ApiError) with a "kind" the UI can explain to people
     • validation, so a malformed response is caught here and not in the UI

   APIs used (none requires a key):
     Open-Meteo Forecast, Geocoding and Air Quality, https://open-meteo.com
     BigDataCloud reverse geocoding, https://www.bigdatacloud.com
   ========================================================================== */

WW.api = (function () {
  "use strict";

  var cfg = WW.config;
  var U = WW.utils;

  /* ── Errors ─────────────────────────────────────────────────────────── */

  function ApiError(kind, message, extra) {
    this.name = "ApiError";
    this.kind = kind;
    this.message = message || kind;
    this.status = extra && extra.status;
    this.source = extra && extra.source;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  var RETRYABLE = { network: true, timeout: true, server: true };

  var MESSAGES = {
    offline: {
      icon: "fa-plug-circle-xmark", title: "You’re offline",
      text: "Check your internet connection. We’ll try again as soon as you’re back online."
    },
    timeout: {
      icon: "fa-hourglass-half", title: "The weather service is taking too long",
      text: "It didn’t answer in time. This is usually temporary, please try again in a moment."
    },
    rate: {
      icon: "fa-gauge-high", title: "Too many requests",
      text: "The free weather service limits how often it can be asked. Wait a minute, then try again."
    },
    server: {
      icon: "fa-server", title: "The weather service is having problems",
      text: "Open-Meteo returned an error on its side. Please try again shortly."
    },
    invalid: {
      icon: "fa-file-circle-exclamation", title: "We received an unexpected response",
      text: "The weather service answered, but not with data we could read. Please try again."
    },
    http: {
      icon: "fa-circle-exclamation", title: "The request was rejected",
      text: "The weather service couldn’t answer this request. Try another city."
    },
    network: {
      icon: "fa-cloud-bolt", title: "We couldn’t reach the weather service",
      text: "The service may be down or your connection may be unstable. Please try again."
    }
  };

  /** Turn any error into { icon, title, text } written for people, not developers. */
  function explain(error) {
    var kind = error && error.kind;
    return MESSAGES[kind] || MESSAGES.network;
  }

  /* ── Failure simulation, for testing and for the demo video ──────────
     Add ?fail=forecast (or air, search, cities, locate, all) to the URL to
     make that call fail on purpose, e.g. index.html?fail=air             */

  var simulated = (function () {
    try {
      var value = new URLSearchParams(window.location.search).get("fail");
      return value ? value.toLowerCase().split(",") : [];
    } catch (e) { return []; }
  })();

  function shouldFail(source) {
    return simulated.indexOf("all") >= 0 || simulated.indexOf(source) >= 0;
  }

  /* ── Core request ───────────────────────────────────────────────────── */

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function abortError() {
    var err = new Error("Request cancelled");
    err.name = "AbortError";
    return err;
  }

  function buildUrl(base, params) {
    var query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (params[key] != null) query.set(key, Array.isArray(params[key]) ? params[key].join(",") : params[key]);
    });
    return base + "?" + query.toString();
  }

  async function attempt(url, options) {
    var controller = new AbortController();
    var timedOut = false;
    var onAbort = function () { controller.abort(); };
    if (options.signal) options.signal.addEventListener("abort", onAbort, { once: true });
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, options.timeout);

    try {
      var response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });

      if (!response.ok) {
        var reason = "";
        try { reason = (await response.json()).reason || ""; } catch (e) { /* body was not JSON */ }
        var extra = { status: response.status, source: options.source };
        if (response.status === 429) throw new ApiError("rate", reason, extra);
        if (response.status >= 500) throw new ApiError("server", reason, extra);
        throw new ApiError("http", reason, extra);
      }

      try {
        return await response.json();
      } catch (e) {
        throw new ApiError("invalid", "Response was not valid JSON", { source: options.source });
      }
    } catch (err) {
      if (options.signal && options.signal.aborted) throw abortError();
      if (err instanceof ApiError) throw err;
      if (timedOut) throw new ApiError("timeout", "Timed out", { source: options.source });
      throw new ApiError(navigator.onLine === false ? "offline" : "network", err && err.message, { source: options.source });
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
  }

  async function request(url, options) {
    options = Object.assign({ timeout: cfg.requestTimeoutMs, retries: cfg.retries, source: "forecast" }, options);

    if (options.signal && options.signal.aborted) throw abortError();
    if (shouldFail(options.source)) {
      await delay(500);
      throw new ApiError("network", "Simulated failure (?fail=" + options.source + ")", { source: options.source });
    }
    if (navigator.onLine === false) throw new ApiError("offline", "Offline", { source: options.source });

    for (var tryNo = 0; ; tryNo++) {
      try {
        return await attempt(url, options);
      } catch (err) {
        var canRetry = err instanceof ApiError && RETRYABLE[err.kind] && tryNo < options.retries;
        if (!canRetry) throw err;
        await delay(400 * Math.pow(3, tryNo)); // 0.4 s, then 1.2 s
        if (options.signal && options.signal.aborted) throw abortError();
      }
    }
  }

  /* ── City search (Open-Meteo Geocoding) ─────────────────────────────── */

  async function searchCities(query, signal) {
    var wanted = query.trim().toLowerCase();
    var data = await request(buildUrl(cfg.api.geocoding, {
      name: query, count: 8, language: "en", format: "json"
    }), { source: "search", signal: signal, retries: 1 });

    if (!data || typeof data !== "object") throw new ApiError("invalid", "Bad search response", { source: "search" });

    return (Array.isArray(data.results) ? data.results : [])
      .filter(function (r) { return r && U.isNum(r.latitude) && U.isNum(r.longitude) && r.name; })
      .map(function (r) {
        return {
          id: String(r.id), name: r.name, admin1: r.admin1 || "", country: r.country || "",
          countryCode: r.country_code || "", lat: r.latitude, lon: r.longitude,
          population: r.population || 0
        };
      })
      // Most people mean the big city: exact name matches first, then by population.
      .sort(function (a, b) {
        var exactA = a.name.toLowerCase() === wanted ? 1 : 0, exactB = b.name.toLowerCase() === wanted ? 1 : 0;
        return exactB - exactA || b.population - a.population;
      });
  }

  /* ── Forecast (Open-Meteo Forecast) ─────────────────────────────────── */

  var CURRENT = ["temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day", "precipitation",
    "weather_code", "cloud_cover", "pressure_msl", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"];
  var HOURLY = ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m",
    "precipitation_probability", "precipitation", "weather_code", "cloud_cover", "pressure_msl", "visibility",
    "wind_speed_10m", "wind_gusts_10m", "uv_index", "is_day"];
  var DAILY = ["weather_code", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset", "uv_index_max",
    "precipitation_sum", "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max",
    "wind_direction_10m_dominant"];

  function at(block, key, i) {
    var list = block && block[key];
    var value = Array.isArray(list) ? list[i] : null;
    return value == null ? null : value;
  }

  function normalizeForecast(raw, place) {
    var C = raw && raw.current, H = raw && raw.hourly, D = raw && raw.daily;
    var ok = C && U.isNum(C.temperature_2m) && typeof C.time === "string" &&
      H && Array.isArray(H.time) && H.time.length > 0 &&
      D && Array.isArray(D.time) && D.time.length > 0;
    if (!ok) throw new ApiError("invalid", "Forecast is missing required fields", { source: "forecast" });

    var hourly = H.time.map(function (iso, i) {
      return {
        time: U.toMs(iso),
        temp: at(H, "temperature_2m", i), feels: at(H, "apparent_temperature", i),
        humidity: at(H, "relative_humidity_2m", i), dew: at(H, "dew_point_2m", i),
        pop: at(H, "precipitation_probability", i), precip: at(H, "precipitation", i),
        code: at(H, "weather_code", i), cloud: at(H, "cloud_cover", i),
        pressure: at(H, "pressure_msl", i), visibility: at(H, "visibility", i),
        wind: at(H, "wind_speed_10m", i), gust: at(H, "wind_gusts_10m", i),
        uv: at(H, "uv_index", i), isDay: at(H, "is_day", i) !== 0
      };
    }).filter(function (h) { return U.isNum(h.time) && U.isNum(h.temp); });

    var allDays = D.time.map(function (iso, i) {
      return {
        date: iso, time: U.toMs(iso),
        code: at(D, "weather_code", i),
        max: at(D, "temperature_2m_max", i), min: at(D, "temperature_2m_min", i),
        sunrise: U.toMs(at(D, "sunrise", i)), sunset: U.toMs(at(D, "sunset", i)),
        uvMax: at(D, "uv_index_max", i), precipSum: at(D, "precipitation_sum", i),
        pop: at(D, "precipitation_probability_max", i),
        windMax: at(D, "wind_speed_10m_max", i), gustMax: at(D, "wind_gusts_10m_max", i),
        windDir: at(D, "wind_direction_10m_dominant", i)
      };
    }).filter(function (d) { return U.isNum(d.time) && U.isNum(d.max) && U.isNum(d.min); });

    var todayIso = C.time.slice(0, 10);
    var todayIndex = allDays.findIndex(function (d) { return d.date === todayIso; });
    if (todayIndex < 0) todayIndex = Math.min(1, allDays.length - 1);
    if (!hourly.length || !allDays.length) throw new ApiError("invalid", "Forecast is empty", { source: "forecast" });

    var now = U.toMs(C.time);
    var hourStart = now - (now % 3600000);
    var nowIndex = hourly.findIndex(function (h) { return h.time >= hourStart; });

    return {
      place: place,
      fetchedAt: Date.now(),
      utcOffset: raw.utc_offset_seconds || 0,
      timezone: raw.timezone || "",
      tzAbbr: raw.timezone_abbreviation || "",
      elevation: raw.elevation,
      current: {
        time: now, temp: C.temperature_2m, feels: C.apparent_temperature,
        humidity: C.relative_humidity_2m, isDay: C.is_day !== 0, precip: C.precipitation || 0,
        code: C.weather_code, cloud: C.cloud_cover, pressure: C.pressure_msl,
        wind: C.wind_speed_10m, windDir: C.wind_direction_10m, gust: C.wind_gusts_10m
      },
      hourly: hourly,
      nowIndex: Math.max(0, nowIndex),
      days: allDays.slice(todayIndex),
      yesterday: todayIndex > 0 ? allDays[todayIndex - 1] : null
    };
  }

  async function getForecast(place, signal) {
    var raw = await request(buildUrl(cfg.api.forecast, {
      latitude: place.lat, longitude: place.lon,
      current: CURRENT, hourly: HOURLY, daily: DAILY,
      timezone: "auto", forecast_days: cfg.forecastDays, past_days: 1
    }), { source: "forecast", signal: signal });
    return normalizeForecast(raw, place);
  }

  /* ── Air quality (Open-Meteo Air Quality) ───────────────────────────── */

  async function getAirQuality(place, signal) {
    var raw = await request(buildUrl(cfg.api.airQuality, {
      latitude: place.lat, longitude: place.lon,
      current: ["us_aqi", "pm2_5", "pm10", "ozone", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide"],
      hourly: ["us_aqi"], timezone: "auto", forecast_days: 2
    }), { source: "air", signal: signal, retries: 1 });

    var C = raw && raw.current;
    if (!C || !U.isNum(C.us_aqi)) throw new ApiError("invalid", "Air quality is missing required fields", { source: "air" });

    var now = U.toMs(C.time);
    var trend = [];
    if (raw.hourly && Array.isArray(raw.hourly.time)) {
      raw.hourly.time.forEach(function (iso, i) {
        var t = U.toMs(iso), v = at(raw.hourly, "us_aqi", i);
        if (t >= now && trend.length < 24 && U.isNum(v)) trend.push({ time: t, aqi: v });
      });
    }

    return {
      fetchedAt: Date.now(),
      aqi: C.us_aqi,
      pm25: C.pm2_5, pm10: C.pm10, o3: C.ozone, no2: C.nitrogen_dioxide, so2: C.sulphur_dioxide, co: C.carbon_monoxide,
      trend: trend
    };
  }

  /* ── Snapshot for several cities in ONE request ─────────────────────── */

  async function getCitiesSnapshot(places, signal) {
    if (!places.length) return {};
    var raw = await request(buildUrl(cfg.api.forecast, {
      latitude: places.map(function (p) { return p.lat; }),
      longitude: places.map(function (p) { return p.lon; }),
      current: ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "weather_code", "is_day", "wind_speed_10m"],
      daily: ["temperature_2m_max", "temperature_2m_min"],
      timezone: "auto", forecast_days: 1
    }), { source: "cities", signal: signal, retries: 1 });

    var list = Array.isArray(raw) ? raw : [raw];
    var out = {};
    places.forEach(function (place, i) {
      var row = list[i], C = row && row.current;
      if (!C || !U.isNum(C.temperature_2m)) return; // leave this city without data; the card says so
      out[U.placeId(place)] = {
        temp: C.temperature_2m, feels: C.apparent_temperature, humidity: C.relative_humidity_2m,
        code: C.weather_code, isDay: C.is_day !== 0, wind: C.wind_speed_10m,
        max: at(row.daily, "temperature_2m_max", 0), min: at(row.daily, "temperature_2m_min", 0),
        utcOffset: row.utc_offset_seconds || 0
      };
    });
    if (!Object.keys(out).length) throw new ApiError("invalid", "No city data returned", { source: "cities" });
    return out;
  }

  /* ── Location (browser geolocation + BigDataCloud) ──────────────────── */

  function toPlace(data, fallbackName) {
    if (!data || !U.isNum(data.latitude) || !U.isNum(data.longitude)) {
      throw new ApiError("invalid", "Location lookup returned no coordinates", { source: "locate" });
    }
    return {
      id: data.latitude.toFixed(2) + "," + data.longitude.toFixed(2),
      name: data.city || data.locality || data.principalSubdivision || fallbackName,
      admin1: data.principalSubdivision || "",
      country: data.countryName || "", countryCode: data.countryCode || "",
      lat: data.latitude, lon: data.longitude
    };
  }

  /** Coordinates → place name. */
  async function reverseGeocode(lat, lon, signal) {
    var data = await request(buildUrl(cfg.api.reverse, {
      latitude: lat, longitude: lon, localityLanguage: "en"
    }), { source: "locate", signal: signal, retries: 1, timeout: 6000 });
    var place = toPlace(data, "My location");
    place.lat = lat; place.lon = lon;
    return place;
  }

  /** Rough location from the network address, no permission prompt. Used once, on a first visit. */
  async function approximateLocation(signal) {
    var data = await request(buildUrl(cfg.api.reverse, { localityLanguage: "en" }),
      { source: "locate", signal: signal, retries: 0, timeout: 4000 });
    return toPlace(data, "My area");
  }

  var GEO_MESSAGES = {
    unsupported: "This browser can’t share its location. Search for your city instead.",
    insecure: "Precise location needs a secure (https) connection. Search for your city instead.",
    denied: "Location permission was denied. You can allow it in your browser’s site settings, or search for your city.",
    unavailable: "Your device couldn’t work out where it is. Try again, or search for your city.",
    timeout: "Finding your location took too long. Try again, or search for your city."
  };

  /** Ask the browser for the device position. Rejects with { geo: reason, message }. */
  function devicePosition() {
    return new Promise(function (resolve, reject) {
      function fail(reason) { reject({ geo: reason, message: GEO_MESSAGES[reason] }); }
      if (shouldFail("locate")) return fail("unavailable");
      if (!("geolocation" in navigator)) return fail("unsupported");
      if (window.isSecureContext === false) return fail("insecure");
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        function (err) { fail(err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable"); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });
  }

  return {
    ApiError: ApiError, explain: explain, simulated: simulated,
    searchCities: searchCities, getForecast: getForecast, getAirQuality: getAirQuality,
    getCitiesSnapshot: getCitiesSnapshot,
    reverseGeocode: reverseGeocode, approximateLocation: approximateLocation, devicePosition: devicePosition
  };
})();
