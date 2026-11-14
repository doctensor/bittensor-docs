(function () {
  var HERE = ((document.currentScript || {}).src || "/").replace(/[^\/]*$/, "");
  // sort:begin (pure, no DOM; scripts/sort_check.js extracts and tests this block)
  // Rank of each facet value, best first (scripts/sort_check.js checks both maps against index-data.json "order"). A card with no
  // value ("na": no market view / no roles block yet) always sorts last, so the sorts stay useful while few pages have v2 blocks.
  var RANK = {
    sent: { bullish: 0, neutral: 1, bearish: 2, unclear: 3 },
    bar: { none: 0, low: 1, medium: 2, high: 3, unknown: 4 },
    pace: { shipping: 0, quiet: 1, unknown: 2, norepo: 3 }
  };
  // Reverse ranks ("bearish first", "hardest first", "quiet first"): the ordered values flip, but the tail values (unclear / unknown / no repo = no real
  // signal, listed in their forward order) stay after them, and n/a still sorts last, so a reverse sort never opens with the cards that tell you nothing.
  var TAIL = { sent: ["unclear"], bar: ["unknown"], pace: ["unknown", "norepo"] };
  var REV = {};
  Object.keys(RANK).forEach(function (t) {
    var ord = Object.keys(RANK[t]).filter(function (v) { return TAIL[t].indexOf(v) < 0; })
      .sort(function (a, b) { return RANK[t][a] - RANK[t][b]; }).reverse();
    REV[t] = {};
    ord.forEach(function (v, i) { REV[t][v] = i; });
    TAIL[t].forEach(function (v, i) { REV[t][v] = ord.length + i; });
  });
  // The easier of a card's two barriers (its "best role"); "" when neither is recorded. 'unknown' counts as harder than any known value.
  function bestBar(c) {
    var x = c.dataset.bm, y = c.dataset.bv, rx = RANK.bar[x], ry = RANK.bar[y];
    return rx === undefined ? (ry === undefined ? "" : y) : (ry === undefined || rx <= ry ? x : y);
  }
  function sortCmp(k, w) {
    var key = "c" + w;
    function str(f) { return function (a, b) { return a.dataset[f] < b.dataset[f] ? -1 : a.dataset[f] > b.dataset[f] ? 1 : 0; }; }
    function num(f) { return function (a, b) { return +a.dataset[f] - +b.dataset[f]; }; }
    function rev(f) { return function (a, b) { return f(b, a); }; }
    function ranked(val, t, m) {
      function r(c) { var v = (m || RANK)[t][val(c)]; return v === undefined ? 99 : v; }
      return function (a, b) { return r(a) - r(b); };
    }
    function rank(f, t, m) { return ranked(function (c) { return c.dataset[f]; }, t, m); }
    // Scorecard numbers (BUILD 2): data-own = % of emission under the owner's keys, data-earn = uids with non-zero incentive; a number or "na" (not on the
    // page's scorecard yet). "na" sorts last in BOTH directions, so neither end of the list opens with the cards that tell you nothing.
    function numCmp(f, desc) {
      return function (a, b) {
        var x = a.dataset[f], y = b.dataset[f], nx = x === undefined || x === "na" || x === "", ny = y === undefined || y === "na" || y === "";
        if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
        return desc ? +y - +x : +x - +y;
      };
    }
    var by = {
      active: rev(num(key)), "active-asc": num(key), recent: rev(str("last")), researched: rev(str("researched")),
      sn: num("sn"), "sn-desc": rev(num("sn")), name: str("name"), "name-desc": rev(str("name")),
      sentiment: rank("sent", "sent"), "sentiment-rev": rank("sent", "sent", REV),
      barrier: ranked(bestBar, "bar"), "barrier-rev": ranked(bestBar, "bar", REV),
      "barrier-miner": rank("bm", "bar"), "barrier-miner-rev": rank("bm", "bar", REV),
      "barrier-validator": rank("bv", "bar"), "barrier-validator-rev": rank("bv", "bar", REV),
      owner: numCmp("own", false), "owner-rev": numCmp("own", true), earners: numCmp("earn", true), "earners-rev": numCmp("earn", false),
      pace: rank("pace", "pace"), "pace-rev": rank("pace", "pace", REV)
    }[k];
    return function (a, b) { return (by ? by(a, b) : 0) || a._i - b._i; };
  }
  // sort:end
  // filter:begin (pure, no DOM; scripts/filter_check.js extracts and tests this block)
  // Chip groups of the filter panel. A group's name is the card's data-* key (data-status, data-net, data-sent, data-bm, data-bv, data-em, data-ev, data-pace, data-burn), so a
  // card matches when the search text is in its data-text and every group that is on equals the card's value ("na" = nothing recorded yet).
  // em / ev (BUILD 2) = 'laptop, no paid API' for the miner / validator roles: yes | no | na (build.py, index_data.easy_for).
  // pace / burn (BUILD 4) = the code pace of the repos (shipping | quiet | unknown | norepo | na) and the registration-burn bucket (floor | low | mid | high | na).
  var FGROUPS = ["status", "net", "sent", "bm", "bv", "em", "ev", "pace", "burn"];
  // Cumulative barrier chips ("Low or easier"): the chip value is not a card value, it stands for the card values listed here. 'unknown' and
  // n/a never match one (not knowing the barrier is not "easy"). Only the two barrier groups have such chips (build.py BARRIER_EASIER).
  var EASIER = { "le-low": ["none", "low"], "le-medium": ["none", "low", "medium"] };
  function cardOk(d, s, st) {
    if (s && d.text.indexOf(s) < 0) return false;
    for (var i = 0; i < FGROUPS.length; i++) {
      var g = FGROUPS[i], v = st[g];
      if (v && (EASIER[v] ? EASIER[v].indexOf(d[g]) < 0 : d[g] !== v)) return false;
    }
    return true;
  }
  // filter:end
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
  var state = { status: "", net: "", sent: "", bm: "", bv: "", em: "", ev: "", pace: "", burn: "", win: "30" };
  var UNIT = { "7": "in 7 d", "30": "in 30 d", "90": "in 90 d", "all": "all time" };
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
  function skSay(txt) { if (skCap) skCap.textContent = txt; }   // hover readout of the bar under the pointer; empty otherwise
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
    skSay("");
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
  // Under the flow the toolbar (search, filters, chat window, sort) is the strip between the hero bar and the skyline, so the filters sit with the thing
  // they filter; without the gallery it goes back in front of the grid, where it is sticky. flow ui, skyline and grid all read the same cards, so
  // nothing else needs to know where it is.
  var heroEl = document.querySelector(".hero"), deckEl = document.querySelector(".deck");
  function dock(on) {
    if (!heroEl || !deckEl) return;
    if (on) { if (bar.parentNode !== heroEl) heroEl.insertBefore(bar, deckEl); }
    else if (bar.parentNode === heroEl) { var home = document.getElementById("analysis") || list; home.parentNode.insertBefore(bar, home); }
    stick();
  }

  function apply() {
    var s = q.value.trim().toLowerCase(), n = 0;
    cards.forEach(function (c) {
      var d = c.dataset;
      var ok = cardOk(d, s, state);
      c.hidden = !ok;
      if (byBar[d.sn]) byBar[d.sn].classList.toggle("off", !ok);
      if (ok) n++;
    });
    count.textContent = n + " of " + cards.length + ", " + sortName();
    empty.hidden = n > 0;
    syncFilters();
    if (ui) ui.sync();
  }

  // Filters: Status, Network, Sentiment, the two barriers, the two 'laptop, no paid API' answers, the code pace and the registration burn live in a disclosure panel; what is on shows as removable chips.
  var FNAME = { status: "Status", net: "Network", sent: "Sentiment", bm: "Miner barrier", bv: "Validator barrier", em: "Laptop miner, no paid API", ev: "Laptop validator, no paid API", pace: "Code pace", burn: "Registration burn" };
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
    var on = FGROUPS.filter(function (g) { return state[g]; });
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
    else { FGROUPS.forEach(function (g) { setChip(g, ""); }); q.value = ""; }
    apply();
    fbtn.focus();
  });
  bar.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !fpanel.hidden) { panelOpen(false); fbtn.focus(); }
  });

  // Analysis under the flow (step 10, user 2026-10-29; it replaces the side-panel reader). While the gallery runs, the full page of the CENTRED subnet
  // loads into #analysis, directly under the caption (flowui.js reports the centre through bridge.sel, debounced so scrubbing does not fetch every
  // subnet it passes). The URL hash (#15) names the shown subnet (replaceState: scrubbing leaves no history entries), so a reload or a shared link comes
  // back to it. Without the gallery (no WebGL, ?view=grid, lost context) there is no panel: a card or a skyline bar is a plain link to its page and an
  // old #15 link goes to that page.
  var baseTitle = document.title, ROOT = location.pathname;
  var analysis = document.getElementById("analysis"), anBody = document.getElementById("an-body"), anTitle = document.getElementById("an-title");
  var anFull = document.getElementById("an-full"), anPrev = analysis.querySelector('[data-act="prev"]'), anNext = analysis.querySelector('[data-act="next"]');
  var cache = {}, shown = null, token = 0, selT = 0, hov = 0, HOME_SN = "0";   // HOME_SN: the cover that opens in the centre when the URL names none (root network)

  function hashSn() { var m = /^#(\d+)$/.exec(location.hash); return m ? m[1] : null; }
  var urlOn = !!hashSn();   // the first automatic selection leaves a clean URL; a page opened with a #15 keeps it up to date from the start
  function link(c) { return c.querySelector("a.name-link"); }
  function cardFor(sn) {
    for (var i = 0; i < cards.length; i++) if (cards[i].dataset.sn === sn && link(cards[i])) return cards[i];
    return null;
  }
  function calm() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
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
  function near(d) {   // the shown card's neighbour in the current (filtered, sorted) set, or null at either end
    var s = cards.filter(function (c) { return !c.hidden && link(c); }), i = s.indexOf(shown && cardFor(shown));
    if (i < 0) i = d > 0 ? -1 : s.length;
    return s[i + d] || null;
  }
  function updateNav() { anPrev.disabled = !near(-1); anNext.disabled = !near(1); }
  function hashTo(sn) { try { history.replaceState(null, "", "#" + sn); } catch (e) {} }
  function select(sn) {
    var c = sn && cardFor(sn), mine;
    if (!c) {   // nothing is centred (the filters match nothing) or the subnet has no page: no analysis
      shown = null; token++;
      analysis.hidden = true;
      document.title = baseTitle;
      return;
    }
    if (shown === sn) { updateNav(); return; }
    shown = sn;
    mine = ++token;
    analysis.hidden = false;
    anTitle.textContent = "SN " + sn + " \u2013 " + c.querySelector("h3").textContent;
    anFull.href = link(c).href;
    updateNav();
    if (anBody.firstChild) anBody.classList.add("loading");   // the old page stays (dimmed) until the new one is there: no jump while stepping
    else { anBody.className = "an-body loading"; anBody.textContent = "Loading SN" + sn + "\u2026"; }
    anBody.setAttribute("aria-busy", "true");
    if (urlOn) hashTo(sn);
    urlOn = true;
    load(c).then(function (t) {
      if (mine !== token) return;
      var doc = new DOMParser().parseFromString(t, "text/html"), m = doc.querySelector("main");
      if (!m) throw new Error("no content");
      var nav = m.querySelector("nav.top");
      if (nav) nav.remove();
      anBody.className = "an-body";
      anBody.textContent = "";
      while (m.firstChild) anBody.appendChild(m.firstChild);
      anBody.removeAttribute("aria-busy");
      document.title = doc.title;
      if (analysis.getBoundingClientRect().top < 0) analysis.scrollIntoView({ block: "start" });   // read further down: show the top of the new page
    }).catch(function () {
      if (mine !== token) return;
      var o = document.createElement("a");
      o.href = link(c).href;
      o.textContent = "Open it on its own page.";
      anBody.className = "an-body";
      anBody.removeAttribute("aria-busy");
      anBody.textContent = "This page could not be loaded here. ";
      anBody.appendChild(o);
    });
  }
  function reveal() {   // Enter on the gallery / the caption's Analysis button: scroll the analysis into view and put the keys on it
    analysis.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    anBody.focus({ preventScroll: true });
  }
  function toFlow() {
    window.scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    var lb = document.getElementById("flist");
    if (lb) lb.focus({ preventScroll: true });
  }
  analysis.addEventListener("click", function (ev) {
    var t = ev.target, b = t.closest("[data-act]"), a, m, c, n;
    if (b) {
      var act = b.getAttribute("data-act");
      n = act === "prev" ? near(-1) : act === "next" ? near(1) : null;
      if (n && ui) ui.focus(n.dataset.sn);
      else if (act === "top") toFlow();
      return;
    }
    a = t.closest("a");
    if (!a || a === anFull || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || a.origin !== location.origin) return;
    m = /\/subnets\/(\d+)\.html$/.exec(a.pathname);
    c = m && cardFor(m[1]);
    if (a.pathname === ROOT) { ev.preventDefault(); toFlow(); }
    else if (c && !c.hidden && ui) { ev.preventDefault(); ui.focus(m[1]); }   // a link to another subnet in the set: show it here
  });
  if (sky) {
    sky.addEventListener("click", function (ev) {   // under the flow a bar centres its subnet; a bar the filters dimmed does nothing; without the gallery it is a link
      var a = ev.target.closest("a.sk");
      if (!a || !ui || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      if (!a.classList.contains("off")) ui.focus(a.getAttribute("data-sn"));
    });
    sky.addEventListener("mouseover", function (ev) {
      var a = ev.target.closest("a.sk"), c = a && cardBySn[a.getAttribute("data-sn")];
      if (c) { skSay(skLabel(c)); clearTimeout(hov); if (ui) hov = setTimeout(function () { load(c).catch(function () {}); }, 120); }
    });
    sky.addEventListener("mouseout", function (ev) {
      if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest("a.sk")) { clearTimeout(hov); skSay(""); }
    });
  }
  window.addEventListener("hashchange", function () {   // a #15 link followed or typed on this page (the replaceState this page uses itself fires nothing)
    var sn = hashSn(), c = sn && cardFor(sn);
    if (!c) return;
    if (ui) ui.focus(sn); else if (!expect) location.replace(link(c).href);
  });

  // Flow gallery (X19): the Cover Flow stage sits in the hero, directly under the skyline (its scrubber, step 10), and starts by itself once the page has loaded
  // (idle time, so its three files stay out of the first paint). No Grid | Flow toggle and no stored choice; ?view=grid is the one opt-out.
  // No WebGL, a failed start or a lost GPU context = the page without the stage. The skyline marks the centred cover (.mid) and scrubs it.
  var gal = document.getElementById("gal"), ui = null, uiP = null, uiBad = false, gone = false;
  var expect = !!(gal && window.WebGLRenderingContext && !/[?&]view=grid(&|$)/.test(location.search));   // the gallery is expected: html.flow from the first paint
  var bridge = {
    cards: function () { return cards.filter(function (c) { return !c.hidden; }); },
    win: function () { return state.win; },
    sky: window.__sky || null,
    start: hashSn() || HOME_SN,   // the subnet named by the URL hash starts in the centre (no fetch of the first subnet just to replace it); no hash = the root network (user 2026-10-30), so the first view has covers on both sides; flowui.js falls back to the first cover when SN 0 is not in the shown set
    sel: function (sn) { clearTimeout(selT); selT = setTimeout(select, 220, sn); },   // the centred cover changed (null = no cover): show its analysis once it rests
    open: function (sn) { clearTimeout(selT); select(sn); if (shown === sn) reveal(); },   // Enter / the Analysis button: now, and scroll to it
    lost: function (on) {   // X11: the GPU took the WebGL context: the stage goes until it is restored
      gone = on; gal.hidden = on;
      document.documentElement.classList.toggle("flow", !on);
      dock(!on);
      analysis.hidden = on || shown === null;
      if (!on && ui) ui.show(true);
    }
  };
  function noFlow() {   // the gallery is not coming (no WebGL here, a failed start): the grid page; an old #15 link goes to that page
    var c = hashSn() && cardFor(hashSn());
    if (gal) gal.hidden = true;
    document.documentElement.classList.remove("flow");
    dock(false);
    analysis.hidden = true;
    if (c) location.replace(link(c).href);
  }
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
      still();
    }).catch(function () { uiBad = true; noFlow(); });
  }

  apply();
  (function () {
    var idle = window.requestIdleCallback || function (f) { window.setTimeout(f, 300); };
    function later() { idle(startFlow, { timeout: 2000 }); }
    // the dark deck is there from the first paint (slot shown, html.flow = the gallery is expected): the stage fills it without moving the page
    if (expect) { gal.hidden = false; document.documentElement.classList.add("flow"); dock(true); }
    else noFlow();
    if (/[?&]still=/.test(location.search)) startFlow();
    else if (document.readyState === "complete") later();
    else window.addEventListener("load", later);
  })();
})();
