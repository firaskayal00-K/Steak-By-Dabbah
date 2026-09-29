/* Menu preview. Standalone: reads /api/menu. Embedded in the admin (?embed=1): also accepts live drafts via postMessage. */
(function () {
  "use strict";
  var S = window.SBD;
  var root = document.getElementById("root");
  var embed = /[?&]embed=1\b/.test(location.search);
  var data = null;
  var lang = pickLang();
  var filter = "all";
  var query = "";

  function pickLang() {
    var m = /[?&]lang=(ar|he|en)\b/.exec(location.search);
    if (m) return m[1];
    try { var l = localStorage.getItem("sbd_lang"); if (l === "ar" || l === "he" || l === "en") return l; } catch (e) { /* no storage */ }
    return "ar";
  }
  function tx(key, n) {
    var e = data.texts[key];
    var s = (e && (e[lang] || e.en)) || "";
    return n != null ? s.split("{n}").join(String(n)) : s;
  }
  function nm(o, f) { return o[(f || "name_") + lang] || o.name_en || ""; }
  function esc(v) { return S.esc(v); }
  function resultsText(n) {
    return tx(n === 1 ? "resultsOne" : n === 2 ? "resultsTwo" : n <= 10 ? "resultsFew" : "resultsMany", n);
  }
  function render() {
    if (!data) return;
    var html = document.documentElement;
    html.lang = lang;
    html.dir = S.DIR[lang];
    var r = data.restaurant;

    var stars = "";
    for (var i = 1; i <= 5; i++) stars += '<span style="opacity:' + (r.rating >= i - 0.25 ? 1 : 0.3) + '">' + S.glyph("star", "ic") + "</span>";

    root.innerHTML =
      '<div class="hero"><img src="/assets/logo-poster.jpg" alt="' + esc(r.name) + '" width="1280" height="720"></div>' +
      '<div class="intro"><p class="tagline">' + esc(tx("tagline")) + '</p><p class="tagline-sub">' + esc(tx("taglineSub")) + "</p>" +
      '<div class="socials">' +
      '<a class="round" href="' + esc(r.instagram) + '" target="_blank" rel="noopener" aria-label="' + esc(tx("instagram")) + '">' + S.glyph("instagram") + "</a>" +
      '<a class="round" href="' + esc(r.facebook) + '" target="_blank" rel="noopener" aria-label="' + esc(tx("facebook")) + '">' + S.glyph("facebook") + "</a>" +
      '<a class="round" href="' + esc(r.mapsUrl) + '" target="_blank" rel="noopener" aria-label="' + esc(tx("maps")) + '">' + S.glyph("pin") + "</a>" +
      "</div></div>" +
      '<div class="menu-title">' + esc(tx("menu")) + "</div>" +
      '<div class="bar"><div class="chips" role="group" aria-label="' + esc(tx("filters")) + '">' +
      '<button type="button" class="chip" data-filter="all" aria-pressed="' + (filter === "all") + '">' + S.glyph("sparkle", "ic") + esc(tx("all")) + "</button>" +
      data.categories.map(function (c) { return '<button type="button" class="chip" data-filter="' + esc(c.id) + '" aria-pressed="' + (filter === c.id) + '">' + S.icon(c.icon, "ic") + esc(nm(c)) + "</button>"; }).join("") +
      '</div><div class="lang" role="group" aria-label="' + esc(tx("language")) + '">' +
      S.LANGS.map(function (l) { return '<button type="button" data-lang="' + l + '" aria-pressed="' + (l === lang) + '">' + l.toUpperCase() + "</button>"; }).join("") +
      "</div></div>" +
      '<div class="search"><input type="search" id="q" placeholder="' + esc(tx("search")) + '" value="' + esc(query) + '" aria-label="' + esc(tx("search")) + '"></div>' +
      '<div id="results">' + resultsHtml() + "</div>" +
      '<div class="reviews"><h3>' + esc(tx("reviewsTitle")) + '</h3><div class="stars">' + stars + '</div><p class="score">' + esc(Number(r.rating).toFixed(1)) + " / 5</p>" +
      '<p style="color:var(--ash);margin:4px 0 14px">' + esc(tx("reviewsCount", r.reviewCount)) + '</p><a class="btn" href="' + esc(r.reviewsUrl) + '" target="_blank" rel="noopener">' + esc(tx("rate")) + "</a></div>" +
      '<div class="hours"><h3>' + S.glyph("clock", "ic") + " " + esc(tx("hours")) + "</h3><div>" + esc(tx("hoursDays")) + '</div><div style="color:var(--gold-200);direction:ltr;margin-top:4px">' + esc(tx("hoursTime")) + "</div></div>" +
      "<footer>© " + new Date().getFullYear() + " " + esc(r.name) + " · " + esc(tx("rights")) + "</footer>" +
      '<button type="button" class="top" data-top aria-label="' + esc(tx("top")) + '">' + S.glyph("arrowUp", "ic") + "</button>" +
      '<nav class="dock">' +
      '<a href="tel:' + esc(r.phone) + '">' + S.glyph("phone", "ic") + "<span>" + esc(tx("call")) + "</span></a>" +
      '<a class="main" href="' + esc(r.whatsapp) + '" target="_blank" rel="noopener">' + S.glyph("whatsapp", "ic") + "<span>" + esc(tx("whatsapp")) + "</span></a>" +
      '<a href="' + esc(r.mapsUrl) + '" target="_blank" rel="noopener">' + S.glyph("pin", "ic") + "<span>" + esc(tx("directions")) + "</span></a>" +
      "</nav>";
  }

  // Only the dish list changes while typing, so the search <input> (and any IME composition in it) survives.
  function resultsHtml() {
    var cur = data.restaurant.currency;
    var q = S.searchKey(query.trim());
    var total = 0;
    var sections = data.categories.map(function (c, ci) {
      if (filter !== "all" && filter !== c.id) return "";
      var items = c.items.filter(function (it) {
        return !q || S.searchKey([it.name_ar, it.name_he, it.name_en, it.description_ar, it.description_he, it.description_en].join(" ")).indexOf(q) !== -1;
      });
      if (!items.length) return "";
      total += items.length;
      return '<section class="section" id="cat-' + esc(c.id) + '"><div class="sec-head"><div><div class="sec-num">' + String(ci + 1).padStart(2, "0") + "</div><h2>" + esc(nm(c)) + "</h2>" +
        (lang !== "en" ? '<div class="sec-sub">' + esc(c.name_en) + "</div>" : "") + '</div><span class="sec-ic">' + S.icon(c.icon, "ic") + "</span></div>" +
        items.map(function (it) {
          var desc = it["description_" + lang] || "";
          return '<article class="card"><div>' + (it.tag ? '<div class="tag">' + S.glyph("diamond", "ic") + esc(tx(it.tag)) + "</div>" : "") +
            "<h3>" + esc(nm(it)) + "</h3>" + (lang !== "en" ? '<div class="alt" dir="ltr">' + esc(it.name_en) + "</div>" : "") +
            (desc ? '<div class="desc">' + esc(desc) + "</div>" : "") + '</div><span class="price">' + esc(S.formatPrice(it.price, cur)) + "</span></article>";
        }).join("") + "</section>";
    }).join("");
    return (q ? '<div class="count">' + esc(resultsText(total)) + "</div>" : "") +
      (sections || '<div class="empty"><h3>' + esc(tx("noResultsTitle")) + "</h3><p>" + esc(tx("noResultsBody")) + '</p><button type="button" class="btn" data-reset>' + esc(tx("showAll")) + "</button></div>");
  }

  root.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.lang) {
      lang = b.dataset.lang;
      try { localStorage.setItem("sbd_lang", lang); } catch (err) { /* no storage */ }
      render();
    } else if (b.dataset.filter) {
      filter = b.dataset.filter;
      render();
      var chip = root.querySelector('[data-filter="' + CSS.escape(filter) + '"]');
      if (chip) chip.scrollIntoView({ inline: "center", block: "nearest" });
    } else if (b.hasAttribute("data-reset")) {
      filter = "all"; query = ""; render();
    } else if (b.hasAttribute("data-top")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  root.addEventListener("input", function (e) {
    if (e.target.id !== "q") return;
    query = e.target.value;
    document.getElementById("results").innerHTML = resultsHtml();
  });

  if (embed) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== "sbd-preview") return;
      data = e.data.data;
      if (e.data.lang) lang = e.data.lang;
      if (filter !== "all" && !data.categories.some(function (c) { return c.id === filter; })) filter = "all";
      render();
    });
  }
  fetch("/api/menu").then(function (r) { return r.json(); }).then(function (d) {
    if (!data) { data = d; render(); }
  }).catch(function () {
    // in the admin preview a draft may already be shown; don't replace it with an error
    if (!data) root.innerHTML = '<p class="loading">Could not load the menu.</p>';
  });
})();
