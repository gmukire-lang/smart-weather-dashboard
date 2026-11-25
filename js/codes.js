WW.codes = (function () {
  "use strict";

  var TABLE = {
    0: ["Clear sky", "fa-sun", "fa-moon", "clear", 0],
    1: ["Mostly clear", "fa-sun", "fa-moon", "clear", 0],
    2: ["Partly cloudy", "fa-cloud-sun", "fa-cloud-moon", "cloudy", 0],
    3: ["Overcast", "fa-cloud", "fa-cloud", "cloudy", 0],
    45: ["Fog", "fa-smog", "fa-smog", "fog", 0],
    48: ["Freezing fog", "fa-smog", "fa-smog", "fog", 0],
    51: ["Light drizzle", "fa-cloud-rain", "fa-cloud-rain", "rain", 1],
    53: ["Drizzle", "fa-cloud-rain", "fa-cloud-rain", "rain", 1],
    55: ["Heavy drizzle", "fa-cloud-rain", "fa-cloud-rain", "rain", 2],
    56: ["Light freezing drizzle", "fa-cloud-rain", "fa-cloud-rain", "rain", 1],
    57: ["Freezing drizzle", "fa-cloud-rain", "fa-cloud-rain", "rain", 2],
    61: ["Light rain", "fa-cloud-rain", "fa-cloud-rain", "rain", 1],
    63: ["Rain", "fa-cloud-rain", "fa-cloud-rain", "rain", 2],
    65: ["Heavy rain", "fa-cloud-showers-heavy", "fa-cloud-showers-heavy", "rain", 3],
    66: ["Light freezing rain", "fa-cloud-rain", "fa-cloud-rain", "rain", 1],
    67: ["Freezing rain", "fa-cloud-showers-heavy", "fa-cloud-showers-heavy", "rain", 3],
    71: ["Light snow", "fa-snowflake", "fa-snowflake", "snow", 1],
    73: ["Snow", "fa-snowflake", "fa-snowflake", "snow", 2],
    75: ["Heavy snow", "fa-snowflake", "fa-snowflake", "snow", 3],
    77: ["Snow grains", "fa-snowflake", "fa-snowflake", "snow", 1],
    80: ["Light showers", "fa-cloud-sun-rain", "fa-cloud-moon-rain", "rain", 1],
    81: ["Showers", "fa-cloud-sun-rain", "fa-cloud-moon-rain", "rain", 2],
    82: ["Violent showers", "fa-cloud-showers-heavy", "fa-cloud-showers-heavy", "rain", 3],
    85: ["Light snow showers", "fa-snowflake", "fa-snowflake", "snow", 1],
    86: ["Snow showers", "fa-snowflake", "fa-snowflake", "snow", 3],
    95: ["Thunderstorm", "fa-cloud-bolt", "fa-cloud-bolt", "storm", 3],
    96: ["Thunderstorm with hail", "fa-cloud-bolt", "fa-cloud-bolt", "storm", 3],
    99: ["Severe thunderstorm with hail", "fa-cloud-bolt", "fa-cloud-bolt", "storm", 3]
  };

  var UNKNOWN = ["Unknown conditions", "fa-circle-question", "fa-circle-question", "cloudy", 0];

  function describe(code, isDay) {
    var row = TABLE[code] || UNKNOWN;
    return {
      label: row[0],
      icon: isDay === false || isDay === 0 ? row[2] : row[1],
      group: row[3],
      intensity: row[4]
    };
  }

  function bucket(code) {
    var group = describe(code).group;
    if (group === "clear") return "clear";
    if (group === "cloudy" || group === "fog") return "cloudy";
    return "wet";
  }

  function isWet(code) {
    var group = describe(code).group;
    return group === "rain" || group === "snow" || group === "storm";
  }

  return { describe: describe, bucket: bucket, isWet: isWet };
})();
