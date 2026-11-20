(function () {
  try {
    var saved = localStorage.getItem('sas-theme');
    var prefersLight =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = saved === 'light' || saved === 'dark' ? saved : prefersLight ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
