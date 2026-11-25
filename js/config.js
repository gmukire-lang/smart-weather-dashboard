window.WW = window.WW || {};

WW.viaServer = window.location.protocol === "http:" || window.location.protocol === "https:";

WW.config = {
  api: {
    forecast: WW.viaServer ? "/api/forecast" : "https://api.open-meteo.com/v1/forecast",
    geocoding: WW.viaServer ? "/api/geocode" : "https://geocoding-api.open-meteo.com/v1/search",
    airQuality: WW.viaServer ? "/api/air-quality" : "https://air-quality-api.open-meteo.com/v1/air-quality",
    reverse: "https://api.bigdatacloud.net/data/reverse-geocode-client"
  },

  requestTimeoutMs: 10000,
  retries: 2,
  refreshMinutes: 10,
  forecastDays: 10,
  searchDebounceMs: 250,
  maxSavedCities: 12,

  defaultPlace: {
    id: "202061", name: "Kigali", admin1: "Kigali", country: "Rwanda", countryCode: "RW",
    lat: -1.94995, lon: 30.05885
  },

  starterCities: [
    { id: "202061", name: "Kigali", admin1: "Kigali", country: "Rwanda", countryCode: "RW", lat: -1.94995, lon: 30.05885 },
    { id: "184745", name: "Nairobi", admin1: "Nairobi County", country: "Kenya", countryCode: "KE", lat: -1.28333, lon: 36.81667 },
    { id: "2332459", name: "Lagos", admin1: "Lagos", country: "Nigeria", countryCode: "NG", lat: 6.45407, lon: 3.39467 },
    { id: "2643743", name: "London", admin1: "England", country: "United Kingdom", countryCode: "GB", lat: 51.50853, lon: -0.12574 },
    { id: "1850147", name: "Tokyo", admin1: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6895, lon: 139.69171 },
    { id: "5128581", name: "New York", admin1: "New York", country: "United States", countryCode: "US", lat: 40.71427, lon: -74.00597 }
  ]
};
