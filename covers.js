/* covers.js - cover art for the Flow gallery (INDEX-ROADMAP.md, item X8).
   Draws a 256x256 front and back cover per subnet on a 2D canvas from data that is already on the card (SN, name, category,
   status, hue class, chat counts). Nothing here touches the page: flow.js (X9/X10) loads this file on demand, asks for covers
   and uploads them as textures. Covers are made on demand into a small LRU pool (never all 134 at once).
   Pure blocks (no DOM, no canvas) are tested by scripts/covers_check.js: covers:begin..end and draw:begin..end. */
(function () {
  "use strict";
  var COVER = 256, POOL_CAP = 25;
  var WINS = ["7", "30", "90", "all"];
  var UNIT = { "7": "in 7 d", "30": "in 30 d", "90": "in 90 d", "all": "all time" };
  var WSHORT = { "7": "7 d", "30": "30 d", "90": "90 d", "all": "all" };
  var STATUS_LABEL = { pending: "not researched", unclaimed: "unclaimed channel", deprecated: "deprecated channel" };
  var STATUS_COLOR = { active: "#4ade80", quiet: "#facc15", transitioning: "#fb923c", unclear: "#a3a7bd" };

  // covers:begin (pure: model, palette, text wrapping, pool; scripts/covers_check.js extracts and tests this block)
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  // wrap(text, width, maxLines): greedy word wrap by character count; long words are hard-broken; the last line ends with an
  // ellipsis when text is cut. Never returns a line longer than width or more than maxLines lines.
  function wrap(text, width, maxLines) {
    var words = String(text == null ? "" : text).trim().split(/\s+/).filter(Boolean), lines = [], cur = "", i, w;
    for (i = 0; i < words.length; i++) {
      w = words[i];
      while (w.length > width) {
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += " " + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      lines[maxLines - 1] = (last.length >= width ? last.slice(0, width - 1) : last) + "…";
    }
    return lines;
  }
  // c = plain card data (see readCard). win = "7" | "30" | "90" | "all" (anything else = "30").
  function coverModel(c, win) {
    win = WINS.indexOf(win) >= 0 ? win : "30";
    var name = String(c.name || "SN" + c.sn), len = name.length;
    var size = len <= 12 ? 28 : len <= 24 ? 24 : 20;
    var st = String(c.status || "unclear");
    var heat = Math.max(0, Math.min(5, parseInt(c.h && c.h[win], 10) || 0));
    var count = parseInt(c.c && c.c[win], 10) || 0;
    return {
      key: c.sn + ":" + win, sn: parseInt(c.sn, 10), hue: parseInt(c.hue, 10) || 0, win: win,
      name: name, nameSize: size, nameLines: wrap(name, size === 28 ? 13 : size === 24 ? 15 : 18, size === 20 ? 3 : 2),
      cat: String(c.cat || "").slice(0, 40), tagLines: wrap(c.tag || "", 28, 4),
      status: st, statusLabel: STATUS_LABEL[st] || st, statusColor: STATUS_COLOR[st] || "#a3a7bd",
      pending: st === "pending" || st === "unclaimed" || st === "deprecated",
      net: c.net === "main" ? "mainnet" : "testnet", heat: heat, count: count, countText: fmt(count), unit: UNIT[win],
      last: c.last && c.last !== "-" ? String(c.last) : "",
      nums: WINS.map(function (w) { return { win: w, label: WSHORT[w], text: fmt(parseInt(c.c && c.c[w], 10) || 0), on: w === win }; })
    };
  }
  // card element (or a stub with dataset, className, querySelector) -> plain data for coverModel
  function readCard(card) {
    var d = card.dataset || {}, m = /(?:^|\s)h(\d+)(?:\s|$)/.exec(card.className || ""), el;
    function txt(sel) { el = card.querySelector(sel); return el ? String(el.textContent || "").trim() : ""; }
    return {
      sn: d.sn, name: txt("h3") || d.name, status: d.status, net: d.net, hue: m ? m[1] : 0, last: d.last,
      cat: txt(".cat"), tag: txt(".tag"),
      c: { "7": d.c7, "30": d.c30, "90": d.c90, all: d.call }, h: { "7": d.h7, "30": d.h30, "90": d.h90, all: d.hall }
    };
  }
  function hexRgb(h) { var s = String(h).replace("#", ""); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; }
  function rgbHex(c) { return "#" + c.map(function (v) { return ("0" + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join(""); }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round); }
  function lum(c) {
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // palette(accent hex): front gradient top/bot, back background deep, white ink, dimmer ink, light accent for the back. The front
  // top colour is darkened until BOTH inks read on it at >= 4.5:1 (bot is darker still), so text never sits on a weak surface.
  function palette(hc) {
    var c = hexRgb(hc), base = [11, 12, 21], white = [255, 255, 255], t = 0.4, top, dim;
    for (;;) {
      top = mix(c, base, t);
      dim = mix(white, top, 0.18);
      if ((contrast(dim, top) >= 4.6 && contrast(white, top) >= 4.6) || t >= 0.95) break;
      t += 0.03;
    }
    return { top: top, bot: mix(c, base, Math.min(0.97, t + 0.3)), deep: mix(c, base, 0.88), ink: white, dim: dim, acc: mix(c, white, 0.55), base: base };
  }
  // LRU pool: Map keeps insertion order; get() refreshes recency; set() evicts the oldest while size > cap
  function makePool(cap, onEvict) {
    var map = new Map(), s = { cap: cap, size: 0, made: 0, hits: 0, evicted: 0, peak: 0 };
    return {
      stats: s,
      get: function (k) {
        if (!map.has(k)) return undefined;
        var v = map.get(k); map.delete(k); map.set(k, v); s.hits++; return v;
      },
      set: function (k, v) {
        map.delete(k); map.set(k, v); s.made++;
        while (map.size > cap) {
          var old = map.keys().next().value, ov = map.get(old);
          map.delete(old); s.evicted++;
          if (onEvict) onEvict(old, ov);
        }
        s.size = map.size; if (map.size > s.peak) s.peak = map.size;
      },
      has: function (k) { return map.has(k); },
      keys: function () { return Array.from(map.keys()); }
    };
  }
  // covers:end

  // draw:begin (needs only a 2D context: scripts/covers_check.js runs it against a recording stub)
  var FONT = '"Inter","Inter Fallback",system-ui,sans-serif';
  function setFont(ctx, w, s) { ctx.font = w + " " + s + "px " + FONT; }
  function fit(ctx, text, w, s, maxW, min) {
    setFont(ctx, w, s);
    while (s > min && ctx.measureText(text).width > maxW) { s--; setFont(ctx, w, s); }
    return s;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, color, align) { ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.fillText(s, x, y); }
  function drawFront(ctx, m, p) {
    var g = ctx.createLinearGradient(0, 0, 256, 256), i, x, w, s;
    g.addColorStop(0, rgbHex(p.top)); g.addColorStop(1, rgbHex(p.bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,0.14)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
    if (m.pending) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.strokeRect(6, 6, 244, 244); ctx.setLineDash([]);
    }
    ctx.textBaseline = "alphabetic";
    text(ctx, m.net.toUpperCase(), 240, 31, rgbHex(p.dim), "right");
    if (m.cat) {
      s = fit(ctx, m.cat, "600", 12, 140, 9);
      w = Math.min(ctx.measureText(m.cat).width + 20, 150);
      rr(ctx, 16, 14, w, 24, 12); ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fill();
      text(ctx, m.cat, 26, 31, rgbHex(p.ink));
    }
    setFont(ctx, "700", 13); text(ctx, "SN", 18, 70, rgbHex(p.dim));
    s = String(m.sn).length > 3 ? 56 : 68;
    setFont(ctx, "700", s); text(ctx, String(m.sn), 16, 126, rgbHex(p.ink));
    s = fit(ctx, m.nameLines.reduce(function (a, b) { return a.length >= b.length ? a : b; }, ""), "700", m.nameSize, 224, 12);
    setFont(ctx, "700", s);
    for (i = 0; i < m.nameLines.length; i++) text(ctx, m.nameLines[i], 16, 160 + i * Math.round(s * 1.14), rgbHex(p.ink));
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(16, 214, 224, 1);
    for (i = 0; i < 5; i++) { x = 16 + i * 18; ctx.fillStyle = i < m.heat ? rgbHex(p.ink) : "rgba(255,255,255,0.25)"; ctx.fillRect(x, 224, 14, 7); }
    setFont(ctx, "600", 12); text(ctx, m.countText + " chat msgs " + m.unit, 240, 233, rgbHex(p.ink), "right");
    setFont(ctx, "500", 11); text(ctx, m.last ? "last chat " + m.last : "no chat yet", 16, 248, rgbHex(p.dim));
  }
  function drawBack(ctx, m, p) {
    var g = ctx.createLinearGradient(0, 0, 0, 256), i, col, row, x, y;
    g.addColorStop(0, rgbHex(p.deep)); g.addColorStop(1, rgbHex(p.base));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = rgbHex(p.acc); ctx.fillRect(0, 0, 256, 5);
    ctx.textBaseline = "alphabetic";
    setFont(ctx, "700", 22); text(ctx, "SN " + m.sn, 16, 40, rgbHex(p.acc));
    fit(ctx, m.name, "600", 15, 224, 11); text(ctx, m.name, 16, 62, rgbHex(p.ink));
    ctx.beginPath(); ctx.arc(22, 90, 4, 0, Math.PI * 2); ctx.fillStyle = m.statusColor; ctx.fill();
    setFont(ctx, "600", 12); text(ctx, m.statusLabel, 32, 94, rgbHex(p.ink));
    if (m.cat) { fit(ctx, m.cat, "500", 12, 224, 9); text(ctx, m.cat, 16, 114, rgbHex(p.dim)); }
    setFont(ctx, "400", 13);
    for (i = 0; i < m.tagLines.length; i++) text(ctx, m.tagLines[i], 16, 142 + i * 17, rgbHex(p.ink));
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(16, 204, 224, 1);
    for (i = 0; i < m.nums.length; i++) {
      col = i % 2; row = (i / 2) | 0; x = 16 + col * 120; y = 224 + row * 22;
      setFont(ctx, "500", 11); text(ctx, m.nums[i].label, x, y, rgbHex(p.dim));
      setFont(ctx, "700", 16); text(ctx, m.nums[i].text, x + 36, y, m.nums[i].on ? rgbHex(p.acc) : rgbHex(p.ink));
    }
  }
  function drawCover(ctx, m, face, p) { if (face === "back") drawBack(ctx, m, p); else drawFront(ctx, m, p); }
  // draw:end

  // ---- browser side (not unit-tested; scripts/covers_snapshot.js-style checks in a real browser belong to X12) ----
  var fontsP = null;
  function ready() {
    if (!fontsP) {
      var f = document.fonts;
      var load = function (w) { return f && f.load ? f.load(w + " 1em Inter") : Promise.resolve(); };
      fontsP = Promise.all([load("600"), load("700"), load("400")]).then(function () { return true; }, function () { return true; });
    }
    return fontsP;
  }
  var isReady = false;
  var released = [];
  var pool = makePool(POOL_CAP, function (k, cv) {
    if (cv && cv.width) { cv.width = 0; cv.height = 0; }   // free the bitmap; flow.js drops the GL texture in its own onEvict
    for (var i = 0; i < released.length; i++) released[i](k);
  });
  function accentOf(card) {
    var v = "";
    try { v = String(getComputedStyle(card).getPropertyValue("--hc") || "").trim(); } catch (e) {}
    return /^#[0-9a-f]{6}$/i.test(v) ? v : "#5e7cfa";
  }
  // cover(card, face, win): canvas for face "front" | "back" in chat window win, or null while the fonts are still loading
  function cover(card, face, win) {
    face = face === "back" ? "back" : "front";
    win = WINS.indexOf(win) >= 0 ? win : "30";
    var key = card.dataset.sn + ":" + face + ":" + win, hit = pool.get(key);
    if (hit) return hit;
    if (!isReady) return null;
    var m = coverModel(readCard(card), win), cv = document.createElement("canvas"), ctx;
    cv.width = cv.height = COVER;
    ctx = cv.getContext("2d");
    if (!ctx) return null;
    drawCover(ctx, m, face, palette(accentOf(card)));
    pool.set(key, cv);
    return cv;
  }
  ready().then(function () { isReady = true; });
  var api = {
    SIZE: COVER, CAP: POOL_CAP, ready: ready, cover: cover, model: coverModel, read: readCard, palette: palette, wrap: wrap,
    onRelease: function (fn) { released.push(fn); }, has: function (sn, face, win) { return pool.has(sn + ":" + face + ":" + win); },
    isReady: function () { return isReady; }
  };
  var F = window.__flow = window.__flow || {};
  F.covers = api;
  Object.defineProperty(F, "stats", { configurable: true, enumerable: true, get: function () { return pool.stats; } });
  window.FlowCovers = api;
})();
