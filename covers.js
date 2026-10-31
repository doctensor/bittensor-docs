/* covers.js - cover art for the Flow gallery (INDEX-ROADMAP.md, item X8). Draws a front and a back cover per subnet on a 2D canvas, from data that is already on the
   card (SN, name, category, status, hue class, chat counts, token symbol, sentiment, barriers: data-* attributes) plus index-data.json (loaded once with the fonts).
   FRONT = chart face (SN + token symbol, name, category, tagline, alpha/TAO + alpha/USD, chat counts per window); BACK = analysis face (sentiment, market view, entry
   barriers, chat activity and, BUILD 3, code activity). Drawn on a 256-unit grid, rasterised at COVER = 512 px, into a small LRU pool (never all 134 at once);
   flow.js loads this file on demand and uploads the covers as textures. Pure blocks are tested by scripts/covers_check.js: covers, chart and draw blocks. */
(function () {
  "use strict";
  var COVER = 512, POOL_CAP = 25, GRID = 256;   // GRID: every coordinate in the draw code is on a 256 x 256 grid; COVER only sets the pixels (ctx.scale(COVER / GRID))
  var WINS = ["7", "30", "90", "all"];
  // index-data.json, filled by ingest() (empty in the pure tests): PRICE / MARKET / CODE = { sn: record.price / market / code }, USDMETA = doc.usd, YEAR = its built year,
  // DATA_OK = file read and parsed (else "price data not loaded")
  var PRICE = {}, MARKET = {}, CODE = {}, USDMETA = null, DATA_OK = false, YEAR = "";
  // chart area (front face): x range of both plots and the [top, bottom] of panel A (alpha / TAO) and panel B (alpha / USD), in canvas px
  var PLOT = { x0: 16, x1: 188, a: [136, 158], b: [178, 200], root: [141, 198] };   // root: the one tall TAO/USD panel
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var UNIT = { "7": "in 7 d", "30": "in 30 d", "90": "in 90 d", "all": "all time" };
  var WSHORT = { "7": "7 d", "30": "30 d", "90": "90 d", "all": "all" };
  var STATUS_LABEL = { pending: "not researched", unclaimed: "unclaimed channel", deprecated: "deprecated channel" };
  var STATUS_COLOR = { active: "#4ade80", quiet: "#facc15", transitioning: "#fb923c", unclear: "#a3a7bd" };
  // INDEX REWORK step 5: sentiment + barrier labels as build.py prints them on the grid cards (scripts/covers_check.js compares them with
  // the real card chips, so they cannot drift). Values come from the card's data-sent / data-bm / data-bv; anything else = n/a.
  var SENT_LABEL = { bullish: "Bullish", neutral: "Neutral", bearish: "Bearish", unclear: "Unclear" };
  var BARRIER_LABEL = { none: "No barrier", low: "Low barrier", medium: "Medium barrier", high: "High barrier", unknown: "Barrier unknown" };
  var BARRIER_SHORT = { none: "None", low: "Low", medium: "Medium", high: "High", unknown: "Unknown" };
  var NA_TITLE = { sent: "No market view yet", bm: "No miner barrier recorded yet", bv: "No validator barrier recorded yet" };
  var SN_BASE = 31, SN_CY = 24;   // header row: baseline of "SN 71" and the middle of its digits (20 px Inter bold, cap height 0.727 em); the token symbol sits right of it
  // sentiment pill colours, barrier meter levels (3 segments; unknown / n/a = dashed), words for the market view's valuation
  var SENT_COLOR = { bullish: "#4ade80", neutral: "#a3a7bd", bearish: "#f87171", unclear: "#facc15" };
  var BAR_LEVEL = { none: 0, low: 1, medium: 2, high: 3 };
  var VAL_WORD = { undervalued: "undervalued", fair: "fairly valued", overvalued: "overvalued", unclear: "valuation unclear" };

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
  // facts(c): the caption's chips (sentiment, miner barrier, validator barrier), ALWAYS three in this order (fixed caption height); an unknown enum = n/a (grey, dashed).
  // cls = chip classes, text = visible text, title = hover text, say = words for the listbox option.
  function facts(c) {
    function one(k, v, map, text, title) {
      return Object.prototype.hasOwnProperty.call(map, v) ? { k: k, v: v, cls: "chp " + (k === "sent" ? "sent s-" : "b-") + v, text: text(v), title: title(v), say: "" }
                                                          : { k: k, v: "na", cls: "chp na", text: text(null), title: NA_TITLE[k], say: "" };
    }
    var s = one("sent", c.sent, SENT_LABEL, function (v) { return v ? SENT_LABEL[v] : "Sentiment n/a"; }, function (v) { return "Sentiment: " + SENT_LABEL[v]; });
    var m = one("bm", c.bm, BARRIER_LABEL, function (v) { return "Miner · " + (v ? BARRIER_SHORT[v] : "n/a"); }, function (v) { return "Miner barrier: " + BARRIER_LABEL[v]; });
    var d = one("bv", c.bv, BARRIER_LABEL, function (v) { return "Validator · " + (v ? BARRIER_SHORT[v] : "n/a"); }, function (v) { return "Validator barrier: " + BARRIER_LABEL[v]; });
    s.say = s.v === "na" ? "no sentiment recorded" : "sentiment " + s.v;
    m.say = m.v === "na" ? "no miner barrier recorded" : "miner barrier " + m.v;
    d.say = d.v === "na" ? "no validator barrier recorded" : "validator barrier " + d.v;
    return [s, m, d];
  }
  // symPlace: the token symbol next to the SN numeral. met = { width, asc, desc } of the glyph at size s (ink above / below the baseline; NaN = unknown).
  // Scaled DOWN only, until advance <= maxW and ink <= maxH; ink centred on the digits (cy), on the baseline without ink metrics. Returns { size, x, y }.
  function symPlace(met, s, x, cy, maxW, maxH) {
    var w = +met.width, a = +met.asc, d = +met.desc, ink = isFinite(a) && isFinite(d) && a + d > 0, k = 1, size;
    if (w > 0 && maxW > 0) k = Math.min(k, maxW / w);
    if (ink && maxH > 0) k = Math.min(k, maxH / (a + d));
    if (!(k > 0)) k = 1;
    size = Math.max(12, Math.floor(s * k));
    return { size: size, x: x, y: ink ? Math.round(cy + (a - d) / 2 * (size / s)) : SN_BASE };   // ink scales with the size actually used (floored)
  }
  // "2026-10-28" -> "28 Oct" (anything else comes back as it is)
  function lastText(v) { var q = /^(\d{4})-(\d\d)-(\d\d)/.exec(v || ""); return q && MONTHS[parseInt(q[2], 10) - 1] ? parseInt(q[3], 10) + " " + MONTHS[parseInt(q[2], 10) - 1] : String(v || ""); }
  // dayText: "27 Oct" in the reference year y (index-data.json built), else "Jan 2025"; y unknown = always with the year (never a bare day that could be years old)
  function dayText(v, y) { var q = /^(\d{4})-(\d\d)-(\d\d)/.exec(v || ""), m = q && MONTHS[q[2] - 1]; return !m ? String(v || "") : q[1] === y ? +q[3] + " " + m : m + " " + q[1]; }
  function r1(v) { return v > 0 && v < 0.1 ? "<0.1" : v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }
  // pace(c7, c30): chat per day over 30 d, and the last 7 days' pace against it (only from 30 messages in 30 d, below that a ratio is noise):
  // dir 1 / -1 beyond +15 % / -13 % (x1.15 / x0.87), else 0 = steady
  function pace(c7, c30) {
    var pd = c30 / 30, out = { perDay: r1(pd), trend: null }, r;
    if (c30 >= 30) { r = c7 / 7 / pd; out.trend = r >= 1.15 ? { dir: 1, text: "\u00d7" + r1(r) } : r <= 0.87 ? { dir: -1, text: "\u00d7" + r1(r) } : { dir: 0, text: "steady" }; }
    return out;
  }
  // BUILD 3: code activity (index-data.json record.code): pace chip, code commits in 30 d, last commit, last release. What the file cannot say is left out
  // (never a 0 or a "no release"); note != "" = a dashed note instead of the block.
  var CODE_WORD = { shipping: "Shipping", quiet: "Quiet", unknown: "Unknown" }, CODE_COLOR = { shipping: "#4ade80", quiet: "#facc15", unknown: "#a3a7bd" };
  function codeModel(cd, loaded, y) {
    var has = cd && Object.prototype.hasOwnProperty.call(CODE_WORD, cd.pace), n = has && typeof cd.c30 === "number" ? cd.c30 : null, k = n === null ? "" : fmt(n) + " code commit" + (n === 1 ? "" : "s"), o;
    o = { word: has ? CODE_WORD[cd.pace] : "", color: has ? CODE_COLOR[cd.pace] : "", note: "", head: "", last: "", rel: "", say: "" };
    if (!has) o.note = cd && cd.pace === "no repo" ? "No repo on record" : loaded ? "No code data read" : "Code data not loaded";
    else {
      o.head = n === null ? "not measured" : k + " \u00b7 30 d";
      o.last = cd.last ? "last commit " + dayText(cd.last, y) : "no commit read";
      o.rel = n === null ? "" : cd.rel ? "release " + dayText(cd.rel, y) : "no release";
    }
    o.say = has ? "Code: " + (n === null ? "pace unknown, the repo was not measured" : o.word.toLowerCase() + ", " + k + " in the last 30 days") + (cd.last ? ", last commit " + dayText(cd.last, y) : "") +
            (n === null ? "" : cd.rel ? ", last release " + dayText(cd.rel, y) : ", no release") + "." : o.note + ".";
    return o;
  }
  // the market view's words (index-data.json record.market): headline wrapped for the card, confidence and valuation as short phrases, as-of date
  function marketModel(mk) {
    if (!mk || typeof mk.headline !== "string" || !mk.headline.trim()) return null;
    var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
    return { text: mk.headline.trim(), lines: wrap(mk.headline, 38, 4), conf: has({ high: 1, medium: 1, low: 1 }, mk.confidence) ? mk.confidence + " confidence" : "",
             val: has(VAL_WORD, mk.valuation) ? VAL_WORD[mk.valuation] : "", asof: /^\d{4}-\d\d-\d\d/.test(mk.as_of || "") ? lastText(mk.as_of) : "" };
  }
  // c = plain card data (see readCard). win = "7" | "30" | "90" | "all" (anything else = "30").
  function coverModel(c, win) {
    win = WINS.indexOf(win) >= 0 ? win : "30";
    var name = String(c.name || "SN" + c.sn), len = name.length;
    var size = len <= 12 ? 28 : len <= 24 ? 24 : 20;
    var st = String(c.status || "unclear");
    var heat = Math.max(0, Math.min(5, parseInt(c.h && c.h[win], 10) || 0));
    var count = parseInt(c.c && c.c[win], 10) || 0, c7 = parseInt(c.c && c.c["7"], 10) || 0, c30 = parseInt(c.c && c.c["30"], 10) || 0, call = parseInt(c.c && c.c.all, 10) || 0;
    var f = facts(c), pc = pace(c7, c30), mk = marketModel(c.mk), cm = codeModel(c.code, c.loaded, c.year), sv = f[0].v, lastS = c.last && c.last !== "-" ? String(c.last) : "", short = fmt(count) + " msgs \u00b7 " + WSHORT[win];
    var sent = sv === "na" ? null : { v: sv, label: SENT_LABEL[sv], color: SENT_COLOR[sv] };
    var bars = [["Miner", f[1]], ["Validator", f[2]]].map(function (q) {
      var v = q[1].v;
      return { role: q[0], v: v, level: Object.prototype.hasOwnProperty.call(BAR_LEVEL, v) ? BAR_LEVEL[v] : -1, text: v === "na" ? "n/a" : BARRIER_SHORT[v] };
    });
    var paceSay = "about " + pc.perDay + " a day over 30 days" + (pc.trend ? (pc.trend.dir === 0 ? ", steady over the last 7 days" : ", the last 7 days at " + pc.trend.text.slice(1) + " times that pace") : "");
    var lineSay = fmt(count) + " chat messages " + (win === "all" ? "in all time" : "in the last " + win + " days") + ", " + paceSay + (lastS ? ", last chat " + lastText(lastS) : "");
    var bw = function (q) { return q.v === "na" ? "not recorded" : q.text.toLowerCase(); };
    return {
      key: c.sn + ":" + win, sn: parseInt(c.sn, 10), hue: parseInt(c.hue, 10) || 0, win: win,
      name: name, nameSize: size, nameLines: wrap(name, size === 28 ? 13 : size === 24 ? 15 : 18, size === 20 ? 3 : 2),
      sym: Array.from(String(c.sym || "").trim()).slice(0, 2).join(""), facts: facts(c),   // token symbol ("" on testnet-only subnets: none is drawn)
      cat: String(c.cat || "").slice(0, 40), tagLines: wrap(c.tag || "", 38, 3),   // back face: 3 lines of 11 px (step 7 made room for the chart)
      chart: chartModel(c.price, c.usd, c.net, parseInt(c.sn, 10), c.loaded, c.sym),
      // back face (analysis) and the caption line: sentiment pill, market view words, barrier meters, chat pace
      sent: sent, market: mk, bars: bars, pace: pc, code: cm, short: short, allText: fmt(call), lastText: lastS ? lastText(lastS) : "",
      line: short + " \u00b7 " + pc.perDay + "/day" + (pc.trend ? " \u00b7 " + (pc.trend.dir > 0 ? "\u25b2 " : pc.trend.dir < 0 ? "\u25bc " : "") + pc.trend.text : ""), lineSay: lineSay,
      say: (sent ? "Market view " + sent.label.toLowerCase() + (mk ? ", " + [mk.conf, mk.val].filter(Boolean).join(", ") + (mk.asof ? ", as of " + mk.asof : "") : "") + "." : "No market view yet.") +
           (mk ? " " + mk.text + (/[.!?]$/.test(mk.text) ? "" : ".") : "") + " Miner barrier " + bw(bars[0]) + ", validator barrier " + bw(bars[1]) + ". Chat: " + lineSay + ". " + cm.say,
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
      sym: d.sym, sent: d.sent, bm: d.bm, bv: d.bv,   // data-sym / data-sent / data-bm / data-bv (build.py; "na" = not recorded)
      cat: txt(".cat"), tag: txt(".tag"),
      price: PRICE[d.sn] || null, mk: MARKET[d.sn] || null, code: CODE[d.sn] || null, year: YEAR, usd: USDMETA, loaded: DATA_OK,   // index-data.json (ingest); null / false until it has been read
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

  // chart:begin (pure: a price record from index-data.json -> the two panels of the back face; scripts/covers_check.js extracts and tests this block)
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function r2(v) { return Math.round(v * 100) / 100; }
  // cleanPrice(p): the record's `price` {t: [unix s], tao, usd | null} checked again in the browser: null unless >= 2 points, times strictly increasing, every TAO > 0;
  // usd is kept only with the same length and every value > 0.
  function cleanPrice(p) {
    var n, i;
    if (!p || !Array.isArray(p.t) || !Array.isArray(p.tao) || p.t.length < 2 || p.t.length !== p.tao.length) return null;
    n = p.t.length;
    for (i = 0; i < n; i++) if (!isNum(p.t[i]) || !isNum(p.tao[i]) || !(p.tao[i] > 0) || (i && p.t[i] <= p.t[i - 1])) return null;
    return { t: p.t.slice(), tao: p.tao.slice(), n: n,
             usd: Array.isArray(p.usd) && p.usd.length === n && p.usd.every(function (v) { return isNum(v) && v > 0; }) ? p.usd.slice() : null };
  }
  // cleanLine(l): `usd.line` {t, v} (root card's TAO/USD graph) checked in the browser: null unless >= 2 points, times strictly increasing, every v > 0.
  function cleanLine(l) {
    var n, i;
    if (!l || !Array.isArray(l.t) || !Array.isArray(l.v) || l.t.length < 2 || l.t.length !== l.v.length) return null;
    n = l.t.length;
    for (i = 0; i < n; i++) if (!isNum(l.t[i]) || !isNum(l.v[i]) || !(l.v[i] > 0) || (i && l.t[i] <= l.t[i - 1])) return null;
    return { t: l.t.slice(), v: l.v.slice(), n: n };
  }
  // rootModel: SN 0 has no alpha price, so its chart area is ONE taller TAO/USD panel "\u03c4 / $" (user 2026-10-30: clean, no source / date row). chartModel shape, no `b`, root: true.
  function rootModel(ln, usdMeta) {
    var a = panel(ln.t, ln.v, PLOT.root, "\u03c4", " / $", fmtUsd), span = Math.max(1, Math.round((ln.t[ln.n - 1] - ln.t[0]) / 86400)),
        y0 = civil(ln.t[0])[0], y1 = civil(ln.t[ln.n - 1])[0], c = pct(ln.v[0], ln.v[ln.n - 1]),
        sf = day(ln.t[0]) + (y0 !== y1 ? " " + y0 : ""), st = day(ln.t[ln.n - 1]) + (y0 !== y1 ? " " + y1 : "");
    return { kind: "chart", root: true, sym: "\u03c4", a: a, n: ln.n, span: span, spanText: span + " d", from: span > 300 ? sf : day(ln.t[0]), to: span > 300 ? st : day(ln.t[ln.n - 1]), src: "",
             say: "TAO price " + a.latest + " on " + st + ", " + (c.dir === 0 ? "unchanged" : (c.dir > 0 ? "up " : "down ") + c.n + " percent") + " since " + sf +
                  " (TAO/USD from " + ((usdMeta && usdMeta.source) || "an unnamed source") + ")." };
  }
  function sig3(v) { return v < 1e-4 ? v.toExponential(2) : String(Number(v.toPrecision(3))); }   // 0.0674, 0.0046, 1.23, 12.3, 1230
  function fmtTao(v) { return sig3(v); }
  function fmtUsd(v) { return "$" + (v >= 1000 ? fmt(Math.round(v)) : v >= 1 ? v.toFixed(2) : sig3(v)); }   // $17.31, $1,235, $0.0467
  // pct(a, b): change from a to b as { dir: 1 | 0 | -1, n: "0.5" } (one decimal below 10 %, none above)
  function pct(a, b) {
    var c = (b / a - 1) * 100, r = Math.abs(c) < 10 ? Math.round(c * 10) / 10 : Math.round(c);
    return { dir: r > 0 ? 1 : r < 0 ? -1 : 0, n: fmt(Math.abs(r)) };
  }
  function fmtPct(a, b) { var c = pct(a, b); return c.dir === 0 ? "0%" : (c.dir > 0 ? "+" : "\u2212") + c.n + "%"; }
  // civil(t): unix seconds -> [year, month 1..12, day] in UTC by integer day arithmetic (no Date: covers stay time-independent and reproducible)
  function civil(t) {
    var z = Math.floor(t / 86400) + 719468, era = Math.floor(z / 146097), doe = z - era * 146097,
        yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365),
        doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153),
        m = mp < 10 ? mp + 3 : mp - 9;
    return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1];
  }
  function day(t) { var c = civil(t); return c[2] + " " + MONTHS[c[1] - 1]; }
  // panel(ts, vs, box, sym, unit, f): one sparkline; label = token symbol + unit ("<sym> / \u03c4" alpha per TAO, "<sym> / $" alpha per USD) in two parts, so the canvas draws the
  // symbol in its own font and direction (Hebrew / Arabic must not reorder against the slash). x by TIME over PLOT.x0..x1, y from the minimum (bottom) to the maximum (top) in box,
  // 1.5 px inset, a flat series = a middle line. latest / hi / lo = the printed numbers (f formats).
  function panel(ts, vs, box, sym, unit, f) {
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), t0 = ts[0], t1 = ts[ts.length - 1], top = box[0] + 1.5, bot = box[1] - 1.5, pts = [], i;
    for (i = 0; i < vs.length; i++) {
      pts.push([r2(PLOT.x0 + (PLOT.x1 - PLOT.x0) * (ts[i] - t0) / (t1 - t0)), r2(hi === lo ? (top + bot) / 2 : bot - (bot - top) * (vs[i] - lo) / (hi - lo))]);
    }
    return { label: sym + unit, sym: sym, unit: unit, box: box, pts: pts, last: pts[pts.length - 1], latest: f(vs[vs.length - 1]), hi: f(hi), lo: f(lo),
             change: fmtPct(vs[0], vs[vs.length - 1]), flat: hi === lo };
  }
  // chartModel(price, usdMeta, net, sn, loaded, sym): what the front face shows in the chart area. kind "chart" (panels a and b; root: true = ONE TAO/USD panel from usdMeta.line; b = null without
  // alpha/USD) or "none" (note = the reason, drawn in a dashed box). say = the same as a sentence for the screen-reader announcement (flowui.js).
  // net = the card's data-net ("main" | "test"), loaded = index-data.json was read, sym = the subnet's token symbol (alpha when it has none).
  // The panel labels read "<sym> / \u03c4" and "<sym> / $"; the sentence (say) keeps the words, a screen reader cannot speak those glyphs.
  function chartModel(price, usdMeta, net, sn, loaded, sym) {
    var p = cleanPrice(price), a, b, c, span, from, to, y0, y1, sf, st, note, src, say, out, ln, sy = String(sym || "").trim() || "\u03b1";
    if (!p && sn === 0 && (ln = cleanLine(usdMeta && usdMeta.line))) return rootModel(ln, usdMeta);   // root: TAO/USD graph, not the note
    if (!p) {
      note = sn === 0 ? "Root network: no alpha price" : net === "test" ? "Testnet only: no alpha price" : loaded ? "No price series saved yet" : "Price data not loaded";
      return { kind: "none", note: note, say: note + "." };
    }
    a = panel(p.t, p.tao, PLOT.a, sy, " / \u03c4", fmtTao);
    b = p.usd ? panel(p.t, p.usd, PLOT.b, sy, " / $", fmtUsd) : null;
    span = Math.max(1, Math.round((p.t[p.n - 1] - p.t[0]) / 86400));
    y0 = civil(p.t[0])[0]; y1 = civil(p.t[p.n - 1])[0];
    sf = day(p.t[0]) + (y0 !== y1 ? " " + y0 : ""); st = day(p.t[p.n - 1]) + (y0 !== y1 ? " " + y1 : "");   // the sentence keeps the years
    from = span > 300 ? sf : day(p.t[0]); to = span > 300 ? st : day(p.t[p.n - 1]);   // from / to / src: model only (the cover draws no date row), say keeps the dates; years only over 300 d
    src = b ? "TAO/USD: " + ((usdMeta && usdMeta.source) || "source n/a") : "";
    c = pct(p.tao[0], p.tao[p.n - 1]);
    say = "Alpha price " + a.latest + " TAO on " + st + ", " + (c.dir === 0 ? "unchanged" : (c.dir > 0 ? "up " : "down ") + c.n + " percent") + " since " + sf +
          (b ? ", about " + b.latest + " (TAO/USD from " + ((usdMeta && usdMeta.source) || "an unnamed source") + ")" : ", no USD line (no TAO/USD data)") + ".";
    out = { kind: "chart", sym: sy, a: a, n: p.n, span: span, spanText: span + " d", from: from, to: to, src: src, say: say };
    if (b) out.b = b;   // no key (not null) without alpha/USD
    return out;
  }
  // chart:end

  // draw:begin (needs only a 2D context: scripts/covers_check.js runs it against a recording stub)
  var FONT = '"Inter","Inter Fallback",system-ui,sans-serif';
  // token symbols span 17 scripts: Inter has Latin + Greek, the self-hosted "Bittensor Symbols" subset (style.css) the rest (as the grid card's .sym).
  var SYMFONT = '"Inter","Bittensor Symbols","Inter Fallback",system-ui,sans-serif';
  function setFont(ctx, w, s, fam) { ctx.font = w + " " + s + "px " + (fam || FONT); }
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
  // text cut to maxW with an ellipsis (ctx.font is already set to the size that is used)
  function ellipsize(ctx, t, maxW) {
    var n = t.length;
    if (ctx.measureText(t).width <= maxW) return t;
    while (n > 1 && ctx.measureText(t.slice(0, n) + "\u2026").width > maxW) n--;
    return t.slice(0, n).replace(/\s+$/, "") + "\u2026";
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function dashedBox(ctx, x, y, w, h) {
    rr(ctx, x, y, w, h, 8); ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // panel label: the symbol alone, left-to-right, in the symbol font, then the unit
  function drawLabel(ctx, sym, unit, x, y, color) {
    var w;
    setFont(ctx, "600", 10, SYMFONT); ctx.direction = "ltr"; text(ctx, sym, x, y, color); w = ctx.measureText(sym).width;
    setFont(ctx, "600", 10); text(ctx, unit, x + w, y, color); w += ctx.measureText(unit).width;
    ctx.direction = "inherit";
    return w;
  }
  // one sparkline: title row (label, change over the span, latest value), the line with a faint area, an end dot, the axis range at the right
  function drawPanel(ctx, P, span, col, p) {
    var top = P.box[0], bot = P.box[1], i, w;
    w = drawLabel(ctx, P.sym, P.unit, 16, top - 5, rgbHex(p.dim));
    setFont(ctx, "500", 10); text(ctx, P.change + " in " + span, 16 + w + 6, top - 5, rgbHex(p.dim));
    setFont(ctx, "700", 12); text(ctx, P.latest, 240, top - 5, rgbHex(p.ink), "right");
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(PLOT.x0, bot + 1, PLOT.x1 - PLOT.x0, 1);
    ctx.beginPath(); ctx.moveTo(P.pts[0][0], bot + 1);
    for (i = 0; i < P.pts.length; i++) ctx.lineTo(P.pts[i][0], P.pts[i][1]);
    ctx.lineTo(P.last[0], bot + 1); ctx.closePath(); ctx.fillStyle = rgba(col, 0.16); ctx.fill();
    ctx.beginPath(); ctx.moveTo(P.pts[0][0], P.pts[0][1]);
    for (i = 1; i < P.pts.length; i++) ctx.lineTo(P.pts[i][0], P.pts[i][1]);
    ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.strokeStyle = rgbHex(col); ctx.stroke();
    ctx.beginPath(); ctx.arc(P.last[0], P.last[1], 2.4, 0, Math.PI * 2); ctx.fillStyle = rgbHex(col); ctx.fill();
    setFont(ctx, "500", 9); text(ctx, P.hi, 240, top + 8, rgbHex(p.dim), "right"); text(ctx, P.lo, 240, bot, rgbHex(p.dim), "right");
  }
  // front face (it was the back face before the swap): header (SN + token symbol, status), name, category, 3 tagline lines, the chart area
  // (two panels, or a dashed note), chat counts per window
  function drawFront(ctx, m, p) {
    var g = ctx.createLinearGradient(0, 0, 0, 256), i, x, w, s, ch = m.chart, lines, sw, mt, sp;
    g.addColorStop(0, rgbHex(p.deep)); g.addColorStop(1, rgbHex(p.base));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = rgbHex(p.acc); ctx.fillRect(0, 0, 256, 5);
    ctx.textBaseline = "alphabetic";
    setFont(ctx, "700", 20); text(ctx, "SN " + m.sn, 16, 31, rgbHex(p.acc)); sw = ctx.measureText("SN " + m.sn).width;
    setFont(ctx, "600", 11); w = ctx.measureText(m.statusLabel).width;
    text(ctx, m.statusLabel, 240, 30, rgbHex(p.ink), "right");
    ctx.beginPath(); ctx.arc(240 - w - 8, 26.5, 3.5, 0, Math.PI * 2); ctx.fillStyle = m.statusColor; ctx.fill();
    if (m.sym) {   // "SN 64 + symbol": same ink and weight as the SN, centred on its digits, scaled down to the room before the status dot (symPlace); none on testnet-only
      x = 16 + sw + 10;
      setFont(ctx, "700", 24, SYMFONT);
      ctx.direction = "ltr";   // Hebrew / Arabic marks must not reorder against the SN
      mt = ctx.measureText(m.sym);
      sp = symPlace({ width: mt.width, asc: mt.actualBoundingBoxAscent, desc: mt.actualBoundingBoxDescent }, 24, x, SN_CY, 240 - w - 8 - 3.5 - 12 - x, 26);
      setFont(ctx, "700", sp.size, SYMFONT); text(ctx, m.sym, sp.x, sp.y, rgbHex(p.acc));
      ctx.direction = "inherit";
    }
    fit(ctx, m.name, "600", 15, 224, 11); text(ctx, ellipsize(ctx, m.name, 224), 16, 50, rgbHex(p.ink));   // a placeholder name can be 60 characters: cut, never overflow
    if (m.cat) { fit(ctx, m.cat, "500", 11, 224, 9); text(ctx, m.cat, 16, 65, rgbHex(p.dim)); }
    lines = m.tagLines;
    s = fit(ctx, lines.reduce(function (a, b) { return a.length >= b.length ? a : b; }, ""), "400", 11, 224, 9);
    setFont(ctx, "400", s);
    for (i = 0; i < lines.length; i++) text(ctx, lines[i], 16, 83 + i * 13, rgbHex(p.ink));
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(16, 117, 224, 1);
    if (ch.kind === "chart") {
      drawPanel(ctx, ch.a, ch.spanText, p.acc, p);
      if (ch.b) drawPanel(ctx, ch.b, ch.spanText, p.ink, p);
      else if (!ch.root) {
        dashedBox(ctx, 16, 164, 224, 38);
        drawLabel(ctx, ch.sym, " / $", 28, 180, rgbHex(p.dim));
        setFont(ctx, "500", 10); text(ctx, "no TAO/USD data, line left out", 28, 194, rgbHex(p.dim));
      }
    } else {
      dashedBox(ctx, 16, 124, 224, 84);
      fit(ctx, ch.note, "600", 12, 200, 9); text(ctx, ch.note, 128, 170, rgbHex(p.dim), "center");
    }
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(16, 218, 224, 1);
    for (i = 0; i < m.nums.length; i++) {
      x = 16 + i * 56;
      setFont(ctx, "500", 9); text(ctx, m.nums[i].label, x, 230, rgbHex(p.dim));
      s = fit(ctx, m.nums[i].text, "700", 14, 52, 10); setFont(ctx, "700", s);
      text(ctx, m.nums[i].text, x, 245, m.nums[i].on ? rgbHex(p.acc) : rgbHex(p.ink));
    }
  }
  // barrier meter: 3 segments, `lvl` filled (0 = none); lvl < 0 (unknown / not recorded) = dashed outlines
  function meter(ctx, x, y, lvl, p) {
    var i;
    for (i = 0; i < 3; i++) {
      if (lvl < 0) { ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(x + i * 28 + 0.5, y + 0.5, 23, 6); ctx.setLineDash([]); }
      else { ctx.fillStyle = i < lvl ? rgbHex(p.acc) : "rgba(255,255,255,0.25)"; ctx.fillRect(x + i * 28, y, 24, 7); }
    }
  }
  // back face (analysis): SN + network, name, sentiment pill + confidence + valuation, market headline (4 lines), barrier meters, chat activity (heat bar, count,
  // per day, 7 d vs the 30 d pace, last chat, total), then code activity (pace chip, code commits in 30 d, last commit, last release)
  function drawBack(ctx, m, p) {
    var g = ctx.createLinearGradient(0, 0, 0, 256), i, x, w, s = m.sent, mk = m.market, t = m.pace.trend, b, lines, c = m.code, ink = rgbHex(p.ink), dim = rgbHex(p.dim), line = "rgba(255,255,255,0.18)";
    g.addColorStop(0, rgbHex(p.deep)); g.addColorStop(1, rgbHex(p.base));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = rgbHex(p.acc); ctx.fillRect(0, 0, 256, 5);
    ctx.textBaseline = "alphabetic";
    setFont(ctx, "700", 20); text(ctx, "SN " + m.sn, 16, 31, rgbHex(p.acc));
    setFont(ctx, "600", 11); text(ctx, m.net.toUpperCase(), 240, 30, dim, "right");
    fit(ctx, m.name, "600", 15, 224, 11); text(ctx, ellipsize(ctx, m.name, 224), 16, 50, ink);   // a placeholder name can be 60 characters: cut, never overflow
    if (s) {
      setFont(ctx, "700", 14); w = ctx.measureText(s.label).width + 24;
      rr(ctx, 16, 56, w, 24, 12); ctx.fillStyle = rgba(hexRgb(s.color), 0.18); ctx.fill(); ctx.strokeStyle = s.color; ctx.lineWidth = 1.2; ctx.stroke();
      text(ctx, s.label, 28, 73, s.color);
      if (mk) {
        x = 16 + w + 10; setFont(ctx, "500", 10);
        if (mk.conf) text(ctx, mk.conf, x, 65, dim); if (mk.val) text(ctx, mk.val, x, 78, dim);
      }
    } else { dashedBox(ctx, 16, 56, 224, 24); setFont(ctx, "600", 11); text(ctx, "No market view yet", 28, 72, dim); }
    lines = mk ? mk.lines : m.tagLines;   // without a market view the tagline fills the gap (dim: it is not analysis)
    if (lines.length) {
      setFont(ctx, "400", fit(ctx, lines.reduce(function (a, c) { return a.length >= c.length ? a : c; }, ""), "400", 11, 224, 9));
      for (i = 0; i < lines.length; i++) text(ctx, lines[i], 16, 94 + i * 12, mk ? ink : dim);
    }
    ctx.fillStyle = line; ctx.fillRect(16, 136, 224, 1);
    for (i = 0; i < 2; i++) {
      b = m.bars[i];
      setFont(ctx, "600", 11); text(ctx, b.role + " barrier", 16, 151 + i * 15, dim);
      meter(ctx, 108, 143 + i * 15, b.level, p);
      fit(ctx, b.text, "700", 11, 44, 9); text(ctx, b.text, 196, 151 + i * 15, ink);
    }
    ctx.fillStyle = line; ctx.fillRect(16, 173, 224, 1);
    for (i = 0; i < 5; i++) { ctx.fillStyle = i < m.heat ? ink : "rgba(255,255,255,0.25)"; ctx.fillRect(16 + i * 18, 180, 14, 7); }
    fit(ctx, m.short, "700", 12, 140, 9); text(ctx, m.short, 240, 188, ink, "right");
    setFont(ctx, "500", 10); text(ctx, m.pace.perDay + " / day \u00b7 30 d", 16, 201, dim);
    if (t) {
      setFont(ctx, "600", 10); w = ctx.measureText(t.text).width; text(ctx, t.text, 240, 201, ink, "right");
      x = 240 - w - 5;
      if (t.dir) {
        ctx.beginPath();
        if (t.dir > 0) { ctx.moveTo(x - 4, 193); ctx.lineTo(x - 8, 200); ctx.lineTo(x, 200); } else { ctx.moveTo(x - 8, 193); ctx.lineTo(x, 193); ctx.lineTo(x - 4, 200); }
        ctx.closePath(); ctx.fillStyle = t.dir > 0 ? SENT_COLOR.bullish : SENT_COLOR.bearish; ctx.fill(); x -= 12;
      }
      setFont(ctx, "500", 10); text(ctx, "7 d", x, 201, dim, "right");
    }
    setFont(ctx, "500", 10); text(ctx, m.lastText ? "last chat " + m.lastText : "no chat yet", 16, 214, dim); text(ctx, m.allText + " total", 240, 214, dim, "right");
    ctx.fillStyle = line; ctx.fillRect(16, 219, 224, 1);
    if (c.note) { dashedBox(ctx, 16, 223, 224, 24); setFont(ctx, "600", 11); text(ctx, c.note, 28, 239, dim); return; }
    setFont(ctx, "700", 10); w = ctx.measureText(c.word).width + 16;
    rr(ctx, 16, 223, w, 15, 7.5); ctx.fillStyle = rgba(hexRgb(c.color), 0.18); ctx.fill(); ctx.strokeStyle = c.color; ctx.lineWidth = 1; ctx.stroke();
    text(ctx, c.word, 24, 234, c.color);
    fit(ctx, c.head, "700", 11, 140, 9); text(ctx, c.head, 240, 234, ink, "right");
    setFont(ctx, "500", 10); text(ctx, c.last, 16, 247, dim); text(ctx, c.rel, 240, 247, dim, "right");
  }
  function drawCover(ctx, m, face, p) {
    if (face === "back") drawBack(ctx, m, p); else drawFront(ctx, m, p);
    if (m.pending) { ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.strokeRect(6, 6, 244, 244); ctx.setLineDash([]); }
  }
  // draw:end

  // ---- browser side (not unit-tested; scripts/covers_snapshot.js-style checks in a real browser belong to X12) ----
  var fontsP = null, dataP = null;
  // ingest(doc): index-data.json (parsed or null) -> PRICE / MARKET / CODE / USDMETA / DATA_OK / YEAR. Never throws; an unusable file leaves out only what it feeds.
  function ingest(d) {
    var i, r;
    PRICE = {}; MARKET = {}; CODE = {}; USDMETA = null; DATA_OK = false; YEAR = "";
    if (d && Array.isArray(d.subnets)) {
      DATA_OK = true; YEAR = typeof d.built === "string" ? d.built.slice(0, 4) : "";
      USDMETA = d.usd && typeof d.usd === "object" ? d.usd : null;
      for (i = 0; i < d.subnets.length; i++) { r = d.subnets[i]; if (r && r.price && cleanPrice(r.price)) PRICE[r.sn] = r.price; if (r && r.market && typeof r.market.headline === "string") MARKET[r.sn] = r.market; if (r && r.code && typeof r.code === "object") CODE[r.sn] = r.code; }
    }
    return true;
  }
  function loadData() {   // once, with the fonts: covers drawn before it would stay in the pool without their chart
    if (!dataP) {
      dataP = (typeof fetch === "function" ? fetch("index-data.json").then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null))
        .then(ingest, function () { return ingest(null); });
    }
    return dataP;
  }
  function symbols() {   // every distinct token symbol in the card list, as one string
    var seen = {}, out = "", els = document.querySelectorAll("[data-sym]"), i, v;
    for (i = 0; i < els.length; i++) { v = els[i].getAttribute("data-sym"); if (v && !seen[v]) { seen[v] = 1; out += v; } }
    return out;
  }
  function ready() {
    if (!fontsP) {
      var f = document.fonts, st = symbols();
      var load = function (w) { return f && f.load ? f.load(w + " 1em Inter") : Promise.resolve(); };
      // the symbols: unicode-range faces load only for the characters asked for, so ask for every symbol the cards carry (a cover drawn before
      // that would show a fallback box and stay in the pool)
      var loadSym = function (fam) { return f && f.load && st ? f.load("700 1em " + fam, st) : Promise.resolve(); };
      fontsP = Promise.all([load("600"), load("700"), load("400"), loadSym("Inter"), loadSym('"Bittensor Symbols"'), loadData()]).then(function () { return true; }, function () { return true; });
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
    ctx.scale(COVER / GRID, COVER / GRID);
    drawCover(ctx, m, face, palette(accentOf(card)));
    pool.set(key, cv);
    return cv;
  }
  ready().then(function () { isReady = true; });
  var api = {
    SIZE: COVER, CAP: POOL_CAP, ready: ready, cover: cover, model: coverModel, read: readCard, palette: palette, wrap: wrap,
    onRelease: function (fn) { released.push(fn); }, has: function (sn, face, win) { return pool.has(sn + ":" + face + ":" + win); },
    isReady: function () { return isReady; }, chart: chartModel, clean: cleanPrice,
    prices: function () { return { ok: DATA_OK, n: Object.keys(PRICE).length, usd: USDMETA }; }
  };
  var F = window.__flow = window.__flow || {};
  F.covers = api;
  Object.defineProperty(F, "stats", { configurable: true, enumerable: true, get: function () { return pool.stats; } });
  window.FlowCovers = api;
})();
