/* Steak by Dabbah — admin panel logic. */
(function () {
  "use strict";

  var S = window.SBD;
  var I = window.SBD_I18N;
  var LANGS = S.LANGS;

  // ------------------------------------------------------------------ state
  var state = {
    uiLang: readPref("sbd_admin_lang", "en"),
    data: null,
    savedJSON: null,
    revision: null,
    undo: [],
    redo: [],
    view: "dashboard",
    catIndex: 0,
    query: "",
    saving: false,
    previewLang: null,
    backups: null,
    backupsError: false,
    textFilter: ""
  };
  if (LANGS.indexOf(state.uiLang) === -1) state.uiLang = "en";
  state.previewLang = state.uiLang;

  var el = {
    auth: byId("auth"), app: byId("app"), main: byId("main"), nav: byId("sidenav"),
    modalRoot: byId("modal-root"), toasts: byId("toasts")
  };

  function byId(id) { return document.getElementById(id); }
  function t(key, params) { return I.t(state.uiLang, key, params); }
  function esc(v) { return S.esc(v); }
  function g(name, cls) { return S.glyph(name, cls); }
  function readPref(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function writePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function removePref(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
  function locale() { return { ar: "ar-u-nu-latn", he: "he-IL", en: "en-GB" }[state.uiLang]; }

  function canon(d) { return JSON.stringify(S.normalize(d)); }
  function isDirty() { return !!state.data && canon(state.data) !== state.savedJSON; }
  function textKeys() { return Object.keys(state.data.texts || {}); }
  function errors() { return S.validate(state.data, textKeys()); }
  function currency() { return (state.data.restaurant && state.data.restaurant.currency) || "₪"; }
  function price(p) { return typeof p === "number" && isFinite(p) ? S.formatPrice(p, currency()) : "—"; }

  function nameOf(o, lang) {
    lang = lang || state.uiLang;
    return (o && (o["name_" + lang] || o.name_en || o.name_ar || o.name_he || o.id)) || "—";
  }
  function langSpan(o, field, lang) {
    var v = o[field + lang];
    if (!v) return "";
    return '<span lang="' + lang + '" dir="' + S.DIR[lang] + '">' + esc(v) + "</span>";
  }
  function otherLangs() { return LANGS.filter(function (l) { return l !== state.uiLang; }); }
  function tagLabel(tag) {
    var e = state.data.texts && state.data.texts[tag];
    return (e && (e[state.uiLang] || e.en)) || tag;
  }

  function ensureDefaults(d) {
    d.categories = Array.isArray(d.categories) ? d.categories : [];
    d.categories.forEach(function (c) {
      if (typeof c.visible !== "boolean") c.visible = true;
      c.items = Array.isArray(c.items) ? c.items : [];
      c.items.forEach(function (it) { if (typeof it.visible !== "boolean") it.visible = true; });
    });
    d.restaurant = d.restaurant || {};
    d.texts = d.texts || {};
    return d;
  }

  // Canonical key order, identical to the website's original data.
  function orderItem(it) {
    var o = { id: it.id, name_ar: it.name_ar, name_en: it.name_en, name_he: it.name_he };
    if (it.description_ar || it.description_en || it.description_he) {
      o.description_ar = it.description_ar || "";
      o.description_en = it.description_en || "";
      o.description_he = it.description_he || "";
    }
    o.price = it.price;
    if (it.tag) o.tag = it.tag;
    o.visible = it.visible !== false;
    return o;
  }
  function orderCat(c) {
    return { id: c.id, name_ar: c.name_ar, name_en: c.name_en, name_he: c.name_he, icon: c.icon, visible: c.visible !== false, items: c.items || [] };
  }

  // ------------------------------------------------------------------ API
  function api(method, url, body) {
    var opts = { method: method, credentials: "same-origin", headers: { "X-SBD-Admin": "1" } };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) {
          var err = new Error(json.error || res.statusText);
          err.status = res.status;
          err.body = json;
          throw err;
        }
        return json;
      });
    }, function () {
      var err = new Error(t("networkError"));
      err.network = true;
      throw err;
    });
  }

  // ------------------------------------------------------------------ language
  function applyUiLang() {
    var html = document.documentElement;
    html.lang = state.uiLang;
    html.dir = S.DIR[state.uiLang];
    document.title = "Steak by Dabbah — " + t("appTitle");
    byId("brand-sub").textContent = t("brandSub");
    byId("ui-lang").value = state.uiLang;
    byId("ui-lang").setAttribute("aria-label", t("interfaceLang"));
    byId("ui-lang-label").textContent = t("interfaceLang");
    var undo = byId("btn-undo"), redo = byId("btn-redo"), out = byId("btn-logout");
    undo.innerHTML = g("undo", "ic flip-rtl"); undo.title = t("undo") + " (Ctrl+Z)"; undo.setAttribute("aria-label", t("undo"));
    redo.innerHTML = g("redo", "ic flip-rtl"); redo.title = t("redo") + " (Ctrl+Shift+Z)"; redo.setAttribute("aria-label", t("redo"));
    out.innerHTML = g("logout", "ic flip-rtl"); out.title = t("logout"); out.setAttribute("aria-label", t("logout"));
    byId("btn-discard").textContent = t("discard");
    renderAuthLangs();
  }

  function setUiLang(lang) {
    if (LANGS.indexOf(lang) === -1) return;
    state.uiLang = lang;
    writePref("sbd_admin_lang", lang);
    applyUiLang();
    if (!el.auth.hidden) renderAuthTexts();
    if (state.data) { renderNav(); renderView(); updateChrome(); }
  }

  // ------------------------------------------------------------------ auth
  var authMode = "login";
  var afterAuth = null;

  function renderAuthLangs() {
    var box = byId("auth-langs");
    box.innerHTML = LANGS.map(function (l) {
      return '<button type="button" data-lang="' + l + '" aria-pressed="' + (l === state.uiLang) + '" lang="' + l + '">' + S.LANG_LABEL[l] + "</button>";
    }).join("");
  }
  byId("auth-langs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-lang]");
    if (b) setUiLang(b.dataset.lang);
  });

  function renderAuthTexts() {
    var setup = authMode === "setup";
    byId("auth-title").textContent = setup ? t("setupTitle") : t("loginTitle");
    byId("auth-sub").textContent = setup ? t("setupSub") : authMode === "relogin" ? t("sessionExpired") : t("loginSub");
    byId("auth-pw-label").textContent = t("password");
    byId("auth-pw2-label").textContent = t("confirmPassword");
    byId("auth-pw2-wrap").hidden = !setup;
    byId("auth-pw").autocomplete = setup ? "new-password" : "current-password";
    byId("auth-submit").textContent = setup ? t("createPassword") : t("signIn");
  }

  function showAuth(mode, then) {
    authMode = mode;
    afterAuth = then || null;
    el.app.hidden = true;
    el.auth.hidden = false;
    byId("auth-error").hidden = true;
    byId("auth-pw").value = "";
    byId("auth-pw2").value = "";
    renderAuthTexts();
    setTimeout(function () { byId("auth-pw").focus(); }, 30);
  }

  byId("auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = byId("auth-pw").value;
    var errBox = byId("auth-error");
    var btn = byId("auth-submit");
    function fail(msg) { errBox.textContent = msg; errBox.hidden = false; btn.disabled = false; }
    errBox.hidden = true;
    if (authMode === "setup") {
      if (pw.length < 8) return fail(t("pwShort"));
      if (pw !== byId("auth-pw2").value) return fail(t("pwMismatch"));
    } else if (!pw) {
      return fail(t("wrongPassword"));
    }
    btn.disabled = true;
    api("POST", authMode === "setup" ? "/api/admin/setup" : "/api/admin/login", { password: pw }).then(function () {
      btn.disabled = false;
      el.auth.hidden = true;
      if (afterAuth) {
        el.app.hidden = false;
        var fn = afterAuth;
        afterAuth = null;
        fn();
      } else if (authMode === "relogin" && state.data) {
        el.app.hidden = false; // keep the unsaved edits that are still in memory
      } else {
        loadMenu();
      }
    }).catch(function (err) {
      if (err.status === 429) fail(t("tooManyAttempts"));
      else if (err.status === 401) fail(t("wrongPassword"));
      else if (err.network) fail(t("networkError"));
      else fail(err.message);
    });
  });

  // ------------------------------------------------------------------ boot
  function boot() {
    applyUiLang();
    api("GET", "/api/admin/status").then(function (st) {
      if (st.setupRequired) showAuth("setup");
      else if (!st.authenticated) showAuth("login");
      else loadMenu();
    }).catch(function () {
      showAuth("login");
      var box = byId("auth-error");
      box.textContent = t("networkError");
      box.hidden = false;
    });
  }

  function loadMenu() {
    return api("GET", "/api/admin/menu").then(function (res) {
      setLoaded(res.data, res.revision);
      el.auth.hidden = true;
      el.app.hidden = false;
      route();
      offerDraft();
    }).catch(function (err) {
      if (err.status === 401) showAuth("login");
      else toast(err.message, { type: "error" });
    });
  }

  function setLoaded(data, revision) {
    state.data = ensureDefaults(data);
    state.savedJSON = canon(state.data);
    state.revision = revision;
    state.undo = [];
    state.redo = [];
    clampCat();
    updateChrome();
  }

  // ------------------------------------------------------------------ drafts (protect against closed tabs)
  var draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      if (isDirty()) writePref("sbd_admin_draft", JSON.stringify({ at: Date.now(), revision: state.revision, data: state.data }));
      else removePref("sbd_admin_draft");
    }, 400);
  }
  function offerDraft() {
    var raw = readPref("sbd_admin_draft", null);
    if (!raw) return;
    var draft;
    try { draft = JSON.parse(raw); } catch (e) { removePref("sbd_admin_draft"); return; }
    if (!draft || !draft.data || !Array.isArray(draft.data.categories) || canon(ensureDefaults(draft.data)) === state.savedJSON) {
      removePref("sbd_admin_draft");
      return;
    }
    var when = new Date(draft.at).toLocaleString(locale());
    toast(t("draftFound", { time: when }), {
      timeout: 0,
      action: { label: t("restoreDraft"), fn: function () { commit(function (d) { d.restaurant = draft.data.restaurant; d.texts = draft.data.texts; d.categories = ensureDefaults(draft.data).categories; }); } },
      secondary: { label: t("ignore"), fn: function () { removePref("sbd_admin_draft"); } }
    });
  }

  // ------------------------------------------------------------------ changes & history
  function commit(fn, opts) {
    opts = opts || {};
    var before = JSON.stringify(state.data);
    fn(state.data);
    if (JSON.stringify(state.data) === before) return false;
    state.undo.push(before);
    if (state.undo.length > 150) state.undo.shift();
    state.redo = [];
    afterChange(opts.render !== false);
    if (opts.toast) toast(opts.toast, { action: { label: t("undo"), fn: undo } });
    return true;
  }
  function afterChange(render) {
    clampCat();
    updateChrome();
    scheduleDraft();
    pushPreview();
    if (render) { renderView(); renderNav(); }
  }
  function undo() {
    if (!state.undo.length) return toast(t("nothingToUndo"));
    state.redo.push(JSON.stringify(state.data));
    state.data = JSON.parse(state.undo.pop());
    afterChange(true);
    toast(t("undone"));
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.data));
    state.data = JSON.parse(state.redo.pop());
    afterChange(true);
    toast(t("redone"));
  }
  function clampCat() {
    var n = state.data ? state.data.categories.length : 0;
    if (state.catIndex >= n) state.catIndex = Math.max(0, n - 1);
  }

  // fine-grained edits typed into inline forms (restaurant / texts)
  var fieldSnapshot = null;
  function beginFieldEdit() { fieldSnapshot = JSON.stringify(state.data); }
  function endFieldEdit() {
    if (fieldSnapshot && fieldSnapshot !== JSON.stringify(state.data)) {
      state.undo.push(fieldSnapshot);
      state.redo = [];
      updateChrome();
    }
    fieldSnapshot = JSON.stringify(state.data);
  }

  function updateChrome() {
    if (!state.data) return;
    var dirty = isDirty();
    var pill = byId("save-status");
    pill.className = "status-pill" + (state.saving ? " saving" : dirty ? " dirty" : "");
    pill.textContent = state.saving ? t("saving") : dirty ? t("unsaved") : t("saved");
    var save = byId("btn-save");
    save.innerHTML = g("save", "ic") + "<span>" + esc(state.saving ? t("saving") : t("save")) + "</span>";
    save.disabled = !dirty || state.saving;
    byId("btn-discard").hidden = !dirty || state.saving;
    byId("btn-undo").disabled = !state.undo.length;
    byId("btn-redo").disabled = !state.redo.length;
  }

  // ------------------------------------------------------------------ save
  function save(force) {
    if (state.saving || !state.data) return;
    if (!isDirty() && !force) return;
    if (topModal()) return;
    var errs = errors();
    if (errs.length) return showProblems(errs);
    state.saving = true;
    updateChrome();
    var sent = S.normalize(state.data);
    var sentJSON = JSON.stringify(sent);
    api("PUT", "/api/admin/menu", { data: sent, revision: state.revision, force: !!force }).then(function (res) {
      state.saving = false;
      state.revision = res.revision;
      state.backups = null;
      var saved = ensureDefaults(res.data);
      state.savedJSON = canon(saved);
      // Only adopt the server copy if nothing was edited while the request was in flight.
      if (canon(state.data) === sentJSON) {
        state.data = saved;
        removePref("sbd_admin_draft");
      } else {
        scheduleDraft();
      }
      updateChrome();
      renderView();
      renderNav();
      toast(t("savedToast"), { icon: "check" });
    }).catch(function (err) {
      state.saving = false;
      updateChrome();
      if (err.status === 401) {
        showAuth("relogin", function () { save(force); });
      } else if (err.status === 409) {
        conflictDialog();
      } else if (err.status === 400 && err.body && err.body.details) {
        openModal({
          title: t("saveFailed"), size: "sm",
          body: '<ul class="issue-list">' + err.body.details.map(function (d) { return "<li><button type=\"button\" disabled>" + g("warn", "ic-sm") + "<span dir=\"ltr\">" + esc(d) + "</span></button></li>"; }).join("") + "</ul>",
          foot: [{ label: t("close"), primary: true }]
        });
      } else {
        toast(t("saveFailed") + " " + err.message, { type: "error" });
      }
    });
  }

  function conflictDialog() {
    openModal({
      title: t("conflictTitle"), size: "sm",
      body: "<p>" + esc(t("conflictBody")) + "</p>",
      foot: [
        { label: t("cancel") },
        { label: t("loadTheirs"), fn: function () { loadMenu(); } },
        { label: t("overwrite"), primary: true, fn: function () { setTimeout(function () { save(true); }, 0); } }
      ]
    });
  }

  function discard() {
    confirmDialog({ title: t("discardTitle"), body: t("discardBody"), confirm: t("discard"), danger: true }).then(function (ok) {
      if (!ok) return;
      var before = JSON.stringify(state.data);
      state.data = ensureDefaults(JSON.parse(state.savedJSON));
      state.undo.push(before);
      state.redo = [];
      afterChange(true);
    });
  }

  // ------------------------------------------------------------------ problems
  function describe(e) {
    var p = e.path, where = "", field = "", cat, item;
    if (p[0] === "restaurant") {
      where = t("navRestaurant");
      field = t("f_" + p[1]);
    } else if (p[0] === "text") {
      where = t("navTexts");
      field = I.textLabel(state.uiLang, p[1]) + " · " + S.LANG_LABEL[p[2]];
    } else if (p[0] === "category") {
      cat = findCatById(p[1]);
      where = t("category") + ": " + (cat ? nameOf(cat.cat) : p[1] || "?");
      field = fieldLabel(p[2], "category");
    } else if (p[0] === "item") {
      item = findItem(p[1], p[3]);
      where = item ? nameOf(item.cat) + " › " + nameOf(item.item) : (p[1] || "?");
      field = fieldLabel(p[2]);
    }
    return { where: where, field: field, msg: t("e_" + e.code) };
  }
  function fieldLabel(f, kind) {
    if (!f) return "";
    var m = /^(name|description)_(ar|he|en)$/.exec(f);
    if (m) return (m[1] === "name" ? t(kind === "category" ? "categoryName" : "dishName") : t("description")) + " · " + S.LANG_LABEL[m[2]];
    return { id: t("idLabel"), price: t("price"), tag: t("tag"), icon: t("icon") }[f] || f;
  }
  function findCatById(id) {
    var i = state.data.categories.findIndex(function (c) { return c.id === id; });
    return i === -1 ? null : { cat: state.data.categories[i], ci: i };
  }
  function findItem(id, catId) {
    var cats = state.data.categories;
    for (var ci = 0; ci < cats.length; ci++) {
      if (catId !== undefined && cats[ci].id !== catId) continue;
      for (var ii = 0; ii < cats[ci].items.length; ii++) {
        if (cats[ci].items[ii].id === id) return { cat: cats[ci], item: cats[ci].items[ii], ci: ci, ii: ii };
      }
    }
    return null;
  }
  // Dialogs remember what they act on by identity (object, then id) instead of list position,
  // because the data can change while they are open (e.g. "Undo" clicked in a toast).
  function itemRef(ci, ii) {
    var c = state.data.categories[ci], it = c.items[ii];
    return { obj: it, id: it.id, catId: c.id };
  }
  function locateItem(ref) {
    var cats = state.data.categories;
    for (var ci = 0; ci < cats.length; ci++) {
      var ii = cats[ci].items.indexOf(ref.obj);
      if (ii !== -1) return { ci: ci, ii: ii };
    }
    var f = findItem(ref.id, ref.catId) || findItem(ref.id);
    return f ? { ci: f.ci, ii: f.ii } : null;
  }
  function catRef(ci) { var c = state.data.categories[ci]; return { obj: c, id: c.id }; }
  function locateCat(ref) {
    var i = state.data.categories.indexOf(ref.obj);
    if (i !== -1) return i;
    var f = findCatById(ref.id);
    return f ? f.ci : -1;
  }
  function gone() { toast(t("changedMeanwhile"), { type: "error" }); }

  function issueListHtml(errs, limit) {
    return '<ul class="issue-list">' + errs.slice(0, limit || 200).map(function (e, i) {
      var d = describe(e);
      return '<li><button type="button" data-action="goto-issue" data-i="' + i + '">' + g("warn", "ic-sm") +
        "<span><strong>" + esc(d.where) + "</strong>" + (d.field ? " — " + esc(d.field) : "") + "<br><span class=\"muted\">" + esc(d.msg) + "</span></span></button></li>";
    }).join("") + "</ul>";
  }
  function showProblems(errs) {
    var m = openModal({
      title: t("fixBeforeSave", { n: errs.length }), size: "sm",
      body: issueListHtml(errs),
      foot: [{ label: t("close"), primary: true }]
    });
    m.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-action='goto-issue']");
      if (!b) return;
      m.close();
      goToIssue(errs[+b.dataset.i]);
    });
  }
  function goToIssue(e) {
    var p = e.path;
    if (p[0] === "restaurant" || p[0] === "text") {
      navigate(p[0] === "restaurant" ? "restaurant" : "texts");
      state.textFilter = "";
      renderView();
      var sel = p[0] === "restaurant" ? "restaurant." + p[1] : "text." + p[1] + "." + p[2];
      var input = el.main.querySelector('[data-path="' + sel + '"]');
      if (input) { input.scrollIntoView({ block: "center" }); input.focus(); }
    } else if (p[0] === "category") {
      var c = findCatById(p[1]);
      if (!c) return;
      selectCat(c.ci);
      openCategoryModal(c.ci, true);
    } else if (p[0] === "item") {
      var f = findItem(p[1], p[3]);
      if (!f) return;
      selectCat(f.ci);
      openItemModal(f.ci, f.ii, true);
    }
  }

  // ------------------------------------------------------------------ routing
  var VIEWS = ["dashboard", "menu", "restaurant", "texts", "preview", "backups", "security"];
  var NAV = [
    ["dashboard", "dashboard", "navDashboard"], ["menu", "menu", "navMenu"], ["restaurant", "store", "navRestaurant"],
    ["texts", "text", "navTexts"], ["preview", "eye", "navPreview"], ["backups", "history", "navBackups"], ["security", "lock", "navSecurity"]
  ];
  var lastHash = location.hash;
  function navigate(view) {
    if (location.hash !== "#/" + view) history.pushState(null, "", "#/" + view);
    lastHash = location.hash;
    state.view = view;
    renderNav();
  }
  function editedModal() {
    return modals.find(function (m) { return m.opts.guard && m.opts.guard(); }) || null;
  }
  function route() {
    if (!state.data) return;
    var edited = editedModal();
    if (edited) {
      // e.g. the phone's back gesture while a dish form has changes: stay, and ask first
      history.pushState(null, "", lastHash);
      edited.close();
      return;
    }
    lastHash = location.hash;
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    state.view = VIEWS.indexOf(parts[0]) !== -1 ? parts[0] : "dashboard";
    if (state.view === "menu" && parts[1]) {
      var c = findCatById(decodeURIComponent(parts[1]));
      if (c) state.catIndex = c.ci;
    }
    closeAllModals();
    renderNav();
    renderView();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function selectCat(ci) {
    state.catIndex = ci;
    state.query = "";
    var cat = state.data.categories[ci];
    var hash = "#/menu/" + encodeURIComponent(cat ? cat.id : "");
    if (location.hash !== hash) history.replaceState(null, "", hash);
    lastHash = location.hash;
    if (state.view !== "menu") { state.view = "menu"; renderNav(); }
    renderView();
  }

  function renderNav() {
    var probs = state.data ? errors().length : 0;
    el.nav.innerHTML = NAV.map(function (n) {
      var badge = n[0] === "dashboard" && probs ? '<span class="badge count">' + probs + "</span>" : "";
      var href = n[0] === "menu" && state.data.categories[state.catIndex] ? "#/menu/" + encodeURIComponent(state.data.categories[state.catIndex].id) : "#/" + n[0];
      return '<a class="nav-link" href="' + href + '"' + (state.view === n[0] ? ' aria-current="page"' : "") + ">" + g(n[1]) + "<span>" + esc(t(n[2])) + "</span>" + badge + "</a>";
    }).join("");
  }

  function renderView() {
    if (!state.data) return;
    // keep focus & caret across re-renders
    var active = document.activeElement, key = null, selS = null, selE = null;
    if (active && el.main.contains(active)) {
      key = active.getAttribute("data-path") || active.id || null;
      try { selS = active.selectionStart; selE = active.selectionEnd; } catch (e) { /* not a text input */ }
    }
    var fn = { dashboard: viewDashboard, menu: viewMenu, restaurant: viewRestaurant, texts: viewTexts, preview: viewPreview, backups: viewBackups, security: viewSecurity }[state.view];
    el.main.innerHTML = fn();
    if (state.view === "restaurant" || state.view === "texts") refreshFieldErrors();
    if (state.view === "preview") mountPreview();
    if (state.view === "backups" && !state.backups && !state.backupsError) loadBackups();
    if (state.view === "menu" && window.innerWidth <= 860) {
      var cur = el.main.querySelector(".cat-row[aria-current=true]"), list = byId("cat-list");
      if (cur && list) {
        var cr = cur.getBoundingClientRect(), lr = list.getBoundingClientRect();
        list.scrollLeft += S.DIR[state.uiLang] === "rtl" ? cr.right - lr.right + 12 : cr.left - lr.left - 12;
      }
    }
    if (key) {
      var again = el.main.querySelector('[data-path="' + cssEsc(key) + '"]') || byId(key);
      if (again && el.main.contains(again)) {
        again.focus({ preventScroll: true });
        try { if (selS != null) again.setSelectionRange(selS, selE); } catch (e) { /* ignore */ }
      }
    }
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

  // ------------------------------------------------------------------ views: dashboard
  function viewDashboard() {
    var d = state.data, items = [], hidden = 0;
    d.categories.forEach(function (c) {
      if (c.visible === false) hidden++;
      c.items.forEach(function (it) { items.push({ it: it, c: c }); if (it.visible === false) hidden++; });
    });
    var prices = items.map(function (x) { return x.it.price; }).filter(function (p) { return typeof p === "number" && isFinite(p); });
    var range = prices.length ? price(Math.min.apply(null, prices)) + " – " + price(Math.max.apply(null, prices)) : "—";
    var max = Math.max.apply(null, d.categories.map(function (c) { return c.items.length; }).concat([1]));
    var errs = errors();

    var bars = d.categories.map(function (c, ci) {
      return '<li><a href="#/menu/' + encodeURIComponent(c.id) + '" data-action="select-cat" data-ci="' + ci + '">' + S.icon(c.icon) +
        "<span><span" + (c.visible === false ? ' class="muted"' : "") + ">" + esc(nameOf(c)) + "</span>" +
        (c.visible === false ? ' <span class="badge hidden-badge">' + esc(t("hidden")) + "</span>" : "") +
        '<div class="bar"><i style="width:' + Math.round(c.items.length / max * 100) + '%"></i></div></span><span class="num">' + c.items.length + "</span></a></li>";
    }).join("");

    var hl = S.TAGS.map(function (tag) {
      var list = items.filter(function (x) { return x.it.tag === tag; });
      if (!list.length) return "";
      return '<p class="section-label">' + esc(tagLabel(tag)) + '</p><div class="chips">' + list.map(function (x) {
        var ci = d.categories.indexOf(x.c), ii = x.c.items.indexOf(x.it);
        return '<button type="button" class="chip-link" data-action="edit-item" data-ci="' + ci + '" data-ii="' + ii + '">' + esc(nameOf(x.it)) + ' <span class="price">' + esc(price(x.it.price)) + "</span></button>";
      }).join("") + "</div>";
    }).join("");

    return '<div class="page-head"><div><h1>' + esc(t("dashHello")) + "</h1><p>" + esc(t("dashSub")) + "</p></div></div>" +
      '<div class="stats">' +
      stat(t("statCategories"), d.categories.length) + stat(t("statItems"), items.length) + stat(t("statHidden"), hidden) + stat(t("statPriceRange"), range) +
      "</div>" +
      '<div class="dash-grid"><div>' +
      '<section class="card"><h2>' + g("check", "ic") + esc(t("healthTitle")) + "</h2>" +
      (errs.length ? "<p class=\"muted\">" + esc(t("fixBeforeSave", { n: errs.length })) + "</p>" + issueListHtml(errs, 50) : '<p class="ok-line">' + g("check") + esc(t("healthOk")) + "</p>") +
      "</section>" +
      '<section class="card"><h2>' + g("menu", "ic") + esc(t("byCategory")) + '</h2><ul class="bar-list">' + bars + "</ul></section>" +
      "</div><div>" +
      '<section class="card"><h2>' + g("sparkle", "ic") + esc(t("quickActions")) + '</h2><div class="quick">' +
      '<button type="button" class="btn btn-gold" data-action="add-item">' + g("plus") + esc(t("addItem")) + "</button>" +
      '<button type="button" class="btn" data-action="add-cat">' + g("plus") + esc(t("addCategory")) + "</button>" +
      '<a class="btn" href="#/preview">' + g("eye") + esc(t("navPreview")) + "</a>" +
      '<a class="btn" href="#/backups">' + g("download") + esc(t("navBackups")) + "</a>" +
      "</div></section>" +
      '<section class="card"><h2>' + g("star", "ic") + esc(t("highlights")) + "</h2>" + (hl || '<p class="muted">' + esc(t("noHighlights")) + "</p>") + "</section>" +
      "</div></div>";
  }
  function stat(label, value) { return '<div class="stat"><small>' + esc(label) + "</small><strong>" + esc(value) + "</strong></div>"; }

  // ------------------------------------------------------------------ views: menu
  function viewMenu() {
    var d = state.data;
    var cats = d.categories.map(function (c, ci) {
      var subs = otherLangs().map(function (l) { return c["name_" + l]; }).filter(Boolean).join(" · ");
      var hiddenItems = c.items.filter(function (it) { return it.visible === false; }).length;
      return '<li class="cat-row' + (c.visible === false ? " is-hidden" : "") + '" data-drag-kind="cat" data-ci="' + ci + '" data-action="select-cat"' +
        (ci === state.catIndex && !state.query ? ' aria-current="true"' : "") + ' role="button" tabindex="0">' +
        '<span class="grip" title="' + esc(t("dragToReorder")) + '">' + g("grip") + "</span>" +
        '<span class="cat-ic">' + S.icon(c.icon) + "</span>" +
        '<span style="min-width:0"><span class="cat-name" style="display:block">' + esc(nameOf(c)) + '</span><span class="cat-sub">' + esc(subs) + "</span></span>" +
        '<span class="cat-count">' + (hiddenItems ? '<span title="' + esc(t("hidden")) + '">' + g("eyeOff", "ic-sm") + "</span>" : "") + c.items.length + "</span></li>";
    }).join("");

    return '<div class="page-head"><div><h1>' + esc(t("navMenu")) + "</h1><p>" + esc(t("translateHint")) + '</p></div><div class="actions">' +
      '<button type="button" class="btn btn-gold" data-action="add-item">' + g("plus") + esc(t("addItem")) + "</button></div></div>" +
      '<div class="menu-layout">' +
      '<aside class="card cat-panel"><div class="cat-panel-head"><h2>' + esc(t("categories")) + "</h2></div>" +
      '<ul class="cat-list" id="cat-list">' + cats + "</ul>" +
      '<button type="button" class="btn btn-sm cat-add" data-action="add-cat">' + g("plus", "ic-sm") + esc(t("addCategory")) + "</button></aside>" +
      "<section>" +
      '<div class="toolbar"><div class="search-box">' + g("search") +
      '<input type="search" id="menu-search" placeholder="' + esc(t("searchDishes")) + '" value="' + esc(state.query) + '" autocomplete="off" aria-label="' + esc(t("searchDishes")) + '">' +
      '<button type="button" class="icon-btn sm clear" data-action="clear-search" aria-label="' + esc(t("close")) + '"' + (state.query ? "" : " hidden") + ">" + g("close") + "</button></div></div>" +
      '<div id="menu-content">' + menuContent() + "</div>" +
      "</section></div>";
  }

  function menuContent() {
    var d = state.data;
    if (!d.categories.length) {
      return '<div class="empty">' + S.icon("default", "ic-lg") + "<p>" + esc(t("emptyMenu")) + '</p><button type="button" class="btn btn-gold" data-action="add-cat">' + g("plus") + esc(t("addCategory")) + "</button></div>";
    }
    var badIds = {};
    errors().forEach(function (e) { if (e.path[0] === "item") badIds[e.path[3] + "/" + e.path[1]] = true; });

    if (state.query) {
      var q = normalizeSearch(state.query), hits = [];
      d.categories.forEach(function (c, ci) {
        c.items.forEach(function (it, ii) {
          var hay = normalizeSearch([it.id, it.name_ar, it.name_he, it.name_en, it.description_ar, it.description_he, it.description_en, String(it.price)].join(" "));
          if (hay.indexOf(q) !== -1) hits.push(itemRow(c, ci, it, ii, true, badIds));
        });
      });
      return '<p class="section-label">' + esc(t("searchResults")) + " · " + hits.length + "</p>" +
        (hits.length ? '<ul class="item-list">' + hits.join("") + "</ul>" : '<div class="empty">' + g("search", "ic-lg") + "<p>" + esc(t("noMatches", { q: state.query })) + "</p></div>");
    }

    var ci = state.catIndex, c = d.categories[ci];
    var names = LANGS.filter(function (l) { return l !== state.uiLang; }).map(function (l) { return langSpan(c, "name_", l); }).join("");
    var head = '<div class="card cat-header"><div class="cat-title"><span class="big-ic">' + S.icon(c.icon, "ic-lg") + "</span><div style=\"min-width:0\"><h2>" + esc(nameOf(c)) +
      (c.visible === false ? ' <span class="badge hidden-badge">' + esc(t("hidden")) + "</span>" : "") + '</h2><div class="names-line">' + names +
      '<span class="muted">· ' + esc(t("dishesCount", { n: c.items.length })) + "</span></div></div></div>" +
      '<div class="actions">' + switchHtml(c.visible !== false, "toggle-cat", ci, null) +
      '<button type="button" class="icon-btn" data-action="cat-up" data-ci="' + ci + '" title="' + esc(t("moveUp")) + '" aria-label="' + esc(t("moveUp")) + '"' + (ci === 0 ? " disabled" : "") + ">" + g("up") + "</button>" +
      '<button type="button" class="icon-btn" data-action="cat-down" data-ci="' + ci + '" title="' + esc(t("moveDown")) + '" aria-label="' + esc(t("moveDown")) + '"' + (ci === d.categories.length - 1 ? " disabled" : "") + ">" + g("down") + "</button>" +
      '<button type="button" class="btn btn-sm" data-action="edit-cat" data-ci="' + ci + '">' + g("edit", "ic-sm") + esc(t("editCategory")) + "</button>" +
      '<button type="button" class="icon-btn danger" data-action="delete-cat" data-ci="' + ci + '" title="' + esc(t("deleteCategory")) + '" aria-label="' + esc(t("deleteCategory")) + '">' + g("trash") + "</button>" +
      "</div></div>";
    var list = c.items.length
      ? '<ul class="item-list" id="item-list">' + c.items.map(function (it, ii) { return itemRow(c, ci, it, ii, false, badIds); }).join("") + "</ul>"
      : '<div class="empty">' + S.icon(c.icon, "ic-lg") + "<p>" + esc(t("emptyCategory")) + "</p></div>";
    return head + list + '<p style="margin-top:14px"><button type="button" class="btn" data-action="add-item" data-ci="' + ci + '">' + g("plus") + esc(t("addItem")) + "</button></p>";
  }

  var normalizeSearch = S.searchKey;

  function switchHtml(on, action, ci, ii) {
    var label = on ? t("visibleOnMenu") : t("hiddenFromMenu");
    return '<button type="button" class="switch" role="switch" aria-checked="' + on + '" data-action="' + action + '" data-ci="' + ci + '"' + (ii != null ? ' data-ii="' + ii + '"' : "") +
      ' title="' + esc(label) + '" aria-label="' + esc(t("showOnMenu")) + '"><span class="switch-track"></span></button>';
  }

  function itemRow(c, ci, it, ii, searchMode, badIds) {
    var names = otherLangs().map(function (l) { return langSpan(it, "name_", l); }).join("");
    var desc = it["description_" + state.uiLang] || it.description_en || "";
    var bad = badIds[c.id + "/" + it.id];
    var data = ' data-ci="' + ci + '" data-ii="' + ii + '"';
    var n = c.items.length;
    return '<li class="item-row' + (it.visible === false ? " is-hidden" : "") + (bad ? " has-error" : "") + '"' + (searchMode ? "" : ' data-drag-kind="item"') + data + ">" +
      (searchMode ? "<span></span>" : '<span class="grip" title="' + esc(t("dragToReorder")) + '">' + g("grip") + "</span>") +
      '<div class="item-main" data-action="edit-item"' + data + ' role="button" tabindex="0" aria-label="' + esc(t("editItem") + ": " + nameOf(it)) + '">' +
      '<div class="item-name"><span>' + esc(nameOf(it)) + "</span>" +
      (it.tag ? '<span class="tag-badge">' + g("diamond", "ic") + esc(tagLabel(it.tag)) + "</span>" : "") +
      (it.visible === false ? '<span class="badge hidden-badge">' + g("eyeOff", "ic-sm") + esc(t("hidden")) + "</span>" : "") +
      (bad ? '<span class="badge warn">' + g("warn", "ic-sm") + "</span>" : "") + "</div>" +
      '<div class="item-names">' + names + "</div>" +
      (desc ? '<div class="item-desc">' + esc(desc) + "</div>" : "") +
      (searchMode ? '<div class="item-cat">' + S.icon(c.icon, "ic-sm") + esc(nameOf(c)) + "</div>" : "") +
      "</div>" +
      '<span class="price-pill">' + esc(price(it.price)) + "</span>" +
      '<div class="row-tools">' + switchHtml(it.visible !== false, "toggle-item", ci, ii) +
      (searchMode ? "<span></span>" :
        '<div class="order-btns"><button type="button" class="icon-btn" data-action="item-up"' + data + ' aria-label="' + esc(t("moveUp")) + '" title="' + esc(t("moveUp")) + '"' + (ii === 0 ? " disabled" : "") + ">" + g("up") + "</button>" +
        '<button type="button" class="icon-btn" data-action="item-down"' + data + ' aria-label="' + esc(t("moveDown")) + '" title="' + esc(t("moveDown")) + '"' + (ii === n - 1 ? " disabled" : "") + ">" + g("down") + "</button></div>") +
      '<div class="row-actions">' +
      iconBtn("edit", "edit-item", t("edit"), data) + iconBtn("copy", "dup-item", t("duplicate"), data) +
      iconBtn("move", "move-item", t("move"), data, "flip-rtl") + iconBtn("trash", "delete-item", t("delete"), data, "", true) +
      "</div></div></li>";
  }
  function iconBtn(glyph, action, label, data, cls, danger) {
    return '<button type="button" class="icon-btn sm' + (danger ? " danger" : "") + '" data-action="' + action + '"' + data + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' + g(glyph, "ic " + (cls || "")) + "</button>";
  }

  function refreshMenuContent() {
    var box = byId("menu-content");
    if (!box) return renderView();
    box.innerHTML = menuContent();
    var clear = el.main.querySelector("[data-action='clear-search']");
    if (clear) clear.hidden = !state.query;
    el.main.querySelectorAll(".cat-row").forEach(function (r) {
      if (+r.dataset.ci === state.catIndex && !state.query) r.setAttribute("aria-current", "true");
      else r.removeAttribute("aria-current");
    });
  }

  // ------------------------------------------------------------------ item & category editors
  function langInputs(prefix, obj, opts) {
    return '<div class="lang-grid">' + LANGS.map(function (l) {
      var f = prefix + l, v = obj[f] || "";
      var input = opts.textarea
        ? '<textarea name="' + f + '" rows="2" lang="' + l + '" dir="' + S.DIR[l] + '" maxlength="300">' + esc(v) + "</textarea>"
        : '<input type="text" name="' + f + '" lang="' + l + '" dir="' + S.DIR[l] + '" maxlength="' + opts.max + '" value="' + esc(v) + '" autocomplete="off">';
      return '<label class="field" data-field="' + f + '"><span class="field-label"><span class="lang-chip">' + l.toUpperCase() + "</span>" + esc(S.LANG_LABEL[l]) + "</span>" + input + '<p class="field-error" hidden></p></label>';
    }).join("") + "</div>";
  }

  function allItemIds(exceptCi, exceptIi) {
    var set = new Set();
    state.data.categories.forEach(function (c, ci) {
      c.items.forEach(function (it, ii) { if (!(ci === exceptCi && ii === exceptIi)) set.add(it.id); });
    });
    return set;
  }

  function openItemModal(ci, ii, showErrors) {
    var d = state.data;
    if (!d.categories.length) return openCategoryModal(null);
    var isNew = ii == null;
    var cat = d.categories[ci] || d.categories[0];
    if (!d.categories[ci]) ci = 0;
    var it = isNew ? { id: "", name_ar: "", name_he: "", name_en: "", price: "", visible: true } : S.clone(cat.items[ii]);
    var ref = isNew ? null : itemRef(ci, ii);
    var catRefs = d.categories.map(function (_, i) { return catRef(i); });
    var idTouched = !isNew;
    var tried = !!showErrors;

    var catOptions = d.categories.map(function (c, i) { return '<option value="' + i + '"' + (i === ci ? " selected" : "") + ">" + esc(nameOf(c)) + "</option>"; }).join("");
    var tags = ['<label><input type="radio" name="tag" value=""' + (!it.tag ? " checked" : "") + "><span>" + esc(t("tagNone")) + "</span></label>"]
      .concat(S.TAGS.map(function (tag) { return '<label><input type="radio" name="tag" value="' + tag + '"' + (it.tag === tag ? " checked" : "") + "><span>" + g("diamond", "ic-sm") + esc(tagLabel(tag)) + "</span></label>"; })).join("");

    var body = '<form id="item-form" novalidate>' +
      '<fieldset class="fieldset"><legend>' + esc(t("dishName")) + "</legend>" + langInputs("name_", it, { max: 120 }) + "</fieldset>" +
      '<fieldset class="fieldset"><legend>' + esc(t("description")) + " (" + esc(t("optional")) + ')</legend><p class="fieldset-note">' + esc(t("descHint")) + "</p>" + langInputs("description_", it, { textarea: true }) + "</fieldset>" +
      '<div class="row">' +
      '<label class="field" data-field="price"><span class="field-label">' + esc(t("price")) + '</span><span class="input-affix"><span class="affix">' + esc(currency()) + '</span><input type="text" name="price" inputmode="decimal" class="ltr-input" value="' + esc(it.price) + '" autocomplete="off"></span><p class="field-error" hidden></p></label>' +
      '<label class="field"><span class="field-label">' + esc(t("category")) + '</span><select name="category">' + catOptions + "</select></label>" +
      "</div>" +
      '<div class="field"><span class="field-label">' + esc(t("tag")) + '</span><div class="segmented">' + tags + "</div></div>" +
      '<div class="row">' +
      '<div class="field"><span class="field-label">' + esc(t("showOnMenu")) + '</span><button type="button" class="switch" role="switch" name="visible" aria-checked="' + (it.visible !== false) + '"><span class="switch-track"></span><span class="vis-label">' + esc(it.visible !== false ? t("visibleOnMenu") : t("hiddenFromMenu")) + '</span></button><p class="field-hint">' + esc(t("visibilityHint")) + "</p></div>" +
      '<label class="field" data-field="id"><span class="field-label">' + esc(t("idLabel")) + '</span><input type="text" name="id" class="ltr-input" maxlength="60" value="' + esc(it.id) + '" autocomplete="off" spellcheck="false"><p class="field-hint">' + esc(t("idHint")) + '</p><p class="field-error" hidden></p></label>' +
      "</div></form>";

    var foot = [];
    if (!isNew) foot.push({ label: t("delete"), danger: true, icon: "trash", keepOpen: true, fn: function () { deleteItemRef(ref, m.close); } }, { spacer: true });
    foot.push({ label: t("cancel") }, { label: t("saveItem"), primary: true, keepOpen: true, fn: submit });

    var m = openModal({ title: isNew ? t("newItem") : t("editItem") + " · " + nameOf(it), body: body, foot: foot, guard: function () { return formChanged(); } });
    var form = m.el.querySelector("#item-form");
    var initial = serialize();

    function read() {
      var fd = new FormData(form), o = {};
      LANGS.forEach(function (l) {
        o["name_" + l] = (fd.get("name_" + l) || "").trim();
        o["description_" + l] = (fd.get("description_" + l) || "").trim();
      });
      o.price = S.parseNumber(fd.get("price"));
      o.tag = fd.get("tag") || "";
      o.visible = form.querySelector("[name=visible]").getAttribute("aria-checked") === "true";
      o.id = (fd.get("id") || "").trim();
      o.targetCi = +fd.get("category");
      return o;
    }
    function serialize() { return JSON.stringify(read()); }
    function formChanged() { return serialize() !== initial; }

    function check() {
      var o = read();
      var candidate = orderItem(o);
      var probe = { restaurant: state.data.restaurant, texts: state.data.texts, categories: [{ id: "probe", name_ar: "x", name_he: "x", name_en: "x", icon: "default", items: [candidate] }] };
      var errs = S.validate(probe, []).filter(function (e) { return e.path[0] === "item"; });
      var self = ref && locateItem(ref);
      if (candidate.id && S.SLUG_RE.test(candidate.id) && allItemIds(self ? self.ci : -1, self ? self.ii : -1).has(candidate.id)) {
        errs.push({ path: ["item", candidate.id, "id"], code: "duplicate" });
      }
      form.querySelectorAll("[data-field]").forEach(function (f) {
        var e = errs.find(function (x) { return x.path[2] === f.dataset.field; });
        f.classList.toggle("invalid", !!e && tried);
        var p = f.querySelector(".field-error");
        p.hidden = !(e && tried);
        p.textContent = e ? t("e_" + e.code) : "";
      });
      return { ok: !errs.length, o: o, item: candidate };
    }

    function submit() {
      tried = true;
      var r = check();
      if (!r.ok) {
        var first = form.querySelector(".invalid input, .invalid textarea");
        if (first) first.focus();
        return;
      }
      var target = catRefs[r.o.targetCi] ? locateCat(catRefs[r.o.targetCi]) : -1;
      var loc = isNew ? null : locateItem(ref);
      if (target === -1 || (!isNew && !loc)) { m.close(true); return gone(); }
      commit(function (data) {
        if (isNew) {
          data.categories[target].items.push(r.item);
        } else if (target !== loc.ci) {
          data.categories[loc.ci].items.splice(loc.ii, 1);
          data.categories[target].items.push(r.item);
        } else {
          data.categories[loc.ci].items[loc.ii] = r.item;
        }
      }, { toast: isNew ? t("itemAdded") : t("itemUpdated") });
      m.close(true);
      if (state.view === "menu" && !state.query) {
        if (target !== state.catIndex) selectCat(target);
        flashItem(target, isNew || target !== loc.ci ? state.data.categories[target].items.length - 1 : loc.ii);
      }
    }

    form.addEventListener("input", function (e) {
      if (e.target.name === "id") idTouched = true;
      if (isNew && !idTouched && e.target.name === "name_en") {
        form.querySelector("[name=id]").value = S.uniqueId(S.slugify(e.target.value) || "item", allItemIds(-1, -1));
      }
      check();
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    form.querySelector("[name=visible]").addEventListener("click", function () {
      var on = this.getAttribute("aria-checked") !== "true";
      this.setAttribute("aria-checked", on);
      this.querySelector(".vis-label").textContent = on ? t("visibleOnMenu") : t("hiddenFromMenu");
    });
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submit(); }
    });
    check();
    var focusField = tried ? form.querySelector(".invalid input, .invalid textarea") : null;
    (focusField || form.querySelector("[name=name_" + state.uiLang + "]")).focus();
  }

  function openCategoryModal(ci, showErrors) {
    var d = state.data;
    var isNew = ci == null;
    var c = isNew ? { id: "", name_ar: "", name_he: "", name_en: "", icon: "default", visible: true } : S.clone(d.categories[ci]);
    var ref = isNew ? null : catRef(ci);
    var idTouched = !isNew;
    var tried = !!showErrors;
    var icons = S.ICON_NAMES.map(function (n) {
      return '<label title="' + n + '"><input type="radio" name="icon" value="' + n + '"' + (c.icon === n ? " checked" : "") + ' aria-label="' + n + '"><span>' + S.icon(n) + "</span></label>";
    }).join("");
    var body = '<form id="cat-form" novalidate>' +
      '<fieldset class="fieldset"><legend>' + esc(t("categoryName")) + "</legend>" + langInputs("name_", c, { max: 80 }) + "</fieldset>" +
      '<div class="field" data-field="icon"><span class="field-label">' + esc(t("icon")) + '</span><div class="icon-picker">' + icons + '</div><p class="field-error" hidden></p></div>' +
      '<div class="row">' +
      '<div class="field"><span class="field-label">' + esc(t("showOnMenu")) + '</span><button type="button" class="switch" role="switch" name="visible" aria-checked="' + (c.visible !== false) + '"><span class="switch-track"></span><span class="vis-label">' + esc(c.visible !== false ? t("visibleOnMenu") : t("hiddenFromMenu")) + '</span></button><p class="field-hint">' + esc(t("visibilityHint")) + "</p></div>" +
      '<label class="field" data-field="id"><span class="field-label">' + esc(t("idLabel")) + '</span><input type="text" name="id" class="ltr-input" maxlength="60" value="' + esc(c.id) + '" autocomplete="off" spellcheck="false"><p class="field-hint">' + esc(t("idHint")) + '</p><p class="field-error" hidden></p></label>' +
      "</div></form>";
    var foot = [];
    if (!isNew) foot.push({ label: t("delete"), danger: true, icon: "trash", keepOpen: true, fn: function () { deleteCategoryRef(ref, m.close); } }, { spacer: true });
    foot.push({ label: t("cancel") }, { label: t("saveCategory"), primary: true, keepOpen: true, fn: submit });
    var m = openModal({ title: isNew ? t("newCategory") : t("editCategory") + " · " + nameOf(c), body: body, foot: foot, guard: function () { return serialize() !== initial; } });
    var form = m.el.querySelector("#cat-form");
    var initial = serialize();

    function read() {
      var fd = new FormData(form), o = { id: (fd.get("id") || "").trim(), icon: fd.get("icon") || "default" };
      LANGS.forEach(function (l) { o["name_" + l] = (fd.get("name_" + l) || "").trim(); });
      o.visible = form.querySelector("[name=visible]").getAttribute("aria-checked") === "true";
      return o;
    }
    function serialize() { return JSON.stringify(read()); }
    function otherIds() {
      var self = ref ? locateCat(ref) : -1;
      return new Set(state.data.categories.filter(function (_, i) { return i !== self; }).map(function (x) { return x.id; }));
    }
    function check() {
      var o = read();
      var probe = { restaurant: state.data.restaurant, texts: state.data.texts, categories: [Object.assign({}, o, { items: [] })] };
      var errs = S.validate(probe, []).filter(function (e) { return e.path[0] === "category"; });
      if (o.id && otherIds().has(o.id)) errs.push({ path: ["category", o.id, "id"], code: "duplicate" });
      form.querySelectorAll("[data-field]").forEach(function (f) {
        var e = errs.find(function (x) { return x.path[2] === f.dataset.field; });
        f.classList.toggle("invalid", !!e && tried);
        var p = f.querySelector(".field-error");
        p.hidden = !(e && tried);
        p.textContent = e ? t("e_" + e.code) : "";
      });
      return { ok: !errs.length, o: o };
    }
    function submit() {
      tried = true;
      var r = check();
      if (!r.ok) {
        var first = form.querySelector(".invalid input");
        if (first) first.focus();
        return;
      }
      var target;
      var at = isNew ? -1 : locateCat(ref);
      if (!isNew && at === -1) { m.close(true); return gone(); }
      commit(function (data) {
        if (isNew) {
          data.categories.push(orderCat(Object.assign({}, r.o, { items: [] })));
          target = data.categories.length - 1;
        } else {
          data.categories[at] = orderCat(Object.assign({}, r.o, { items: data.categories[at].items }));
          target = at;
        }
      }, { toast: isNew ? t("categoryAdded") : t("categoryUpdated") });
      m.close(true);
      if (target != null) selectCat(target);
    }
    form.addEventListener("input", function (e) {
      if (e.target.name === "id") idTouched = true;
      if (isNew && !idTouched && e.target.name === "name_en") {
        form.querySelector("[name=id]").value = S.uniqueId(S.slugify(e.target.value) || "category", otherIds());
      }
      check();
    });
    form.addEventListener("change", check);
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    form.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type === "text") { e.preventDefault(); submit(); } });
    form.querySelector("[name=visible]").addEventListener("click", function () {
      var on = this.getAttribute("aria-checked") !== "true";
      this.setAttribute("aria-checked", on);
      this.querySelector(".vis-label").textContent = on ? t("visibleOnMenu") : t("hiddenFromMenu");
    });
    check();
    var focusField = tried ? form.querySelector(".invalid input") : null;
    (focusField || form.querySelector("[name=name_" + state.uiLang + "]")).focus();
  }

  function deleteItemRef(ref, closeParent) {
    confirmDialog({ title: t("deleteItemTitle"), body: t("deleteItemBody", { name: nameOf(ref.obj) }), confirm: t("delete"), danger: true }).then(function (ok) {
      if (!ok) return;
      if (closeParent) closeParent(true);
      var loc = locateItem(ref);
      if (!loc) return gone();
      commit(function (d) { d.categories[loc.ci].items.splice(loc.ii, 1); }, { toast: t("itemDeleted") });
    });
  }
  function deleteCategoryRef(ref, closeParent) {
    confirmDialog({ title: t("deleteCatTitle"), body: t("deleteCatBody", { name: nameOf(ref.obj), n: ref.obj.items.length }), confirm: t("delete"), danger: true }).then(function (ok) {
      if (!ok) return;
      if (closeParent) closeParent(true);
      var ci = locateCat(ref);
      if (ci === -1) return gone();
      commit(function (d) { d.categories.splice(ci, 1); }, { toast: t("categoryDeleted") });
      if (state.catIndex > 0 && state.catIndex >= ci) state.catIndex--;
      selectCat(state.catIndex);
    });
  }
  function duplicateItem(ci, ii) {
    var src = state.data.categories[ci].items[ii];
    var copy = S.clone(src);
    copy.id = S.uniqueId(String(src.id || "item").replace(/-copy(-\d+)?$/, "") + "-copy", allItemIds(-1, -1));
    commit(function (d) { d.categories[ci].items.splice(ii + 1, 0, copy); }, { toast: t("itemDuplicated") });
    flashItem(ci, ii + 1);
  }
  function moveItemDialog(ci, ii) {
    var it = state.data.categories[ci].items[ii];
    var ref = itemRef(ci, ii);
    var catRefs = state.data.categories.map(function (_, i) { return catRef(i); });
    var m = openModal({
      title: t("moveTitle", { name: nameOf(it) }), size: "sm",
      body: '<ul class="choice-list">' + state.data.categories.map(function (c, i) {
        return '<li><button type="button" data-target="' + i + '"' + (i === ci ? " disabled" : "") + ">" + S.icon(c.icon) + "<span>" + esc(nameOf(c)) + "</span></button></li>";
      }).join("") + "</ul>",
      foot: [{ label: t("cancel") }]
    });
    m.el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-target]");
      if (!b) return;
      m.close(true);
      var loc = locateItem(ref), target = locateCat(catRefs[+b.dataset.target]);
      if (!loc || target === -1) return gone();
      moveItem(loc.ci, loc.ii, target);
    });
  }
  function moveItem(ci, ii, target) {
    if (target === ci) return;
    var name = nameOf(state.data.categories[target]);
    commit(function (d) {
      var moved = d.categories[ci].items.splice(ii, 1)[0];
      d.categories[target].items.push(moved);
    }, { toast: t("movedTo", { cat: name }) });
  }
  function reorder(list, from, to) {
    if (from === to || to < 0 || to >= list.length) return;
    var x = list.splice(from, 1)[0];
    list.splice(to, 0, x);
  }
  function flashItem(ci, ii) {
    requestAnimationFrame(function () {
      var row = el.main.querySelector('.item-row[data-ci="' + ci + '"][data-ii="' + ii + '"]');
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.animate([{ boxShadow: "0 0 0 2px #e2bb68" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1400 });
    });
  }

  // ------------------------------------------------------------------ views: restaurant
  var REST_SECTIONS = [
    ["secBasics", [["name", "text"], ["currency", "text"]]],
    ["secContact", [["phone", "tel", "f_phoneHint"], ["phoneDisplay", "text"], ["whatsapp", "url", "f_whatsappHint"]]],
    ["secSocial", [["instagram", "url"], ["facebook", "url"], ["mapsUrl", "url"]]],
    ["secReviews", [["rating", "decimal"], ["reviewCount", "int"], ["reviewsUrl", "url"]]]
  ];
  function viewRestaurant() {
    var r = state.data.restaurant;
    return '<div class="page-head"><div><h1>' + esc(t("restTitle")) + "</h1><p>" + esc(t("restSub")) + "</p></div></div>" +
      '<div class="form-grid">' + REST_SECTIONS.map(function (sec) {
        return '<section class="card"><h2>' + esc(t(sec[0])) + "</h2>" + sec[1].map(function (f) {
          var key = f[0], type = f[1], hint = f[2];
          var val = r[key] == null || (typeof r[key] === "number" && isNaN(r[key])) ? "" : r[key];
          var ltr = type !== "text" || key === "currency";
          var input = '<input type="' + (type === "url" ? "url" : type === "tel" ? "tel" : "text") + '" id="rest-' + key + '" data-path="restaurant.' + key + '" data-type="' + type + '"' +
            (type === "decimal" ? ' inputmode="decimal"' : type === "int" ? ' inputmode="numeric"' : "") + (ltr ? ' class="ltr-input" dir="ltr"' : "") +
            ' value="' + esc(val) + '" autocomplete="off" spellcheck="false">';
          if (type === "url") input = '<span class="link-field">' + input + '<a class="icon-btn" href="' + esc(/^https:\/\//.test(val) ? val : "#") + '" target="_blank" rel="noopener noreferrer" data-link-for="' + key + '" title="' + esc(t("testLink")) + '" aria-label="' + esc(t("testLink")) + '">' + g("external") + "</a></span>";
          return '<label class="field" data-field="restaurant.' + key + '"><span class="field-label">' + esc(t("f_" + key)) + "</span>" + input +
            (hint ? '<p class="field-hint">' + esc(t(hint)) + "</p>" : "") + '<p class="field-error" hidden></p></label>';
        }).join("") + "</section>";
      }).join("") + "</div>";
  }

  // ------------------------------------------------------------------ views: texts
  function viewTexts() {
    return '<div class="page-head"><div><h1>' + esc(t("textsTitle")) + "</h1><p>" + esc(t("textsSub")) + "</p></div></div>" +
      '<div class="toolbar"><div class="search-box">' + g("search") + '<input type="search" id="text-filter" placeholder="' + esc(t("filterTexts")) + '" value="' + esc(state.textFilter) + '" aria-label="' + esc(t("filterTexts")) + '"></div></div>' +
      '<div id="text-groups">' + textGroupsHtml() + "</div>";
  }
  // Rendered separately so typing in the filter never replaces the filter <input> (keeps IME composition intact).
  function textGroupsHtml() {
    var groups = I.TEXT_GROUPS.slice();
    var known = [].concat.apply([], groups.map(function (x) { return x[1]; }));
    var rest = textKeys().filter(function (k) { return known.indexOf(k) === -1; });
    if (rest.length) groups.push(["g_misc", rest]);
    var f = normalizeSearch(state.textFilter);
    var html = groups.map(function (grp) {
      var rows = grp[1].filter(function (k) { return state.data.texts[k]; }).filter(function (k) {
        if (!f) return true;
        var e = state.data.texts[k];
        return normalizeSearch([k, I.textLabel(state.uiLang, k), e.ar, e.he, e.en].join(" ")).indexOf(f) !== -1;
      }).map(function (k) {
        var e = state.data.texts[k];
        var ph = S.PLACEHOLDER_KEYS.indexOf(k) !== -1;
        return '<div class="text-row"><div class="text-key"><strong>' + esc(I.textLabel(state.uiLang, k)) + "</strong><code>" + esc(k) + "</code>" + (ph ? "<em>" + esc(t("placeholderNote")) + "</em>" : "") + "</div>" +
          '<div class="lang-grid">' + LANGS.map(function (l) {
            var path = "text." + k + "." + l;
            var input = k === "noResultsBody"
              ? '<textarea rows="2" data-path="' + path + '" lang="' + l + '" dir="' + S.DIR[l] + '" maxlength="300">' + esc(e[l]) + "</textarea>"
              : '<input type="text" data-path="' + path + '" lang="' + l + '" dir="' + S.DIR[l] + '" maxlength="300" value="' + esc(e[l]) + '" autocomplete="off">';
            return '<label class="field" data-field="' + path + '"><span class="field-label"><span class="lang-chip">' + l.toUpperCase() + "</span>" + esc(S.LANG_LABEL[l]) + "</span>" + input + '<p class="field-error" hidden></p></label>';
          }).join("") + "</div></div>";
      });
      if (!rows.length) return "";
      return '<section class="card text-group"><h2>' + esc(t(grp[0])) + "</h2>" + rows.join("") + "</section>";
    }).join("");
    return html || '<div class="empty">' + g("search", "ic-lg") + "<p>" + esc(t("noMatches", { q: state.textFilter })) + "</p></div>";
  }

  function setByPath(path, raw, type) {
    var p = path.split(".");
    if (p[0] === "restaurant") {
      var v = raw;
      if (type === "decimal") v = S.parseNumber(raw);
      else if (type === "int") v = S.parseNumber(raw, true);
      state.data.restaurant[p[1]] = v;
    } else if (p[0] === "text") {
      state.data.texts[p[1]][p[2]] = raw;
    }
  }

  function refreshFieldErrors() {
    var map = {};
    errors().forEach(function (e) {
      if (e.path[0] === "restaurant") map["restaurant." + e.path[1]] = e.code;
      else if (e.path[0] === "text") map["text." + e.path[1] + "." + e.path[2]] = e.code;
    });
    el.main.querySelectorAll("[data-field]").forEach(function (f) {
      var code = map[f.dataset.field];
      f.classList.toggle("invalid", !!code);
      var p = f.querySelector(".field-error");
      if (p) { p.hidden = !code; p.textContent = code ? t("e_" + code) : ""; }
    });
    el.main.querySelectorAll("[data-link-for]").forEach(function (a) {
      var v = state.data.restaurant[a.dataset.linkFor];
      var ok = typeof v === "string" && /^https:\/\/\S+$/.test(v.trim());
      a.href = ok ? v.trim() : "#";
      a.setAttribute("aria-disabled", String(!ok));
      a.style.opacity = ok ? "" : ".4";
    });
  }

  // ------------------------------------------------------------------ views: preview
  function viewPreview() {
    var langs = LANGS.map(function (l) {
      return '<label><input type="radio" name="preview-lang" value="' + l + '"' + (state.previewLang === l ? " checked" : "") + '><span lang="' + l + '">' + esc(S.LANG_LABEL[l]) + "</span></label>";
    }).join("");
    return '<div class="page-head"><div><h1>' + esc(t("previewTitle")) + "</h1><p>" + esc(t("previewSub")) + "</p></div></div>" +
      '<div class="preview-wrap"><div class="preview-side card"><div class="field"><span class="field-label">' + esc(t("previewLang")) + '</span><div class="segmented" id="preview-langs">' + langs + "</div></div>" +
      '<a class="btn" href="/menu/" target="_blank" rel="noopener">' + g("external") + esc(t("openFull")) + "</a></div>" +
      '<div class="phone"><iframe id="preview-frame" src="/menu/?embed=1" title="' + esc(t("previewTitle")) + '"></iframe></div></div>';
  }
  function mountPreview() {
    var f = byId("preview-frame");
    f.addEventListener("load", pushPreview);
  }
  var previewTimer = null;
  function pushPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var f = byId("preview-frame");
      if (!f || !f.contentWindow) return;
      try {
        f.contentWindow.postMessage({ type: "sbd-preview", lang: state.previewLang, data: S.publicView(S.normalize(state.data)) }, location.origin);
      } catch (e) { /* frame not ready */ }
    }, 120);
  }

  // ------------------------------------------------------------------ views: backups & export
  function viewBackups() {
    var list;
    if (state.backupsError) list = '<p class="form-error">' + esc(t("networkError")) + "</p>";
    else if (!state.backups) list = '<p class="muted">' + esc(t("loading")) + "</p>";
    else if (!state.backups.length) list = '<p class="muted">' + esc(t("noBackups")) + "</p>";
    else list = '<ul class="backup-list">' + state.backups.map(function (b) {
      return '<li><div><div class="when">' + esc(backupTime(b)) + '</div><div class="meta">' +
        (b.corrupt ? "⚠" : esc(t("statCategories")) + ": " + b.categories + " · " + esc(t("statItems")) + ": " + b.items) + "</div></div>" +
        '<div class="actions"><button type="button" class="btn btn-sm btn-ghost" data-action="download-backup" data-name="' + esc(b.name) + '">' + g("download", "ic-sm") + esc(t("download")) + "</button>" +
        '<button type="button" class="btn btn-sm" data-action="restore-backup" data-name="' + esc(b.name) + '"' + (b.corrupt ? " disabled" : "") + ">" + g("history", "ic-sm") + esc(t("restore")) + "</button></div></li>";
    }).join("") + "</ul>";
    var apiUrl = location.origin + "/api/menu";
    return '<div class="page-head"><div><h1>' + esc(t("backupsTitle")) + "</h1><p>" + esc(t("backupsSub")) + "</p></div></div>" +
      '<div class="form-grid"><section class="card"><h2>' + g("history", "ic") + esc(t("navBackups")) + "</h2>" + list + "</section><div>" +
      '<section class="card"><h2>' + g("download", "ic") + esc(t("exportTitle")) + "</h2>" +
      '<div class="export-row"><div><strong>' + esc(t("exportFull")) + "</strong><p>" + esc(t("exportFullHint")) + '</p></div><button type="button" class="btn btn-sm" data-action="export-full">' + g("download", "ic-sm") + esc(t("download")) + "</button></div>" +
      '<div class="export-row"><div><strong>' + esc(t("exportPublic")) + "</strong><p>" + esc(t("exportPublicHint")) + '</p></div><button type="button" class="btn btn-sm" data-action="export-public">' + g("download", "ic-sm") + esc(t("download")) + "</button></div></section>" +
      '<section class="card"><h2>' + g("upload", "ic") + esc(t("importTitle")) + '</h2><p class="muted" style="margin-top:0">' + esc(t("importHint")) + "</p>" +
      '<button type="button" class="btn btn-sm" data-action="import">' + g("upload", "ic-sm") + esc(t("chooseFile")) + '</button><input type="file" id="import-file" accept=".json,application/json" hidden></section>' +
      '<section class="card"><h2>' + g("globe", "ic") + esc(t("apiTitle")) + '</h2><p class="muted" style="margin-top:0">' + esc(t("apiHint")) + '</p><div class="api-url"><code id="api-url">' + esc(apiUrl) + '</code><button type="button" class="btn btn-sm" data-action="copy-api">' + g("copy", "ic-sm") + esc(t("copy")) + "</button></div></section>" +
      "</div></div>";
  }
  function backupTime(b) {
    // `modified` is an epoch timestamp, so it shows correctly whatever timezone the server runs in
    return new Date(b.modified * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
  }
  function loadBackups() {
    api("GET", "/api/admin/backups").then(function (res) {
      state.backups = res.backups;
      state.backupsError = false;
      if (state.view === "backups") renderView();
    }).catch(function (err) {
      if (err.status === 401) return showAuth("relogin", loadBackups);
      state.backupsError = true;
      if (state.view === "backups") renderView();
      state.backupsError = false;
    });
  }
  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  function importFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result).replace(/^﻿/, "")); } catch (e) { return toast(t("importBad"), { type: "error" }); }
      var cats = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.categories) ? parsed.categories : null;
      var okShape = cats && cats.every(function (c) { return c && typeof c === "object" && typeof c.id === "string" && Array.isArray(c.items) && c.items.every(function (it) { return it && typeof it === "object"; }); });
      if (!okShape) return toast(t("importBad"), { type: "error" });
      commit(function (d) {
        d.categories = ensureDefaults({ categories: S.clone(cats) }).categories.map(function (c) {
          var oc = orderCat(c);
          if (!S.ICONS[oc.icon]) oc.icon = "default";
          oc.items = oc.items.map(function (it) { return orderItem(it); });
          return oc;
        });
        if (!Array.isArray(parsed) && parsed.restaurant && typeof parsed.restaurant === "object") d.restaurant = Object.assign({}, d.restaurant, parsed.restaurant);
        if (!Array.isArray(parsed) && parsed.texts && typeof parsed.texts === "object") {
          Object.keys(d.texts).forEach(function (k) { if (parsed.texts[k] && typeof parsed.texts[k] === "object") d.texts[k] = Object.assign({}, d.texts[k], parsed.texts[k]); });
        }
      });
      state.catIndex = 0;
      toast(t("importOk"), { icon: "check", action: { label: t("undo"), fn: undo } });
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------ views: security
  function viewSecurity() {
    return '<div class="page-head"><div><h1>' + esc(t("securityTitle")) + "</h1><p>" + esc(t("securitySub")) + "</p></div></div>" +
      '<form class="card" id="pw-form" style="max-width:460px" novalidate>' +
      '<label class="field"><span class="field-label">' + esc(t("currentPassword")) + '</span><input type="password" name="current" autocomplete="current-password" required></label>' +
      '<label class="field"><span class="field-label">' + esc(t("newPassword")) + '</span><input type="password" name="new" autocomplete="new-password" required minlength="8"><p class="field-hint">' + esc(t("pwShort")) + "</p></label>" +
      '<label class="field"><span class="field-label">' + esc(t("confirmPassword")) + '</span><input type="password" name="confirm" autocomplete="new-password" required></label>' +
      '<p class="form-error" id="pw-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-gold">' + g("lock") + esc(t("changePassword")) + "</button></form>";
  }
  function submitPassword(form) {
    var fd = new FormData(form), err = form.querySelector("#pw-error");
    function fail(m) { err.textContent = m; err.hidden = false; }
    err.hidden = true;
    var cur = fd.get("current") || "", nw = fd.get("new") || "", cf = fd.get("confirm") || "";
    if (!cur) return fail(t("wrongCurrent"));
    if (nw.length < 8) return fail(t("pwShort"));
    if (nw !== cf) return fail(t("pwMismatch"));
    api("POST", "/api/admin/password", { current: cur, "new": nw }).then(function () {
      form.reset();
      toast(t("passwordChanged"), { icon: "check" });
    }).catch(function (e) {
      if (e.status === 401) return showAuth("relogin", function () { navigate("security"); renderView(); });
      fail(e.status === 400 && /current/i.test(e.message) ? t("wrongCurrent") : e.message);
    });
  }

  // ------------------------------------------------------------------ modal system
  var modals = [];
  function topModal() { return modals[modals.length - 1] || null; }
  function openModal(opts) {
    var prevFocus = document.activeElement;
    var back = document.createElement("div");
    back.className = "modal-backdrop";
    var titleId = "m-title-" + Date.now() + Math.floor(Math.random() * 1000);
    var foot = (opts.foot || []).map(function (b, i) {
      if (b.spacer) return '<span class="spacer"></span>';
      var cls = b.primary ? "btn btn-gold" : b.danger ? "btn btn-danger-ghost" : b.dangerSolid ? "btn btn-danger" : "btn btn-ghost";
      return '<button type="button" class="' + cls + '" data-foot="' + i + '">' + (b.icon ? g(b.icon, "ic-sm") : "") + esc(b.label) + "</button>";
    }).join("");
    back.innerHTML = '<div class="modal' + (opts.size === "sm" ? " sm" : "") + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
      '<div class="modal-head"><h2 id="' + titleId + '">' + esc(opts.title) + '</h2><button type="button" class="icon-btn sm" data-close aria-label="' + esc(t("close")) + '">' + g("close") + "</button></div>" +
      '<div class="modal-body">' + (opts.body || "") + "</div>" + (foot ? '<div class="modal-foot">' + foot + "</div>" : "") + "</div>";
    el.modalRoot.appendChild(back);
    var closed = false;
    var m = {
      el: back,
      opts: opts,
      close: function (force) {
        if (closed) return;
        if (!force && opts.guard && opts.guard()) {
          confirmDialog({ title: t("discardTitle"), body: "", confirm: t("discard"), danger: true }).then(function (ok) { if (ok) m.close(true); });
          return;
        }
        closed = true;
        back.remove();
        modals.splice(modals.indexOf(m), 1);
        if (opts.onClose) opts.onClose();
        if (prevFocus && document.body.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
      }
    };
    modals.push(m);
    var downOnBackdrop = false;
    back.addEventListener("mousedown", function (e) { downOnBackdrop = e.target === back; });
    back.addEventListener("click", function (e) {
      if (e.target === back && downOnBackdrop) return m.close();
      if (e.target.closest("[data-close]")) return m.close();
      var fb = e.target.closest("[data-foot]");
      if (fb) {
        var b = opts.foot[+fb.dataset.foot];
        if (b.fn) b.fn();
        if (!b.keepOpen) m.close(true);
      }
    });
    setTimeout(function () {
      if (!back.contains(document.activeElement)) {
        var first = back.querySelector(".modal-body input, .modal-body textarea, .modal-body select, [data-foot]");
        (first || back.querySelector("[data-close]")).focus();
      }
    }, 0);
    return m;
  }
  function closeAllModals() { while (modals.length) modals[modals.length - 1].close(true); }
  function confirmDialog(o) {
    return new Promise(function (resolve) {
      var done = false;
      openModal({
        title: o.title, size: "sm",
        body: o.body ? "<p>" + esc(o.body) + "</p>" : "",
        foot: [
          { label: t("cancel"), fn: function () { done = true; resolve(false); } },
          { label: o.confirm, dangerSolid: o.danger, primary: !o.danger, fn: function () { done = true; resolve(true); } }
        ],
        onClose: function () { if (!done) resolve(false); }
      });
    });
  }

  // ------------------------------------------------------------------ toasts
  function toast(msg, o) {
    o = o || {};
    var n = document.createElement("div");
    n.className = "toast" + (o.type === "error" ? " error" : "");
    n.setAttribute("role", o.type === "error" ? "alert" : "status");
    n.innerHTML = g(o.type === "error" ? "warn" : o.icon || "check") + '<span class="msg">' + esc(msg) + "</span>" +
      (o.secondary ? '<button type="button" class="btn btn-ghost btn-sm" data-t="2">' + esc(o.secondary.label) + "</button>" : "") +
      (o.action ? '<button type="button" class="btn btn-sm" data-t="1">' + esc(o.action.label) + "</button>" : "") +
      '<button type="button" class="icon-btn sm" data-t="0" aria-label="' + esc(t("close")) + '">' + g("close") + "</button>";
    el.toasts.appendChild(n);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    var timer = o.timeout === 0 ? null : setTimeout(function () { n.remove(); }, o.timeout || (o.action ? 6000 : 3500));
    n.addEventListener("click", function (e) {
      var b = e.target.closest("[data-t]");
      if (!b) return;
      clearTimeout(timer);
      n.remove();
      if (b.dataset.t === "1" && o.action) o.action.fn();
      if (b.dataset.t === "2" && o.secondary) o.secondary.fn();
    });
  }

  // ------------------------------------------------------------------ events
  function num(v) { return v == null ? null : +v; }

  el.main.addEventListener("click", function (e) {
    var a = e.target.closest("[data-action]");
    if (!a || !el.main.contains(a)) return;
    var act = a.dataset.action, ci = num(a.dataset.ci), ii = num(a.dataset.ii);
    var d = state.data;
    switch (act) {
      case "select-cat":
        if (e.target.closest(".grip")) return;
        e.preventDefault();
        selectCat(ci);
        break;
      case "add-cat": openCategoryModal(null); break;
      case "edit-cat": openCategoryModal(ci); break;
      case "delete-cat": deleteCategoryRef(catRef(ci)); break;
      case "toggle-cat":
        commit(function (x) { x.categories[ci].visible = x.categories[ci].visible === false; });
        break;
      case "cat-up": case "cat-down":
        var to = ci + (act === "cat-up" ? -1 : 1);
        commit(function (x) { reorder(x.categories, ci, to); });
        selectCat(to);
        break;
      case "add-item":
        openItemModal(ci != null ? ci : state.view === "menu" ? state.catIndex : 0, null);
        break;
      case "edit-item": openItemModal(ci, ii); break;
      case "dup-item": duplicateItem(ci, ii); break;
      case "move-item": moveItemDialog(ci, ii); break;
      case "delete-item": deleteItemRef(itemRef(ci, ii)); break;
      case "toggle-item":
        commit(function (x) { x.categories[ci].items[ii].visible = x.categories[ci].items[ii].visible === false; });
        break;
      case "item-up": case "item-down":
        var target = ii + (act === "item-up" ? -1 : 1);
        commit(function (x) { reorder(x.categories[ci].items, ii, target); });
        var btn = el.main.querySelector('.item-row[data-ii="' + target + '"] [data-action="' + act + '"]');
        if (btn && !btn.disabled) btn.focus(); else flashItem(ci, target);
        break;
      case "clear-search":
        state.query = "";
        var s = byId("menu-search");
        if (s) { s.value = ""; s.focus(); }
        refreshMenuContent();
        break;
      case "goto-issue":
        goToIssue(errors()[+a.dataset.i]);
        break;
      case "export-full":
        download("steak-by-dabbah-menu-full-" + today() + ".json", S.normalize(d));
        break;
      case "export-public":
        download("steak-by-dabbah-menu-" + today() + ".json", S.publicView(S.normalize(d)));
        break;
      case "import":
        byId("import-file").click();
        break;
      case "copy-api":
        var url = byId("api-url").textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast(t("copied")); }, function () {
          var range = document.createRange(); range.selectNodeContents(byId("api-url"));
          var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        });
        break;
      case "download-backup":
        api("GET", "/api/admin/backups/" + encodeURIComponent(a.dataset.name)).then(function (res) { download(a.dataset.name, res.data); })
          .catch(function (err) { toast(err.message, { type: "error" }); });
        break;
      case "restore-backup":
        var b = (state.backups || []).find(function (x) { return x.name === a.dataset.name; });
        confirmDialog({ title: t("restoreTitle"), body: t("restoreBody", { time: b ? backupTime(b) : a.dataset.name }) + (isDirty() ? " " + t("restoreDirty") : ""), confirm: t("restore"), danger: true }).then(function (ok) {
          if (!ok) return;
          api("POST", "/api/admin/backups/restore", { name: a.dataset.name }).then(function (res) {
            setLoaded(res.data, res.revision);
            removePref("sbd_admin_draft");
            state.backups = null;
            renderView(); renderNav();
            toast(t("restored"), { icon: "check" });
          }).catch(function (err) {
            if (err.status === 401) return showAuth("relogin", function () { toast(t("tryAgain")); });
            toast(err.message, { type: "error" });
          });
        });
        break;
    }
  });

  el.main.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-action]")) {
      e.preventDefault();
      e.target.click();
    }
  });

  el.main.addEventListener("focusin", function (e) { if (e.target.dataset.path) beginFieldEdit(); });
  el.main.addEventListener("change", function (e) {
    if (e.target.dataset.path) endFieldEdit();
    if (e.target.id === "import-file" && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ""; }
    if (e.target.name === "preview-lang") { state.previewLang = e.target.value; pushPreview(); }
  });
  el.main.addEventListener("input", function (e) {
    var tg = e.target;
    if (tg.dataset.path) {
      setByPath(tg.dataset.path, tg.value, tg.dataset.type);
      updateChrome();
      refreshFieldErrors();
      scheduleDraft();
      renderNav();
    } else if (tg.id === "menu-search") {
      state.query = tg.value.trim();
      refreshMenuContent();
    } else if (tg.id === "text-filter") {
      state.textFilter = tg.value;
      byId("text-groups").innerHTML = textGroupsHtml();
      refreshFieldErrors();
    }
  });
  el.main.addEventListener("submit", function (e) {
    if (e.target.id === "pw-form") { e.preventDefault(); submitPassword(e.target); }
  });

  // drag & drop reordering (desktop). Buttons cover keyboard & touch.
  var drag = null;
  el.main.addEventListener("pointerdown", function (e) {
    var grip = e.target.closest(".grip");
    if (!grip || state.query) return;
    var row = grip.closest("[data-drag-kind]");
    if (row) row.setAttribute("draggable", "true");
  });
  el.main.addEventListener("dragstart", function (e) {
    var row = e.target.closest && e.target.closest("[data-drag-kind]");
    if (!row || row.getAttribute("draggable") !== "true") return;
    drag = { kind: row.dataset.dragKind, ci: +row.dataset.ci, ii: row.dataset.ii != null ? +row.dataset.ii : null, row: row };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", ""); } catch (err) { /* old browsers */ }
    requestAnimationFrame(function () { row.classList.add("dragging"); });
  });
  function clearDropMarks() {
    el.main.querySelectorAll(".drop-before,.drop-after,.drop-target").forEach(function (x) { x.classList.remove("drop-before", "drop-after", "drop-target"); });
  }
  el.main.addEventListener("dragover", function (e) {
    if (!drag) return;
    var row = e.target.closest("[data-drag-kind], .cat-row");
    if (!row) return;
    clearDropMarks();
    if (drag.kind === "item" && row.classList.contains("cat-row")) {
      if (+row.dataset.ci === drag.ci) return;
      e.preventDefault();
      row.classList.add("drop-target");
      return;
    }
    if (row.dataset.dragKind !== drag.kind || row === drag.row) return;
    if (drag.kind === "item" && +row.dataset.ci !== drag.ci) return;
    e.preventDefault();
    var r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  el.main.addEventListener("drop", function (e) {
    if (!drag) return;
    e.preventDefault();
    var target = el.main.querySelector(".drop-before,.drop-after,.drop-target");
    var d = drag;
    // read the marker before endDrag() clears it
    var after = !!target && target.classList.contains("drop-after");
    endDrag();
    if (!target) return;
    if (d.kind === "item" && target.classList.contains("cat-row")) {
      moveItem(d.ci, d.ii, +target.dataset.ci);
      return;
    }
    var to = +(d.kind === "cat" ? target.dataset.ci : target.dataset.ii) + (after ? 1 : 0);
    var from = d.kind === "cat" ? d.ci : d.ii;
    if (from < to) to--;
    if (d.kind === "cat") {
      var selectedId = state.data.categories[state.catIndex] && state.data.categories[state.catIndex].id;
      var selectedRef = state.data.categories[state.catIndex];
      commit(function (x) { reorder(x.categories, from, to); }, { render: false });
      var ni = state.data.categories.findIndex(function (c) { return c.id === selectedId; });
      state.catIndex = ni !== -1 ? ni : state.data.categories.indexOf(selectedRef);
      if (state.catIndex < 0) state.catIndex = 0;
      renderView(); renderNav();
    } else {
      commit(function (x) { reorder(x.categories[d.ci].items, from, to); });
    }
  });
  function endDrag() {
    if (drag && drag.row) { drag.row.classList.remove("dragging"); drag.row.removeAttribute("draggable"); }
    drag = null;
    clearDropMarks();
  }
  el.main.addEventListener("dragend", endDrag);
  document.addEventListener("pointerup", function () {
    if (!drag) el.main.querySelectorAll("[draggable=true]").forEach(function (r) { r.removeAttribute("draggable"); });
  });

  // top bar
  byId("btn-save").addEventListener("click", function () { save(false); });
  byId("btn-discard").addEventListener("click", discard);
  byId("btn-undo").addEventListener("click", undo);
  byId("btn-redo").addEventListener("click", redo);
  byId("ui-lang").addEventListener("change", function (e) { setUiLang(e.target.value); });
  byId("btn-logout").addEventListener("click", function () {
    var go = function () {
      api("POST", "/api/admin/logout", {}).catch(function () { /* already signed out */ }).then(function () {
        state.data = null;
        removePref("sbd_admin_draft");
        closeAllModals();
        showAuth("login");
      });
    };
    if (isDirty()) confirmDialog({ title: t("leaveWarning"), body: t("discardBody"), confirm: t("logout"), danger: true }).then(function (ok) { if (ok) go(); });
    else go();
  });

  document.addEventListener("keydown", function (e) {
    var mod = e.metaKey || e.ctrlKey;
    var m = topModal();
    if (e.key === "Escape" && m) { e.preventDefault(); m.close(); return; }
    if (e.key === "Tab" && m) {
      var focusables = Array.prototype.filter.call(m.el.querySelectorAll("button:not([disabled]), input:not([type=hidden]):not([hidden]), select, textarea, a[href]"), function (x) { return x.offsetParent !== null; });
      if (focusables.length) {
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (!state.data || el.app.hidden) return;
    // e.code is the physical key, so shortcuts also work with Arabic/Hebrew layouts
    if (mod && e.code === "KeyS") {
      e.preventDefault();
      if (!m) save(false);
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (mod && !typing && !m && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    if (mod && !typing && !m && e.code === "KeyY") { e.preventDefault(); redo(); }
  });

  window.addEventListener("beforeunload", function (e) {
    if (isDirty() || editedModal()) { e.preventDefault(); e.returnValue = t("leaveWarning"); return e.returnValue; }
  });

  boot();
})();
