/* ==========================================================================
   Weatherwise: configuration
   Every external service the app talks to is listed here, in one place.
   None of them needs an API key, so there are no secrets in this project.
   ========================================================================== */

window.WW = window.WW || {};

// When the page is served by the Express server (npm start), weather requests go to
// that server's /api routes, and the server talks to Open-Meteo. Any API key stays
// on the server. If index.html is opened directly as a file there is no server, so
// the page falls back to calling the free, key-less Open-Meteo endpoints itself.
WW.viaServer = window.location.protocol === "http:" || window.location.protocol === "https:";

WW.config = {
  api: {
    // Open-Meteo, weather forecast            https://open-meteo.com/en/docs
    forecast: WW.viaServer ? "/api/forecast" : "https://api.open-meteo.com/v1/forecast",
    // Open-Meteo, city search (geocoding)     https://open-meteo.com/en/docs/geocoding-api
    geocoding: WW.viaServer ? "/api/geocode" : "https://geocoding-api.open-meteo.com/v1/search",
    // Open-Meteo, air quality                 https://open-meteo.com/en/docs/air-quality-api
    airQuality: WW.viaServer ? "/api/air-quality" : "https://air-quality-api.open-meteo.com/v1/air-quality",
    // BigDataCloud, coordinates → place name  https://www.bigdatacloud.com/free-api/free-reverse-geocode-to-city-api
    // Always called from the browser: it works out where the *visitor* is, and it needs no key.
    reverse: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },

  requestTimeoutMs: 10000,   // give up on a request after 10 s
  retries: 2,                // extra attempts for network errors and 5xx responses
  refreshMinutes: 10,        // auto-refresh interval while the tab is open
  forecastDays: 10,
  searchDebounceMs: 250,
  maxSavedCities: 12,

  // Shown only if there is no saved city and the approximate-location lookup fails.
  defaultPlace: {
    id: "202061", name: "Kigali", admin1: "Kigali", country: "Rwanda", countryCode: "RW",
    lat: -1.94995, lon: 30.05885
  },

  // A starter set for "My cities" so comparing, sorting and filtering work on first visit.
  starterCities: [
    { id: "202061", name: "Kigali", admin1: "Kigali", country: "Rwanda", countryCode: "RW", lat: -1.94995, lon: 30.05885 },
    { id: "184745", name: "Nairobi", admin1: "Nairobi County", country: "Kenya", countryCode: "KE", lat: -1.28333, lon: 36.81667 },
    { id: "2332459", name: "Lagos", admin1: "Lagos", country: "Nigeria", countryCode: "NG", lat: 6.45407, lon: 3.39467 },
    { id: "2643743", name: "London", admin1: "England", country: "United Kingdom", countryCode: "GB", lat: 51.50853, lon: -0.12574 },
    { id: "1850147", name: "Tokyo", admin1: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6895, lon: 139.69171 },
    { id: "5128581", name: "New York", admin1: "New York", country: "United States", countryCode: "US", lat: 40.71427, lon: -74.00597 }
  ]
};
