/* Post page behaviour (STYLE_GUIDE.md, "Post layout"). Everything here is an enhancement: without JavaScript the
   sections are still native <details> blocks and a slideshow is a row of images that scrolls sideways. */
(function () {
  var sections = Array.prototype.slice.call(document.querySelectorAll(".post-section"));

  /* Open the section holding a link target (#heading, or anything inside a section), so links from elsewhere and
     in-page links land on visible text. */
  function reveal(hash) {
    if (!hash || hash.length < 2) return;
    var target;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { return; }
    if (!target) return;
    var section = target.closest(".post-section");
    if (section && !section.open) { section.open = true; }
    if (section) { target.scrollIntoView(); }
  }
  reveal(location.hash);
  window.addEventListener("hashchange", function () { reveal(location.hash); });

  /* One "open all / close all" button above the sections. */
  var list = document.querySelector(".post-sections");
  if (list && sections.length > 1) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "post-sections-toggle";
    function allOpen() { return sections.every(function (s) { return s.open; }); }
    function label() {
      var open = allOpen();
      btn.textContent = open ? "Collapse all sections" : "Expand all sections";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function () {
      var open = !allOpen();
      sections.forEach(function (s) { s.open = open; });
      label();
    });
    sections.forEach(function (s) { s.addEventListener("toggle", label); });
    label();
    list.parentNode.insertBefore(btn, list);
  }

  /* Printing shows the whole post. */
  var printed = [];
  window.addEventListener("beforeprint", function () {
    printed = sections.filter(function (s) { return !s.open; });
    printed.forEach(function (s) { s.open = true; });
  });
  window.addEventListener("afterprint", function () {
    printed.forEach(function (s) { s.open = false; });
    printed = [];
  });

  /* Slideshows: previous / next buttons and an "n of m" counter over a scroll-snap track (swipe still works). */
  Array.prototype.forEach.call(document.querySelectorAll(".slideshow"), function (show) {
    var track = show.querySelector(".slideshow-track");
    var slides = Array.prototype.slice.call(track.children);
    var controls = show.querySelector(".slideshow-controls");
    var prev = controls.querySelector("[data-dir='-1']");
    var next = controls.querySelector("[data-dir='1']");
    var count = controls.querySelector(".slideshow-count");
    var current = 0;

    function update(i) {
      current = i;
      count.textContent = (i + 1) + " of " + slides.length;
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      slides.forEach(function (s, j) { s.setAttribute("aria-hidden", j === i ? "false" : "true"); });
    }
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: smooth() });
      update(i);
    }
    function smooth() {
      return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    }

    prev.addEventListener("click", function () { go(current - 1); });
    next.addEventListener("click", function () { go(current + 1); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(current + 1); }
    });
    /* Keep the counter right when the reader swipes instead of using the buttons. */
    var timer;
    track.addEventListener("scroll", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== current) update(Math.max(0, Math.min(slides.length - 1, i)));
      }, 80);
    }, { passive: true });

    show.classList.add("is-enhanced");
    controls.hidden = false;
    update(0);
  });
})();
