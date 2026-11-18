(function () {
  try {
    var t = localStorage.getItem('nova_theme') || 'light';
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
