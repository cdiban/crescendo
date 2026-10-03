// Aplica el tema antes del primer pintado (archivo propio: la CSP no permite scripts inline).
(function () {
  var mode = 'system';
  try {
    mode = localStorage.getItem('crescendo-theme') || 'system';
  } catch (e) {}
  var dark = mode === 'dark' || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
