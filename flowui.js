/* flowui.js - Cover Flow gallery UI (INDEX-ROADMAP.md X10, X11). Loaded on demand by index.js, with covers.js and flow.js, the first time
   the Flow view is opened (D1, D2). It owns the stage (canvas + DOM caption + Open page), pointer / wheel / keyboard input, the flip
   (D4) and the skyline scrubber. index.js keeps the cards, filters, sort, chat window and the reader, and hands over a bridge B:
   B.cards() = the visible cards in sort order, B.win() = chat window, B.sky = window.__sky, B.start = the subnet (SN string) that starts in the
   centre (the URL hash) or null, B.sel(sn) = the centred cover changed (null = none): index.js shows that subnet's analysis under the stage
   (step 10, it replaced the side panel), B.open(sn, el) = Enter / the Analysis button: show it now and scroll to it,
   B.lost(on) = the WebGL context was lost (true) or restored (false): index.js shows the grid meanwhile (X11).
   The stage goes into the hero slot #gal, directly under the skyline (X19, step 10; in front of the card grid #subnets when a page has no slot).
   X19: say() also tells the skyline which bar is the centred cover (B.sky.mid), so the chart and the gallery move together.
   X11 (fallbacks, accessibility): the canvas is aria-hidden; a visually hidden listbox (#flist, the one tab stop, aria-activedescendant =
   the centred cover) lists the shown subnets and takes the keys; a status line says when a cover is turned; prefers-reduced-motion =
   jump to the cover, no inertia, no turn animation; at either end the wheel is left to the page; no WebGL or a lost context = the grid.
   API: window.FlowUI = { start(B) -> FlowUI | null (no WebGL), show(on), sync() (the card set changed), focus(sn) (the reader moved) }.
   Pure block tested by scripts/flowui_check.js: ui:begin..ui:end. */
