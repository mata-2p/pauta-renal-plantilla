// One section per screen, chosen by the address (#indicaciones, #diario...).
// Every screen is a hash, so the browser's back button works and links can be
// shared. Without this script nothing is hidden: every section shows in order.
// Loaded in <head> so the page never flashes the long version first.
(function () {
  "use strict";
  var HUB = "inicio";
  var root = document.documentElement;
  var baseTitle = document.title;
  var current = null;
  var started = false;

  root.classList.add("routed");
  root.setAttribute("data-view", location.hash && location.hash !== "#" + HUB ? "section" : "hub");
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /** What the hash points at: the hub, a section (and the element inside it), or null for a plain in-page anchor. */
  function resolve(hash) {
    var id = "";
    try { id = decodeURIComponent((hash || "").replace(/^#/, "")); } catch (e) { id = ""; }
    if (!id || id === HUB) return { hub: true };
    var el = document.getElementById(id);
    if (!el) return { hub: true };
    var section = el.closest("section[data-route]");
    if (section) return { section: section, target: el };
    return null;
  }

  function nameOf(section) {
    var tile = document.querySelector('#' + HUB + ' .tiles a[href="#' + section.id + '"]');
    return (tile || section.querySelector("h2")).textContent.replace(/\s+/g, " ").trim();
  }

  function show(r, focus) {
    if (!r) {
      if (started) return; // e.g. the skip link: keep the current screen
      r = { hub: true };
    }
    started = true;
    var sections = document.querySelectorAll("section[data-route]");
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.toggle("current", sections[i] === r.section);
    }
    root.setAttribute("data-view", r.hub ? "hub" : "section");
    var here = r.hub ? "" : "#" + r.section.id;
    var side = document.querySelectorAll(".siblings a");
    for (var j = 0; j < side.length; j++) {
      if (side[j].getAttribute("href") === here) side[j].setAttribute("aria-current", "page");
      else side[j].removeAttribute("aria-current");
    }
    document.title = r.hub ? baseTitle : nameOf(r.section) + " · " + baseTitle;
    document.dispatchEvent(new CustomEvent("routechange", { detail: { section: r.hub ? null : r.section.id } }));

    if (r.hub) {
      var from = current && document.querySelector('#' + HUB + ' .tiles a[href="#' + current.id + '"]');
      current = null;
      if (focus && from) {
        from.focus({ preventScroll: true });
        from.closest("li").scrollIntoView({ block: "center" });
      } else {
        window.scrollTo(0, 0);
      }
      return;
    }

    current = r.section;
    var deep = r.target !== r.section;
    if (deep) r.target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
    if (focus) {
      var to = deep && r.target.hasAttribute("tabindex") ? r.target : r.section.querySelector("h2");
      if (to) to.focus({ preventScroll: true });
    }
  }

  window.addEventListener("hashchange", function () { show(resolve(location.hash), true); });
  document.addEventListener("DOMContentLoaded", function () { show(resolve(location.hash), false); });
})();
