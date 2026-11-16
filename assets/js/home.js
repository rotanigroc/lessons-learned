/* Home page tag filter (STYLE_GUIDE.md, section 8). The tag links go to ?tag=<key>; this script shows only the posts
   with that tag, without a reload, and keeps the URL shareable. Without JavaScript every post shows. */
(function () {
  var bar = document.querySelector(".tag-filter");
  var items = Array.prototype.slice.call(document.querySelectorAll(".post-list > li"));
  var status = document.querySelector(".tag-filter-status");
  if (!bar || !items.length) return;
  var links = Array.prototype.slice.call(bar.querySelectorAll("a[data-tag]"));
  var known = links.map(function (a) { return a.getAttribute("data-tag"); });

  function current() {
    var m = /[?&]tag=([^&#]*)/.exec(location.search);
    var tag = m ? decodeURIComponent(m[1]) : "";
    return known.indexOf(tag) >= 0 ? tag : "";
  }

  function apply(tag) {
    var shown = 0;
    items.forEach(function (li) {
      var tags = (li.getAttribute("data-tags") || "").split(" ");
      var show = !tag || tags.indexOf(tag) >= 0;
      li.hidden = !show;
      if (show) shown++;
    });
    links.forEach(function (a) {
      if (a.getAttribute("data-tag") === tag) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
    if (status) {
      var label = "";
      links.forEach(function (a) { if (a.getAttribute("data-tag") === tag) label = a.firstChild.textContent.trim(); });
      status.textContent = tag ? shown + (shown === 1 ? " post" : " posts") + " tagged " + label + "." : "";
    }
  }

  /* Any tag link on the page (the bar or a post's own tags) filters in place. */
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.tag[data-tag]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    var tag = a.getAttribute("data-tag");
    if (known.indexOf(tag) < 0) return;
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    apply(tag);
    if (a.closest(".post-list")) bar.scrollIntoView({ block: "start" });
  });
  window.addEventListener("popstate", function () { apply(current()); });
  apply(current());
})();
