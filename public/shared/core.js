/* Shared by the admin panel and the menu preview. Plain browser JS, no build step. */
(function (global) {
  "use strict";

  var LANGS = ["ar", "he", "en"];
  var DIR = { ar: "rtl", he: "rtl", en: "ltr" };
  var LANG_LABEL = { ar: "العربية", he: "עברית", en: "English" };
  var TAGS = ["signature", "popular", "sharing"];
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var PHONE_RE = /^\+?[0-9]{6,15}$/;
  var HTTPS_RE = /^https:\/\/\S+$/;
  var PLACEHOLDER_KEYS = ["resultsFew", "resultsMany", "reviewsCount"];

  // Category icons, copied from the live menu site (24x24, stroke based).
  var ICONS = {
    appetizer: '<path d="M4.4 15.4a7.6 3.6 0 0 1 15.2 0z"/><path d="M2.6 15.4h18.8"/><circle cx="9.2" cy="12.4" r="1.7"/><circle cx="14.4" cy="11.6" r="2.1"/>',
    flame: '<path d="M12 2.2c.9 4.1 5.8 5.6 5.8 10.3a5.8 5.8 0 0 1-11.6 0c0-2.3 1.4-3.9 2.8-5.7.5 1.4 1.3 2.1 2.1 2.4-1-2.5-.6-4.9.9-7z"/><path d="M12 13.4c.6 1.3 2.1 1.9 2.1 3.4a2.4 2.4 0 0 1-4.8.1c0-1.1 1.4-1.9 2.7-3.5z"/>',
    pasta: '<path d="M3.2 11.6h17.6a8.8 8.8 0 0 1-17.6 0z"/><path d="M8.4 20.6h7.2"/><path d="M7.4 11.6c0-3.2 2-5.8 4.6-5.8s4.6 2.6 4.6 5.8"/><path d="M10 11.6c0-1.9.9-3.4 2-3.4s2 1.5 2 3.4"/>',
    burger: '<path d="M3.4 9.6c0-3.4 3.9-5.8 8.6-5.8s8.6 2.4 8.6 5.8z"/><path d="M3.4 12.4c1.9 1.6 3.3-1 5.3.6s3.4-1 5.3.6 3.4-1 5.3.6"/><path d="M4.4 16.6h15.2a3.6 3.6 0 0 1-3.6 3.6H8a3.6 3.6 0 0 1-3.6-3.6z"/>',
    fish: '<path d="M2.4 12c2.5-3.6 5.6-5.5 8.9-5.5s6.4 1.9 8.2 5.5c-1.8 3.6-4.9 5.5-8.2 5.5S4.9 15.6 2.4 12z"/><path d="M19.5 12c.7 1.6 1.8 2.9 2.9 3.7-1.5.3-3-.1-4.2-1M19.5 12c.7-1.6 1.8-2.9 2.9-3.7-1.5-.3-3 .1-4.2 1"/><path d="M10.4 6.8c.7 1.6.7 3.4 0 5"/><circle cx="6.9" cy="10.6" r=".95" fill="currentColor" stroke="none"/>',
    kids: '<path d="M8 11.4 12 21l4-9.6z"/><path d="M7.6 11.4a4.4 4.4 0 0 1 1.6-6.8 3.4 3.4 0 0 1 5.6 0 4.4 4.4 0 0 1 1.6 6.8z"/><path d="M9.6 15.2h4.8"/>',
    addons: '<circle cx="12" cy="12" r="8.8"/><circle cx="12" cy="12" r="4.2"/><path d="M12 3.2v4.6M12 16.2v4.6M3.2 12h4.6M16.2 12h4.6"/>',
    drink: '<path d="M6.6 7.6h10.8l-1.2 12.1a1.6 1.6 0 0 1-1.6 1.4H9.4a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M5.2 7.6h13.6"/><path d="m13.4 7.6 2.6-5.1"/><path d="M7.5 12.4h9"/>',
    "default": '<path d="M12 2.8 14.1 9l6.2 2.1-6.2 2.1L12 19.4 9.9 13.2 3.7 11.1 9.9 9z"/>'
  };
  var ICON_NAMES = Object.keys(ICONS);

  // General UI glyphs (same stroke style as the site).
  var GLYPHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l1 12.2a1.8 1.8 0 0 0 1.8 1.6h5.4a1.8 1.8 0 0 0 1.8-1.6l1-12.2"/><path d="M10 11v6M14 11v6"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    up: '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',
    down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.4-.6 4.7-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m15.6 15.6 4.2 4.2"/>',
    close: '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>',
    move: '<path d="M5 12h14"/><path d="m14 7 5 5-5 5"/>',
    undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
    redo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
    dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
    menu: '<path d="M5 6.5h14M5 12h14M5 17.5h9"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 11.5V20h13v-8.5"/><path d="M10 20v-5h4v5"/>',
    text: '<path d="M5 6.5V5h14v1.5"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    phone: '<path d="M7.8 3.5 5.4 4.2a2 2 0 0 0-1.4 2.2c.9 7 6.6 12.7 13.6 13.6a2 2 0 0 0 2.2-1.4l.7-2.4a1.4 1.4 0 0 0-.8-1.7l-3-1.3a1.4 1.4 0 0 0-1.6.4l-1.2 1.5a11 11 0 0 1-5-5l1.5-1.2a1.4 1.4 0 0 0 .4-1.6L9.5 4.3a1.4 1.4 0 0 0-1.7-.8z"/>',
    whatsapp: '<path d="M4.5 19.5 5.6 15.7A8.2 8.2 0 1 1 8.4 18.4z"/><path d="M9.2 8.6c.3-.6.9-.7 1.2-.3l.8 1.5c.1.3 0 .6-.2.8l-.5.5c.5 1.1 1.4 2 2.5 2.5l.5-.5c.2-.2.5-.3.8-.2l1.5.8c.4.3.3.9-.3 1.2-2.6 1.3-7.6-3.7-6.3-6.3z"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    instagram: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="4.6"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor" stroke="none"/>',
    facebook: '<path d="M13.6 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.5-1.5h1.6V4.3a21 21 0 0 0-2.3-.1c-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6V21"/>',
    star: '<path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.9V12l3.4 2.1"/>',
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2"/><path d="M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6C9.8 18.2 8.6 15.2 8.6 12S9.8 5.8 12 3.4z"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v3.8h3.8"/><path d="M12 8v4.2l2.8 1.8"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
    upload: '<path d="M12 15.5v-11"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M5 19.5h14"/>',
    warn: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    arrowUp: '<path d="M12 19.5v-15M5.5 11 12 4.5 18.5 11"/>',
    sparkle: '<path d="M12 2.8 14.1 9l6.2 2.1-6.2 2.1L12 19.4 9.9 13.2 3.7 11.1 9.9 9z"/>',
    diamond: '<path d="M12 3.5 16.5 12 12 20.5 7.5 12z" fill="currentColor" stroke="none"/>'
  };

  function svg(inner, cls) {
    return '<svg class="' + (cls || "ic") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + "</svg>";
  }
  function icon(name, cls) { return svg(ICONS[name] || ICONS["default"], cls); }
  function glyph(name, cls) { return svg(GLYPHS[name] || "", cls); }

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function slugify(s) {
    return String(s || "")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  }

  function uniqueId(base, taken) {
    var id = base || "item";
    if (!taken.has(id)) return id;
    var n = 2;
    while (taken.has(id + "-" + n)) n++;
    return id + "-" + n;
  }

  function formatPrice(price, currency) {
    var n = Number(price);
    var s = Number.isInteger(n) ? String(n) : n.toFixed(2);
    return s + (currency || "₪");
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /**
   * Parses a number typed by a person: accepts Arabic-Indic (٠-٩) and Persian (۰-۹) digits,
   * the Arabic decimal separator (٫) or a comma as decimal point. Returns NaN when invalid.
   * With `integer`, only whole numbers are accepted.
   */
  function parseNumber(raw, integer) {
    var s = String(raw == null ? "" : raw).trim()
      .replace(/[\u0660-\u0669]/g, function (c) { return String(c.charCodeAt(0) - 0x660); })
      .replace(/[\u06f0-\u06f9]/g, function (c) { return String(c.charCodeAt(0) - 0x6f0); })
      .replace(/[\u066b,]/g, ".");
    var re = integer ? /^\d+$/ : /^(\d+(\.\d*)?|\.\d+)$/;
    return re.test(s) ? Number(s) : NaN;
  }

  /** True when `p` has at most 2 decimals (tolerant of float error: 19.99 * 100 = 1998.9999999999998). */
  function hasMax2Decimals(p) { return Math.abs(p * 100 - Math.round(p * 100)) < 1e-6; }

  /** Search normalisation shared by the admin and the preview: case, accents, Arabic/Hebrew marks, quotes. */
  function searchKey(s) {
    return String(s || "").toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0591-\u05c7]/g, "").replace(/[\u2019'\u05f4"\u201d\u201c]/g, "");
  }

  function isStr(v, max) { return typeof v === "string" && v.trim() !== "" && v.length <= max; }

  /**
   * Mirrors server.py `validate` so problems are caught before saving.
   * Returns a list of {path, code, params} where `path` points at the field
   * (e.g. ["item","beef-carpaccio","name_he"]) so the UI can highlight it.
   */
  function validate(data, textKeys) {
    var errs = [];
    function add(path, code, params) { errs.push({ path: path, code: code, params: params || {} }); }
    var r = data.restaurant || {};
    if (!isStr(r.name, 80)) add(["restaurant", "name"], "required");
    if (!(typeof r.phone === "string" && PHONE_RE.test(r.phone))) add(["restaurant", "phone"], "phone");
    if (!isStr(r.phoneDisplay, 30)) add(["restaurant", "phoneDisplay"], "required");
    ["whatsapp", "instagram", "facebook", "mapsUrl", "reviewsUrl"].forEach(function (k) {
      if (!(typeof r[k] === "string" && r[k].length <= 500 && HTTPS_RE.test(r[k].trim()))) add(["restaurant", k], "https");
    });
    if (typeof r.rating !== "number" || !isFinite(r.rating) || r.rating < 0 || r.rating > 5) add(["restaurant", "rating"], "rating");
    if (typeof r.reviewCount !== "number" || !Number.isInteger(r.reviewCount) || r.reviewCount < 0) add(["restaurant", "reviewCount"], "wholeNumber");
    if (!isStr(r.currency, 5)) add(["restaurant", "currency"], "required");

    var t = data.texts || {};
    (textKeys || Object.keys(t)).forEach(function (key) {
      var e = t[key] || {};
      LANGS.forEach(function (l) {
        if (!isStr(e[l], 300)) add(["text", key, l], "required");
        else if (PLACEHOLDER_KEYS.indexOf(key) !== -1 && e[l].indexOf("{n}") === -1) add(["text", key, l], "placeholder");
      });
    });

    var catIds = new Set(), itemIds = new Set();
    (data.categories || []).forEach(function (c) {
      if (!(typeof c.id === "string" && SLUG_RE.test(c.id))) add(["category", c.id, "id"], "slug");
      else if (catIds.has(c.id)) add(["category", c.id, "id"], "duplicate");
      catIds.add(c.id);
      LANGS.forEach(function (l) { if (!isStr(c["name_" + l], 80)) add(["category", c.id, "name_" + l], "required"); });
      if (!ICONS[c.icon]) add(["category", c.id, "icon"], "icon");
      (c.items || []).forEach(function (it) {
        if (!(typeof it.id === "string" && SLUG_RE.test(it.id))) add(["item", it.id, "id", c.id], "slug");
        else if (itemIds.has(it.id)) add(["item", it.id, "id", c.id], "duplicate");
        itemIds.add(it.id);
        LANGS.forEach(function (l) { if (!isStr(it["name_" + l], 120)) add(["item", it.id, "name_" + l, c.id], "required"); });
        var filled = LANGS.filter(function (l) { return typeof it["description_" + l] === "string" && it["description_" + l].trim() !== ""; });
        if (filled.length && filled.length < 3) {
          LANGS.forEach(function (l) { if (filled.indexOf(l) === -1) add(["item", it.id, "description_" + l, c.id], "descAll"); });
        }
        LANGS.forEach(function (l) {
          var d = it["description_" + l];
          if (typeof d === "string" && d.length > 300) add(["item", it.id, "description_" + l, c.id], "tooLong");
        });
        var p = it.price;
        if (typeof p !== "number" || !isFinite(p) || p < 0 || p > 100000) add(["item", it.id, "price", c.id], "price");
        else if (!hasMax2Decimals(p)) add(["item", it.id, "price", c.id], "decimals");
        if (it.tag != null && it.tag !== "" && TAGS.indexOf(it.tag) === -1) add(["item", it.id, "tag", c.id], "tag");
      });
    });
    return errs;
  }

  /** Same clean-up the server performs, so exported files match what is stored. */
  function normalize(data) {
    var d = clone(data);
    (d.categories || []).forEach(function (c) {
      LANGS.forEach(function (l) { if (typeof c["name_" + l] === "string") c["name_" + l] = c["name_" + l].trim(); });
      (c.items || []).forEach(function (it) {
        LANGS.forEach(function (l) {
          ["name_", "description_"].forEach(function (f) {
            if (typeof it[f + l] === "string") it[f + l] = it[f + l].trim();
          });
        });
        if (LANGS.every(function (l) { return !it["description_" + l]; })) LANGS.forEach(function (l) { delete it["description_" + l]; });
        if (!it.tag) delete it.tag;
      });
    });
    Object.keys(d.restaurant || {}).forEach(function (k) {
      if (typeof d.restaurant[k] === "string") d.restaurant[k] = d.restaurant[k].trim();
    });
    Object.keys(d.texts || {}).forEach(function (k) {
      LANGS.forEach(function (l) { if (typeof d.texts[k][l] === "string") d.texts[k][l] = d.texts[k][l].trim(); });
    });
    return d;
  }

  /** Version the public website consumes: hidden things removed, no admin-only fields. */
  function publicView(data) {
    return {
      restaurant: data.restaurant,
      texts: data.texts,
      categories: data.categories.filter(function (c) { return c.visible !== false; }).map(function (c) {
        var out = {};
        Object.keys(c).forEach(function (k) { if (k !== "items" && k !== "visible") out[k] = c[k]; });
        out.items = c.items.filter(function (it) { return it.visible !== false; }).map(function (it) {
          var o = {};
          Object.keys(it).forEach(function (k) { if (k !== "visible") o[k] = it[k]; });
          return o;
        });
        return out;
      }).filter(function (c) { return c.items.length > 0; }) // all dishes hidden → don't show an empty section
    };
  }

  global.SBD = {
    LANGS: LANGS, DIR: DIR, LANG_LABEL: LANG_LABEL, TAGS: TAGS, ICONS: ICONS, ICON_NAMES: ICON_NAMES,
    SLUG_RE: SLUG_RE, PLACEHOLDER_KEYS: PLACEHOLDER_KEYS,
    icon: icon, glyph: glyph, esc: esc, slugify: slugify, uniqueId: uniqueId, formatPrice: formatPrice,
    clone: clone, parseNumber: parseNumber, searchKey: searchKey, validate: validate, normalize: normalize, publicView: publicView
  };
})(window);