(function () {
  "use strict";

  // ui:begin (pure: drag scale, flick target, wheel steps, nearest subnet, wheel hand-over)
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // pixels of drag per cover = the spacing of the side covers (STEP world units) as projected on a stage w x h px (geo = FlowRenderer.geo)
  function pxPerCover(geo, w, h) {
    var aspect = w / h;
    return Math.max(24, w / (2 * geo.dist(aspect) * Math.tan(geo.G.FOV * Math.PI / 360) * aspect) * geo.G.STEP);
  }
  // where a flick lands: v = covers per second at release (0 when the finger rested before lifting)
  function flickTo(pos, v, n) { return clamp(Math.round(pos + clamp(v, -14, 14) * 0.2), 0, Math.max(0, n - 1)); }
  // wheel / trackpad: accumulated delta -> [whole covers to move, remainder]
  function wheelSteps(acc, unit) {
    var s = acc > 0 ? Math.floor(acc / unit) : Math.ceil(acc / unit);
    return [s, acc - s * unit];
  }
  // skyline scrub: index of the shown subnet whose SN is nearest to t (exact match wins; ties go to the earlier cover)
  function nearestIdx(sns, t) {
    var b = -1, bd = Infinity, i, d;
    for (i = 0; i < sns.length; i++) { d = Math.abs(sns[i] - t); if (d < bd) { bd = d; b = i; } }
    return b;
  }
  // a wheel turn of delta d at cover `want` of n: true when the gallery cannot move that way (the page scrolls on, no scroll trap)
  function pageScrolls(d, want, n) { return d > 0 ? want >= n - 1 : want <= 0; }
  // ui:end

  var UI = window.FlowUI = { pure: { clamp: clamp, pxPerCover: pxPerCover, flickTo: flickTo, wheelSteps: wheelSteps, nearestIdx: nearestIdx, pageScrolls: pageScrolls },
                             start: start, show: show, sync: sync, focus: focus };
  var B = null, R = null, list = [], opts = [], act = null, want = 0, stage, cv, lb, ttl, sub, num, fx, open, fsay, sky = null, drag = null, sk = null, acc = 0, lastW = 0;
  var rm = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function calm() { return !!(rm && rm.matches); }   // reduced motion: jump to the cover, no inertia, no turn animation
  function link(c) { return c && c.querySelector("a.name-link"); }
  function source(i, back) {   // flow.js asks for the front or back texture of the i-th shown cover
    var c = list[i], f = back ? "back" : "front", t = c && window.FlowCovers.cover(c, f, B.win());
    return t ? { key: c.dataset.sn + ":" + f + ":" + B.win(), canvas: t } : null;
  }
  function model(c) { return window.FlowCovers.model(window.FlowCovers.read(c), B.win()); }
  function desc(c, say) {   // a cover as plain text: [SN - name, category and status, chat line (short + pace for the caption; `say` = full words, for the listbox option), sentiment and barriers (words, for the listbox option)]
    var m = model(c);
    return ["SN " + m.sn + " \u2013 " + m.name, [m.cat, m.statusLabel].filter(Boolean).join(" \u00b7 "), say ? m.lineSay : m.line,
            (m.facts || []).map(function (f) { return f.say; }).join(", ")];
  }
  function chips(c) {   // INDEX REWORK step 5: the three chips under the caption (sentiment, miner barrier, validator barrier), always three, n/a when not recorded
    var f = c ? model(c).facts || [] : [], i, e;
    fx.textContent = "";
    for (i = 0; i < f.length; i++) {
      e = mk("span", f[i].cls, fx, f[i].text);
      e.setAttribute("title", f[i].title);
    }
  }
  function fill() {   // the hidden listbox lists the shown subnets in gallery order; say() marks the centred one
    var i, o;
    lb.textContent = "";
    opts = [];
    act = null;
    for (i = 0; i < list.length; i++) {
      o = mk("li", "", lb, desc(list[i], true).filter(Boolean).join(", "));
      o.id = "fo" + list[i].dataset.sn;
      o.setAttribute("role", "option");
      o.setAttribute("aria-selected", "false");
      opts.push(o);
    }
  }
  function say(i) {   // the caption is DOM text under the stage, not WebGL: SN - name, category, chat count, sentiment + barrier chips; the listbox follows the centre
    var c = list[i], d, a = link(c);
    if (B.sky && B.sky.mid) B.sky.mid(c ? c.dataset.sn : null);
    if (B.sel) B.sel(c ? c.dataset.sn : null);   // step 10: the analysis under the stage follows the centred cover
    if (act) act.setAttribute("aria-selected", "false");
    act = opts[i] || null;
    if (!c || !act) { ttl.textContent = "No subnets match"; sub.textContent = num.textContent = ""; chips(null); open.hidden = true; lb.removeAttribute("aria-activedescendant"); return; }
    d = desc(c);
    ttl.textContent = d[0]; sub.textContent = d[1]; num.textContent = d[2]; chips(c);
    act.setAttribute("aria-selected", "true");
    lb.setAttribute("aria-activedescendant", act.id);
    open.hidden = !a;
    if (a) { open.href = a.href; open.setAttribute("aria-label", "Analysis: " + d[0]); }   // a modified click (new tab) still goes to the page itself
  }
  function unflip(tell) {
    var f = R.flipped(), r;
    if (f < 0) return;
    R.setFlip(f, false, calm());
    r = tell && list[f] && window.FlowCovers.read(list[f]);
    fsay.textContent = r ? "Turned back. " + frontSay(r) : "";
  }
  // chartSay(r): the front face's alpha/TAO + alpha/USD chart as one sentence for the status line (INDEX REWORK step 7; the sentence is made by
  // covers.js chartModel, so the screen reader hears what the canvas shows, incl. "no price series" notes). "" when covers.js has no chart().
  function chartSay(r) {
    var C = window.FlowCovers, m = C && typeof C.chart === "function" ? C.chart(r.price, r.usd, r.net, parseInt(r.sn, 10), r.loaded) : null;
    return m && m.say ? m.say : "";
  }
  // frontSay(r): what the FRONT face shows (faces swapped 2026-10-28): the tagline, then the chart sentence, joined with ONE full stop
  function frontSay(r) {
    var t = r.tag || "No description", cs = chartSay(r);
    return t + (cs ? (/[.!?]$/.test(t) ? " " : ". ") + cs : "");
  }
  function flip() {
    var c = R.center(), on = R.flipped() !== c, r = list[c] && window.FlowCovers.read(list[c]);
    if (!r) return;
    R.setFlip(c, on, calm());
    fsay.textContent = on ? "Turned over. " + (window.FlowCovers.model(r, B.win()).say || "") : "Turned back. " + frontSay(r);   // the back face holds the analysis (covers.js model.say), the front the tagline and the chart
  }
  function go(i, v) { want = clamp(i, 0, Math.max(0, list.length - 1)); unflip(); R.setTarget(want, calm(), calm() ? 0 : v); }
  function openCur() { var c = list[R.center()]; if (link(c)) B.open(c.dataset.sn, open); }

  function down(ev) {
    if (drag || (ev.pointerType === "mouse" && ev.button)) return;
    drag = { id: ev.pointerId, x: ev.clientX, p: R.position(), lx: ev.clientX, lt: ev.timeStamp, v: 0, moved: false };
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
  }
  function move(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var dx = ev.clientX - drag.x, per = pxPerCover(window.FlowRenderer.geo, cv.clientWidth, cv.clientHeight), dt = Math.max(1, ev.timeStamp - drag.lt);
    if (!drag.moved) { if (Math.abs(dx) < 6) return; drag.moved = true; unflip(); stage.classList.add("drag"); }
    drag.v = drag.v * 0.6 - (ev.clientX - drag.lx) / per / (dt / 1000) * 0.4;
    drag.lx = ev.clientX; drag.lt = ev.timeStamp;
    R.setPosition(clamp(drag.p - dx / per, 0, Math.max(0, list.length - 1)));
  }
  function up(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var d = drag, i, v;
    drag = null;
    stage.classList.remove("drag");
    if (d.moved) {
      v = ev.type === "pointercancel" || ev.timeStamp - d.lt > 80 ? 0 : d.v;   // a finger that rested before lifting does not flick
      return go(flickTo(R.position(), calm() ? 0 : v, list.length), v);
    }
    if (ev.type === "pointercancel") return;
    i = R.pick(ev.clientX, ev.clientY);   // a tap: side cover -> bring to the centre, centre cover -> turn it over (D4)
    if (i === R.center()) flip(); else if (i >= 0) go(i);
  }
  function wheel(ev) {
    var d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY, s;
    if (!d || ev.ctrlKey || pageScrolls(d, want, list.length)) return;   // ctrl + wheel stays the browser's zoom; at either end the page scrolls on
    ev.preventDefault();
    if (ev.timeStamp - lastW > 250) acc = 0;
    lastW = ev.timeStamp;
    acc += d * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 300 : 1);
    s = wheelSteps(acc, 80);
    acc = s[1];
    if (s[0]) go(want + s[0]);
  }
  function key(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target !== lb) return;
    var k = ev.key, hit = true;
    if (k === "ArrowRight") go(want + 1); else if (k === "ArrowLeft") go(want - 1);
    else if (k === "Home") go(0); else if (k === "End") go(list.length - 1);
    else if (k === "ArrowDown" || k === "f") flip();
    else if (k === "ArrowUp" || (k === "Escape" && R.flipped() >= 0)) unflip(true);
    else if (k === "Enter" || k === " ") openCur();
    else hit = false;
    if (hit) ev.preventDefault();
  }
  // the skyline is the scrubber: drag along it to run through the gallery; a plain tap still opens the reader (index.js)
  function skDown(ev) { if (!sk && !(ev.pointerType === "mouse" && ev.button)) sk = { id: ev.pointerId, x: ev.clientX, moved: false }; }
  function skMove(ev) {
    if (!sk || ev.pointerId !== sk.id) return;
    if (!sk.moved) {
      if (Math.abs(ev.clientX - sk.x) < 6) return;
      sk.moved = true;
      try { sky.setPointerCapture(ev.pointerId); } catch (e) {}   // the click that follows now misses the skyline's links
    }
    var t = B.sky && B.sky.snAt(ev.clientX), i = t == null ? -1 : nearestIdx(list.map(function (c) { return +c.dataset.sn; }), +t);
    if (i >= 0) go(i);
  }
  function skUp(ev) { if (sk && ev.pointerId === sk.id) sk = null; }

  function mk(tag, cls, par, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    if (par) par.appendChild(e);
    return e;
  }
  function lostCtx() { stage.hidden = true; if (B.lost) B.lost(true); }   // the GPU took the context: the grid takes over until it is restored
  function backCtx() { if (B.lost) B.lost(false); say(R.center()); }
  function start(bridge) {
    if (R) return UI;
    B = bridge;
    list = B.cards();
    stage = mk("section", "stage");
    stage.id = "stage";
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", "Cover Flow gallery");
    stage.tabIndex = -1;   // a click on the canvas or caption focuses the stage (not a tab stop) and the stage hands the keys to the listbox
    stage.addEventListener("focus", function (ev) { if (ev.target === stage) lb.focus({ preventScroll: true }); });
    cv = mk("canvas", "", stage);
    cv.setAttribute("aria-hidden", "true");
    lb = mk("ul", "flist vh", stage);
    lb.id = "flist";
    lb.tabIndex = 0;
    lb.setAttribute("role", "listbox");
    lb.setAttribute("aria-label", "Subnets in gallery order");
    lb.setAttribute("aria-describedby", "fhint");
    var cap = mk("div", "fcap", stage);
    ttl = mk("b", "", cap); sub = mk("span", "", cap); num = mk("span", "", cap); fx = mk("div", "ffacts", cap);
    [ttl, sub, num, fx].forEach(function (e) { e.setAttribute("aria-hidden", "true"); });   // the listbox option says the same
    open = mk("a", "rb fopen", cap, "Analysis");
    open.href = "#";
    mk("span", "vh", stage, "Left and right arrows move, Enter jumps to the analysis below, Down arrow turns the cover over, Up arrow or Escape turns it back.").id = "fhint";
    fsay = mk("span", "vh", stage);
    fsay.setAttribute("role", "status");
    var grid = document.getElementById("subnets");
    var gal = document.getElementById("gal");
    if (gal) gal.appendChild(stage); else grid.parentNode.insertBefore(stage, grid);   // before the first create(): the canvas needs its size (the slot is visible by now)
    R = window.FlowRenderer.create(cv, { count: list.length, source: source, onCenter: say, onLost: lostCtx, onRestored: backCtx });
    if (!R) { stage.parentNode.removeChild(stage); return null; }
    fill();
    for (var k = 0; B.start && k < list.length; k++) if (list[k].dataset.sn === String(B.start)) { want = k; R.setTarget(k, true); break; }   // the URL names a subnet: start on it
    window.FlowCovers.onRelease(R.release);
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    lb.addEventListener("keydown", key);
    open.addEventListener("click", function (ev) {
      if (ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      openCur();
    });
    sky = document.getElementById("sky");
    if (sky) {
      sky.addEventListener("pointerdown", skDown);
      sky.addEventListener("pointermove", skMove);
      sky.addEventListener("pointerup", skUp);
      sky.addEventListener("pointercancel", skUp);
    }
    say(R.center());
    return UI;
  }
  function show(on) {
    if (!R) return;
    stage.hidden = !on;
    if (on) R.resize();
  }
  // the shown set or its order changed (filter, search, sort, chat window): keep the same subnet in the centre when it is still shown
  function sync() {
    if (!R) return;
    var cur = list[R.center()], j;
    list = B.cards();
    fill();
    fsay.textContent = "";
    R.setFlip(-1, false, true);
    R.setCount(list.length);
    j = cur ? list.indexOf(cur) : -1;
    want = j >= 0 ? j : clamp(want, 0, Math.max(0, list.length - 1));
    R.setTarget(want, j >= 0);
    say(R.center());
  }
  function focus(sn) {   // the reader moved to subnet sn: bring it to the centre
    if (!R) return;
    for (var i = 0; i < list.length; i++) if (list[i].dataset.sn === String(sn)) { go(i); return; }
  }
})();
