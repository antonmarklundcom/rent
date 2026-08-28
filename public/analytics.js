/* web-design-system — analytics-prep shim. Loads nothing, needs no account.
   Every element carrying data-ev pushes a dataLayer event on click so GA4/GTM/
   Plausible can be switched on later with zero markup changes. */
(function () {
  window.dataLayer = window.dataLayer || [];
  document.addEventListener(
    "click",
    function (e) {
      var t = e.target.closest("[data-ev]");
      if (!t) return;
      window.dataLayer.push({
        event: t.dataset.ev,
        ev_loc: t.dataset.evLoc || "",
        page_path: location.pathname,
        site: location.hostname,
      });
    },
    true,
  );
})();
