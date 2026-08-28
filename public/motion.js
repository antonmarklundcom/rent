/* web-design-system — motion.js. Copied verbatim. No dependencies. ~2KB.
   Budget: at most 15% of elements should carry data-reveal. Re-runs on every
   Next.js client navigation via the "next-route-announcer" DOM mutation, so it
   is re-invoked from a small wrapper at the bottom of this file. */
(function () {
  function run() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var d = document;

    var items = d.querySelectorAll("[data-reveal]:not([data-reveal-done])");
    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
        el.setAttribute("data-reveal-done", "");
      });
    } else {
      items.forEach(function (el) {
        el.style.opacity = 0;
        el.style.transform = "translateY(18px)";
        el.style.transition =
          "opacity 280ms cubic-bezier(.16,1,.3,1), transform 280ms cubic-bezier(.16,1,.3,1)";
        el.setAttribute("data-reveal-done", "");
      });
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            var i = Math.min(+(e.target.dataset.reveal || 0), 6);
            e.target.style.transitionDelay = i * 70 + "ms";
            e.target.style.opacity = 1;
            e.target.style.transform = "none";
            io.unobserve(e.target);
          });
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
      );
      items.forEach(function (el) {
        io.observe(el);
      });
    }

    var nums = d.querySelectorAll("[data-count]:not([data-count-done])");
    if (nums.length && !reduce && "IntersectionObserver" in window) {
      var nio = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            var el = e.target,
              to = parseFloat(el.dataset.count),
              t0 = null;
            var suffix = el.dataset.countSuffix || "";
            el.setAttribute("data-count-done", "");
            function step(ts) {
              if (!t0) t0 = ts;
              var p = Math.min((ts - t0) / 900, 1);
              var eased = 1 - Math.pow(1 - p, 3);
              el.textContent = Math.round(to * eased).toLocaleString() + suffix;
              if (p < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
            nio.unobserve(el);
          });
        },
        { threshold: 0.5 },
      );
      nums.forEach(function (el) {
        nio.observe(el);
      });
    }

    var hdr = d.querySelector("[data-sticky-header]");
    if (hdr && !hdr.dataset.stickyWired) {
      hdr.dataset.stickyWired = "1";
      var tick = false;
      window.addEventListener(
        "scroll",
        function () {
          if (tick) return;
          tick = true;
          requestAnimationFrame(function () {
            hdr.classList.toggle("is-stuck", window.scrollY > 24);
            tick = false;
          });
        },
        { passive: true },
      );
    }
  }

  run();
  if (typeof MutationObserver !== "undefined") {
    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        run();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
