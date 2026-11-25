/* Runs before first paint so the page never flashes the wrong theme. */
(function () {
  var theme = "auto";
  try {
    var saved = JSON.parse(localStorage.getItem("ww.settings") || "{}");
    if (saved && saved.theme) theme = saved.theme;
  } catch (e) { /* storage unavailable: fall back to auto */ }

  if (theme === "auto") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
