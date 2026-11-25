(function () {
  var theme = "auto";
  try {
    var saved = JSON.parse(localStorage.getItem("ww.settings") || "{}");
    if (saved && saved.theme) theme = saved.theme;
  } catch (e) {}

  if (theme === "auto") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
