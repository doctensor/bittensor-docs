(function () {
  var HERE = ((document.currentScript || {}).src || "/").replace(/[^\/]*$/, "");
  // sort:begin (pure, no DOM; scripts/sort_check.js extracts and tests this block)
  function sortCmp(k, w) {
    var key = "c" + w;
    function str(f) { return function (a, b) { return a.dataset[f] < b.dataset[f] ? -1 : a.dataset[f] > b.dataset[f] ? 1 : 0; }; }
    function num(f) { return function (a, b) { return +a.dataset[f] - +b.dataset[f]; }; }
    function rev(f) { return function (a, b) { return f(b, a); }; }
    var by = {
      active: rev(num(key)), "active-asc": num(key), recent: rev(str("last")), researched: rev(str("researched")),
      sn: num("sn"), "sn-desc": rev(num("sn")), name: str("name"), "name-desc": rev(str("name"))
    }[k];
    return function (a, b) { return (by ? by(a, b) : 0) || a._i - b._i; };
  }
  // sort:end
  var list = document.getElementById("subnets");
  if (!list) return;
  var cards = Array.prototype.slice.call(list.children);
  cards.forEach(function (c, i) { c._i = i; });
  var q = document.getElementById("q");
  var sortSel = document.getElementById("sort");
  var count = document.getElementById("count");
  var empty = document.getElementById("empty");
  var fbtn = document.getElementById("fbtn"), fpanel = document.getElementById("fpanel");
  var fnum = document.getElementById("fnum"), active = document.getElementById("active");
  var state = { status: "", net: "", win: "30" };
  var UNIT = { "7": "in 7 d", "30": "in 30 d", "90": "in 90 d", "all": "all time" };
  var WIN = { "7": "in the last 7 days", "30": "in the last 30 days", "90": "in the last 90 days", "all": "of all time" };
  var WLBL = { "7": "7 days", "30": "30 days", "90": "90 days", "all": "all time" };
  var sortOpts = Array.prototype.slice.call(sortSel.options);
  function sortWin() { return sortSel.options[sortSel.selectedIndex].hasAttribute("data-win"); }
  function sortName() {
    var o = sortSel.options[sortSel.selectedIndex];
    return o.getAttribute("data-label").toLowerCase() + (sortWin() ? " (" + WLBL[state.win] + ")" : "");
  }
  function sortLabels() {
    sortOpts.forEach(function (o) {
      o.textContent = o.getAttribute("data-label") + (o.hasAttribute("data-win") ? ", " + WLBL[state.win] : "");
    });
  }
  function validSort(v) { return sortOpts.some(function (o) { return o.value === v; }); }
  // Sort choice is remembered (localStorage) and shared (?sort=); the default 'active' leaves the URL clean.
  function saveSort(v) {
    try { localStorage.setItem("sort", v); } catch (e) {}
    try {
      var u = new URLSearchParams(location.search);
      if (v === "active") u.delete("sort"); else u.set("sort", v);
      var qs = u.toString();
      history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    } catch (e) {}
  }
  var sky = document.getElementById("sky"), skCap = document.getElementById("sk-cap"), bars = [], byBar = {}, SKH = 64;
  var skT = skCap && skCap.querySelector(".sk-t");
  function skSay(txt, hov) { if (!skT) return; skT.textContent = txt; skCap.classList.toggle("hov", !!hov); }
  if (sky) {
    bars = Array.prototype.slice.call(sky.querySelectorAll("a.sk"));
    bars.forEach(function (a) { byBar[a.getAttribute("data-sn")] = a; });
    SKH = sky.querySelector("svg").viewBox.baseVal.height || 64;
  }
  var cardBySn = {};
  cards.forEach(function (c) { cardBySn[c.dataset.sn] = c; });
  function skLabel(c) {
    return "SN" + c.dataset.sn + " " + c.querySelector("h3").textContent + ": " + c.dataset["c" + state.win] + " chat msgs " + UNIT[state.win];
  }
  function skCapText() {
    return "Chat messages per subnet " + WIN[state.win] + ", by SN.";
  }
  function skyHeights() {
    if (!sky) return;
    var w = state.win, max = 1;
    bars.forEach(function (a) { max = Math.max(max, +cardBySn[a.getAttribute("data-sn")].dataset["c" + w]); });
    bars.forEach(function (a) {
      var c = cardBySn[a.getAttribute("data-sn")], v = +c.dataset["c" + w];
      var h = v > 0 ? Math.max(3, Math.round(SKH * Math.sqrt(v / max))) : 2, r = a.querySelector(".bar");
      r.setAttribute("height", h);
      r.setAttribute("y", SKH - h);
      a.querySelector("title").textContent = skLabel(c);
    });
    skSay(skCapText(), false);
  }
  function mark(sn) {
    bars.forEach(function (a) { a.classList.toggle("cur", a.getAttribute("data-sn") === sn); });
  }
  function mid(sn) {   // X19: the bar of the gallery's centred cover
    bars.forEach(function (a) { a.classList.toggle("mid", a.getAttribute("data-sn") === sn); });
  }
  // skynav:begin (pure, node-tested by scripts/skynav_check.js; X10 scrubs the gallery along the skyline with it)
  function skySnAt(x, left, width, sns) {
    if (!sns.length || !(width > 0)) return null;
    var i = Math.floor((x - left) / width * sns.length);
    return sns[Math.max(0, Math.min(sns.length - 1, i))];
  }
  // skynav:end
  if (sky) {
    window.__sky = {
      mark: mark,
      mid: mid,
      snAt: function (clientX) {
        var r = sky.querySelector("svg").getBoundingClientRect();
        return skySnAt(clientX, r.left, r.width, bars.map(function (a) { return a.getAttribute("data-sn"); }));
      }
    };
  }
  document.getElementById("controls").hidden = false;
  var bar = document.getElementById("controls");
  function stick() {
    var on = getComputedStyle(bar).position === "sticky" && bar.getBoundingClientRect().top <= 14 && window.scrollY > 0;
    bar.classList.toggle("stuck", on);
  }
  window.addEventListener("scroll", stick, { passive: true });
  window.addEventListener("resize", stick);
  stick();

  function apply() {
    var s = q.value.trim().toLowerCase(), n = 0;
    cards.forEach(function (c) {
      var d = c.dataset;
      var ok = (!s || d.text.indexOf(s) > -1) && (!state.status || d.status === state.status) &&
        (!state.net || d.net === state.net);
      c.hidden = !ok;
      if (byBar[d.sn]) byBar[d.sn].classList.toggle("off", !ok);
      if (ok) n++;
    });
    count.textContent = n + " of " + cards.length + ", " + sortName();
    empty.hidden = n > 0;
    syncFilters();
    if (ui) ui.sync();
  }

  // Filters: Status and Network live in a disclosure panel; what is on shows as removable chips.
  var FNAME = { status: "Status", net: "Network" };
  function chipsOf(g) { return Array.prototype.slice.call(document.querySelectorAll('.chip[data-group="' + g + '"]')); }
  function setChip(g, v) {
    state[g] = v;
    chipsOf(g).forEach(function (o) { o.setAttribute("aria-pressed", o.getAttribute("data-value") === v ? "true" : "false"); });
  }
  function chipLabel(g, v) {
    var b = chipsOf(g).filter(function (o) { return o.getAttribute("data-value") === v; })[0];
    return b ? b.textContent : v;
  }
  function syncFilters() {
    var on = ["status", "net"].filter(function (g) { return state[g]; });
    fnum.textContent = on.length;
    fnum.hidden = !on.length;
    fbtn.setAttribute("aria-label", on.length ? "Filters, " + on.length + " on" : "Filters");
    active.textContent = "";
    on.forEach(function (g) {
      var b = document.createElement("button"), t = FNAME[g] + ": " + chipLabel(g, state[g]), x = document.createElement("span");
      b.type = "button";
      b.className = "fchip";
      b.setAttribute("data-group", g);
      b.setAttribute("aria-label", "Remove filter " + t);
      b.appendChild(document.createTextNode(t));
      x.className = "fx";
      x.setAttribute("aria-hidden", "true");
      x.textContent = "\u00d7";
      b.appendChild(x);
      active.appendChild(b);
    });
    if (on.length || q.value.trim()) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "fclear";
      c.textContent = "Clear filters";
      active.appendChild(c);
    }
    active.hidden = !active.firstChild;
  }

  function sortNow() {
    cards.sort(sortCmp(sortSel.value, state.win));
    cards.forEach(function (c) { list.appendChild(c); });
  }

  function setWindow() {
    var w = state.win;
    cards.forEach(function (c) {
      var d = c.dataset;
      c.querySelector(".meter").className = "meter heat-" + d["h" + w];
      c.querySelector(".cnt").textContent = d["c" + w];
      c.querySelector(".unit").textContent = "chat msgs " + UNIT[w];
    });
    sortLabels();
    if (sortWin()) sortNow();
    apply();
    skyHeights();
  }

  Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (b) {
    b.addEventListener("click", function () {
      var g = b.getAttribute("data-group");
      setChip(g, b.getAttribute("data-value"));
      if (g === "win") setWindow(); else apply();
    });
  });
  q.addEventListener("input", apply);
  sortSel.addEventListener("change", function () { sortNow(); apply(); saveSort(sortSel.value); });
  (function () {
    var want = null;
    try { want = new URLSearchParams(location.search).get("sort"); } catch (e) {}
    if (!validSort(want)) { want = null; try { want = localStorage.getItem("sort"); } catch (e) {} }
    if (validSort(want)) sortSel.value = want;
    sortLabels();
    if (sortSel.value !== "active") sortNow();
    apply();
  })();
  function panelOpen(on) {
    fpanel.hidden = !on;
    fbtn.setAttribute("aria-expanded", on ? "true" : "false");
  }
  fbtn.addEventListener("click", function () { panelOpen(fpanel.hidden); });
  active.addEventListener("click", function (ev) {
    var b = ev.target.closest("button");
    if (!b) return;
    if (b.classList.contains("fchip")) setChip(b.getAttribute("data-group"), "");
    else { setChip("status", ""); setChip("net", ""); q.value = ""; }
    apply();
    fbtn.focus();
  });
  bar.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !fpanel.hidden) { panelOpen(false); fbtn.focus(); }
  });

  // Inline reader: a card click loads that subnet's page into a side panel instead of navigating.
  // The URL hash (#15) is the single source of truth, so back/forward, reload and shared links work.
  // Without JS, or with a modifier key (new tab), a card is still a plain link to its own page.
  var ROOT = location.pathname, page = document.querySelector("main"), baseTitle = document.title;
  var cache = {}, panel = null, rbody, btnPrev, btnNext, btnFull;
  var current = null, opener = null, token = 0, pushed = false, hov = 0;

  function link(c) { return c.querySelector("a.name-link"); }
  function cardFor(sn) {
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.sn === sn && link(cards[i])) return cards[i];
    return null;
  }
  function load(c) {
    var sn = c.dataset.sn;
    if (!cache[sn]) {
      cache[sn] = fetch(link(c).href).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      });
      cache[sn].catch(function () { delete cache[sn]; });
    }
    return cache[sn];
  }
  function near(d) {
    var s = cards.filter(function (c) { return !c.hidden && link(c); }), i = s.indexOf(current);
    if (i < 0) i = d > 0 ? -1 : s.length;
    return s[i + d] || null;
  }
  function updateNav() { btnPrev.disabled = !near(-1); btnNext.disabled = !near(1); }
  function step(d) {
    var n = near(d);
    if (n) { history.replaceState(null, "", "#" + n.dataset.sn); route(); }
  }
  function close() {
    if (pushed && location.hash.length > 1) { pushed = false; history.back(); }
    else { history.replaceState(null, "", location.pathname + location.search); route(); }
  }
  function build() {
    panel = document.createElement("div");
    panel.className = "reader";
    panel.hidden = true;
    panel.innerHTML = '<div class="reader-back"></div>' +
      '<section class="reader-pane" role="dialog" aria-modal="true" aria-label="Subnet details">' +
      '<div class="reader-bar">' +
      '<button type="button" class="rb" data-act="prev">\u2190 Prev</button>' +
      '<button type="button" class="rb" data-act="next">Next \u2192</button>' +
      '<a class="rb rb-full" data-act="full" href="#">Full page</a>' +
      '<button type="button" class="rb" data-act="close">Close \u00d7</button>' +
      '</div><div class="reader-body" tabindex="-1"></div></section>';
    document.body.appendChild(panel);
    rbody = panel.querySelector(".reader-body");
    btnPrev = panel.querySelector('[data-act="prev"]');
    btnNext = panel.querySelector('[data-act="next"]');
    btnFull = panel.querySelector('[data-act="full"]');
    panel.addEventListener("click", function (ev) {
      var t = ev.target, b = t.closest("[data-act]"), a;
      if (t.classList.contains("reader-back")) return close();
      if (b) {
        var act = b.getAttribute("data-act");
        if (act === "close") close();
        else if (act === "prev") step(-1);
        else if (act === "next") step(1);
        return;
      }
      a = t.closest("a");
      if (!a || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || a.origin !== location.origin) return;
      var m = /\/subnets\/(\d+)\.html$/.exec(a.pathname);
      if (a.pathname === ROOT) { ev.preventDefault(); close(); }
      else if (m && cardFor(m[1])) { ev.preventDefault(); history.replaceState(null, "", "#" + m[1]); route(); }
    });
  }
  function show(c) {
    if (!panel) build();
    var mine = ++token, a = link(c);
    current = c;
    mark(c.dataset.sn);
    if (ui) ui.focus(c.dataset.sn);
    btnFull.href = a.href;
    updateNav();
    rbody.className = "reader-body loading";
    rbody.textContent = "Loading SN" + c.dataset.sn + "\u2026";
    panel.hidden = false;
    document.documentElement.classList.add("reading");
    page.inert = true;
    rbody.focus({ preventScroll: true });
    load(c).then(function (t) {
      if (mine !== token) return;
      var doc = new DOMParser().parseFromString(t, "text/html"), m = doc.querySelector("main");
      if (!m) throw new Error("no content");
      var nav = m.querySelector("nav.top");
      if (nav) nav.remove();
      rbody.className = "reader-body";
      rbody.textContent = "";
      while (m.firstChild) rbody.appendChild(m.firstChild);
      document.title = doc.title;
      rbody.scrollTop = 0;
    }).catch(function () {
      if (mine !== token) return;
      var o = document.createElement("a");
      o.href = a.href;
      o.textContent = "Open it on its own page.";
      rbody.className = "reader-body";
      rbody.textContent = "This page could not be loaded here. ";
      rbody.appendChild(o);
    });
  }
  function hide() {
    if (!panel || panel.hidden) return;
    token++;
    pushed = false;
    current = null;
    mark(null);
    panel.hidden = true;
    document.documentElement.classList.remove("reading");
    page.inert = false;
    document.title = baseTitle;
    if (opener) { opener.focus({ preventScroll: true }); opener = null; }
  }
  function route() {
    var m = /^#(\d+)$/.exec(location.hash), c = m && cardFor(m[1]);
    if (!c) return hide();
    if (!panel || panel.hidden || current !== c) show(c);
  }

  list.addEventListener("click", function (ev) {
    var a = ev.target.closest("a.name-link");
    if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    opener = a;
    pushed = true;
    history.pushState(null, "", "#" + a.closest(".card").dataset.sn);
    route();
  });
  list.addEventListener("mouseover", function (ev) {
    var c = ev.target.closest(".card");
    clearTimeout(hov);
    if (c && link(c)) hov = setTimeout(function () { load(c).catch(function () {}); }, 120);
  });
  list.addEventListener("mouseout", function () { clearTimeout(hov); });
  if (sky) {
    sky.addEventListener("click", function (ev) {
      var a = ev.target.closest("a.sk");
      if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      opener = a;
      pushed = true;
      history.pushState(null, "", "#" + a.getAttribute("data-sn"));
      route();
    });
    sky.addEventListener("mouseover", function (ev) {
      var a = ev.target.closest("a.sk"), c = a && cardBySn[a.getAttribute("data-sn")];
      if (c) { skSay(skLabel(c), true); clearTimeout(hov); hov = setTimeout(function () { load(c).catch(function () {}); }, 120); }
    });
    sky.addEventListener("mouseout", function (ev) {
      if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest("a.sk")) { clearTimeout(hov); skSay(skCapText(), false); }
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (!panel || panel.hidden || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "Escape") close();
    else if ((ev.key === "ArrowRight" || ev.key === "ArrowLeft") && (ev.target === rbody || ev.target === document.body)) {
      step(ev.key === "ArrowRight" ? 1 : -1);
    }
  });
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);

  // Flow gallery (X19): the Cover Flow stage sits in the hero, directly above the skyline, and starts by itself once the page has loaded
  // (idle time, so its three files stay out of the first paint). No Grid | Flow toggle and no stored choice; ?view=grid is the one opt-out.
  // No WebGL, a failed start or a lost GPU context = the page without the stage. The skyline marks the centred cover (.mid) and scrubs it.
  var gal = document.getElementById("gal"), ui = null, uiP = null, uiBad = false, gone = false;
  var bridge = {
    cards: function () { return cards.filter(function (c) { return !c.hidden; }); },
    win: function () { return state.win; },
    sky: window.__sky || null,
    open: function (sn, el) { opener = el; pushed = true; history.pushState(null, "", "#" + sn); route(); },
    lost: function (on) {   // X11: the GPU took the WebGL context: the stage goes until it is restored
      gone = on; gal.hidden = on;
      document.documentElement.classList.toggle("flow", !on);
      if (!on && ui) ui.show(true);
    }
  };
  function loadJs(f) {
    return new Promise(function (ok, no) {
      var e = document.createElement("script");
      e.src = HERE + f;
      e.onload = ok;
      e.onerror = no;
      document.head.appendChild(e);
    });
  }
  // X12 snapshot hook: ?still=N draws ONE synchronous frame with cover N in the centre (no animation, covers waited for) and sets
  // window.__flowReady = true; scripts/flow_snapshot.js waits for it. Nothing else reads ?still=.
  function still(t) {
    var m = /[?&]still=(\d+)/.exec(location.search), r = window.__flow && window.__flow.render;
    if (!m || !r || window.__flowReady || t > 200) return;   // 200 tries of 80 ms, then the script's own timeout reports it
    if (r.still(+m[1])) window.setTimeout(still, 80, (t | 0) + 1); else window.__flowReady = true;
  }
  function startFlow() {
    var root = document.documentElement;
    if (uiP || uiBad || gone || !gal || !window.WebGLRenderingContext || /[?&]view=grid(&|$)/.test(location.search)) return;
    gal.hidden = false;   // the stage is put into a visible slot: the canvas needs its size when the renderer is created
    uiP = Promise.all(["covers.js", "flow.js", "flowui.js"].map(loadJs)).then(function () { return window.FlowUI.start(bridge); });
    uiP.then(function (u) {
      if (!u) throw new Error("no webgl");
      ui = u;
      root.classList.add("flow");
      ui.show(true);
      var m = /^#(\d+)$/.exec(location.hash);
      if (m) ui.focus(m[1]);
      still();
    }).catch(function () { uiBad = true; gal.hidden = true; root.classList.remove("flow"); });
  }

  apply();
  route();
  (function () {
    var idle = window.requestIdleCallback || function (f) { window.setTimeout(f, 300); };
    function later() { idle(startFlow, { timeout: 2000 }); }
    // the dark deck is there from the first paint (slot shown, html.flow = the gallery is expected): the stage fills it without moving the page
    if (gal && window.WebGLRenderingContext && !/[?&]view=grid(&|$)/.test(location.search)) { gal.hidden = false; document.documentElement.classList.add("flow"); }
    if (/[?&]still=/.test(location.search)) startFlow();
    else if (document.readyState === "complete") later();
    else window.addEventListener("load", later);
  })();
})();
