/* flow.js - Cover Flow renderer (INDEX-ROADMAP.md X9). Raw WebGL1, no library (D2): one shader, one quad, a mirrored reflection,
   an always dark stage (D6). Covers come from covers.js through opts.source. Render on demand: requestAnimationFrame runs only
   while the position moves or textures are queued, never when idle or hidden. No input, no DOM beyond the canvas: flowui.js (X10) adds that,
   X11 the fallbacks (create() returns null when WebGL cannot start). Pure block tested by scripts/flow_check.js: geo:begin..geo:end. */
(function () {
  "use strict";

  // geo:begin (pure: geometry, spring, matrices, draw list)
  var G = { ANGLE: 65 * Math.PI / 180, FOV: 35, SIDE0: 0.9, STEP: 0.24, ZSIDE: 1.05, FALL: 0.13, MINSHADE: 0.32, REACH: 6, REFL: 0.45,
            DIST: 1.76, FIT: 1.3, LIFT: 0.02, NEAR: 0.1, FAR: 30, OMEGA: 16 };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t * t * (3 - 2 * t); }
  // off = cover index - position. Side covers turn about Y (face to the centre), sit back, bunch up (STEP) and dim with distance.
  function layout(off) {
    var a = Math.abs(off), s = off < 0 ? -1 : 1, e = ease(Math.min(a, 1));
    return { off: off, x: s * (G.SIDE0 * e + Math.max(0, a - 1) * G.STEP), z: -G.ZSIDE * e, rot: -s * G.ANGLE * e,
             shade: Math.max(G.MINSHADE, 1 - G.FALL * a) };
  }
  // covers within REACH of pos, FAR to NEAR (painter's order, there is no depth buffer); ties: lower index first
  function drawList(pos, n) {
    var out = [], lo = Math.max(0, Math.ceil(pos - G.REACH)), hi = Math.min(n - 1, Math.floor(pos + G.REACH)), i, L;
    for (i = lo; i <= hi; i++) { L = layout(i - pos); L.i = i; out.push(L); }
    return out.sort(function (p, q) { return Math.abs(q.off) - Math.abs(p.off) || p.i - q.i; });
  }
  // exact critically damped spring step: no overshoot, stable for any dt -> [position, velocity]
  function spring(p, v, t, w, dt) {
    var x = p - t, e = Math.exp(-w * dt), k = (v + w * x) * dt;
    return [t + (x + k) * e, (v - w * k) * e];
  }
  // one frame of motion -> [position, velocity, moving]; snaps to the target once it is close and slow
  function step(p, v, t, dt) {
    if (p === t && v === 0) return [p, 0, false];
    var s = spring(p, v, t, G.OMEGA, dt);
    return Math.abs(s[0] - t) < 0.002 && Math.abs(s[1]) < 0.02 ? [t, 0, false] : [s[0], s[1], true];
  }
  // camera distance: grows on narrow stages so the centre cover (width 1) keeps FIT widths of room
  function dist(aspect) { return Math.max(G.DIST, G.FIT / (2 * Math.tan(G.FOV * Math.PI / 360) * aspect)); }
  function persp(fov, aspect, n, f) {   // column-major 4x4 matrices from here on
    var c = 1 / Math.tan(fov * Math.PI / 360), r = 1 / (n - f);
    return [c / aspect, 0, 0, 0, 0, c, 0, 0, 0, 0, (f + n) * r, -1, 0, 0, 2 * f * n * r, 0];
  }
  function mul(a, b) {
    var o = [], r, c, k, s;
    for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) { for (s = k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o;
  }
  // translate * rotateY * scale(1, sy, 1); the unit cover spans -0.5..0.5
  function model(x, y, z, rot, sy) {
    var c = Math.cos(rot), s = Math.sin(rot);
    return [c, 0, -s, 0, 0, sy, 0, 0, s, 0, c, 0, x, y, z, 1];
  }
  function viewProj(aspect) {
    return mul(persp(G.FOV, aspect, G.NEAR, G.FAR), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, G.LIFT, -dist(aspect), 1]);
  }
  function project(m, x, y, z) {   // -> [ndc x, ndc y, w]
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, w];
  }
  // false only when the whole cover is off the left or right edge (both ends of the turned cover are projected)
  function onScreen(vp, L) {
    var c = Math.cos(L.rot) / 2, s = Math.sin(L.rot) / 2, p = project(vp, L.x - c, 0, L.z + s), q = project(vp, L.x + c, 0, L.z - s);
    return p[2] > 0 && q[2] > 0 && Math.max(p[0], q[0]) > -1 && Math.min(p[0], q[0]) < 1;
  }
  // which cover is under the pointer (ndc nx, ny)? nearest to the viewer first, using each cover's real turned edges; -1 = none
  function pick(vp, pos, n, nx, ny) {
    var list = drawList(pos, n), i, L, c, s, a, b, t, u;
    for (i = list.length - 1; i >= 0; i--) {
      L = list[i]; c = Math.cos(L.rot) / 2; s = Math.sin(L.rot) / 2;
      a = project(vp, L.x - c, 0, L.z + s)[2] > 0 && project(vp, L.x - c, 0.5, L.z + s);
      b = project(vp, L.x + c, 0, L.z - s)[2] > 0 && project(vp, L.x + c, -0.5, L.z - s);
      if (!a || !b) continue;
      t = project(vp, L.x, 0.5, L.z)[1]; u = project(vp, L.x, -0.5, L.z)[1];
      if (nx >= Math.min(a[0], b[0]) && nx <= Math.max(a[0], b[0]) && ny >= Math.min(t, u) && ny <= Math.max(t, u)) return L.i;
    }
    return -1;
  }
  // geo:end

  var STAGE = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], UPLOADS = 3;   // textures uploaded per frame at most
  var VS = "attribute vec2 aP;uniform mat4 uM;varying vec2 vT;void main(){vT=aP+0.5;gl_Position=uM*vec4(aP,0.0,1.0);}";
  var FS = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 vT;uniform sampler2D uS;uniform float uK,uR,uMode;void main(){" +
    "if(uMode>1.5){vec3 c=mix(vec3(0.07,0.08,0.20),vec3(0.008,0.010,0.030),smoothstep(0.0,0.85,vT.y));" +
    "c+=(fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))-0.5)/255.0;gl_FragColor=vec4(c,1.0);return;}" +
    "vec4 t=texture2D(uS,vT);float a=1.0;if(uMode>0.5)a=uR*(1.0-smoothstep(0.0,0.6,vT.y));gl_FragColor=vec4(t.rgb*uK,a);}";
  var Flow = window.FlowRenderer = { error: "", create: create, geo: { G: G, layout: layout, drawList: drawList, spring: spring, step: step,
    dist: dist, persp: persp, mul: mul, model: model, viewProj: viewProj, project: project, onScreen: onScreen, pick: pick } };

  // create(canvas, {count, source(i) -> {key, canvas} | null (not ready: asked again soon), onLost, onRestored}) -> renderer | null
  function create(canvas, o) {
    o = o || {};
    var gl, prog, buf, ph, uM, uK, uR, uMode, ext, tex = {}, n = o.count | 0, pos = 0, vel = 0, target = 0, raf = 0, retry = 0, last = 0;
    var fp = 0, fv = 0, ft = 0, fi = -1, lc = -1;   // flip of cover fi: 0 front .. 1 back (spring), lc = last centre reported
    var lost = false, dead = false, ro = null, doc = window.document, stats = { frames: 0, uploads: 0, raf: 0, live: 0, lost: false };
    try {
      gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: false, stencil: false });
      if (!gl) throw new Error("no webgl");
      build();
    } catch (e) { Flow.error = String(e && e.message || e); return null; }

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    }
    function tparams(mip) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function build() {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
      gl.useProgram(prog);
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
      var a = gl.getAttribLocation(prog, "aP");
      gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      uM = gl.getUniformLocation(prog, "uM"); uK = gl.getUniformLocation(prog, "uK"); uR = gl.getUniformLocation(prog, "uR");
      uMode = gl.getUniformLocation(prog, "uMode");
      gl.uniform1i(gl.getUniformLocation(prog, "uS"), 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      ext = gl.getExtension("EXT_texture_filter_anisotropic");
      ph = gl.createTexture();   // 1x1 stand-in until a cover's own texture is uploaded
      gl.bindTexture(gl.TEXTURE_2D, ph);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([34, 38, 70, 255]));
      tparams(false);
    }
    function upload(src) {   // 256x256 (power of two, so WebGL1 may mipmap it)
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      tparams(true);
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    }
    function drop(k) { if (tex[k]) { if (!lost) gl.deleteTexture(tex[k]); delete tex[k]; stats.live--; } }

    // one frame at the current position -> 0 done, 1 more uploads queued (next frame), 2 a cover is not ready yet
    function draw(maxUp) {
      var w = canvas.width, h = canvas.height, vp = viewProj(w / h), list = drawList(pos, n), up = 0, rc = 0, i, L, it, t, rot, back, a;
      gl.viewport(0, 0, w, h);
      gl.uniform1f(uMode, 2); gl.uniformMatrix4fv(uM, false, STAGE); gl.bindTexture(gl.TEXTURE_2D, ph);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      for (i = 0; i < list.length; i++) {
        L = list[i];
        if (!onScreen(vp, L)) continue;
        rot = L.rot; back = false;
        if (L.i === fi && fp > 0) { a = fp * Math.PI; back = a > Math.PI / 2; rot += back ? a - Math.PI : a; }   // past 90 deg: back face, unmirrored
        it = o.source ? o.source(L.i, back) : null;
        t = ph;
        if (!it) rc |= 2;
        else if (tex[it.key]) t = tex[it.key];
        else if (up < maxUp) { t = tex[it.key] = upload(it.canvas); up++; stats.uploads++; stats.live++; }
        else rc |= 1;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1f(uK, L.shade); gl.uniform1f(uR, G.REFL * L.shade);
        gl.uniform1f(uMode, 1);   // reflection: the cover mirrored under its bottom edge, fading out
        gl.uniformMatrix4fv(uM, false, mul(vp, model(L.x, -1, L.z, rot, -1)));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.uniform1f(uMode, 0);
        gl.uniformMatrix4fv(uM, false, mul(vp, model(L.x, 0, L.z, rot, 1)));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      stats.frames++;
      return rc;
    }
    function request() {
      if (raf || dead || lost || doc.hidden) return;
      stats.raf++;
      raf = window.requestAnimationFrame(frame);
    }
    function frame(ts) {
      raf = 0;
      if (dead || lost || doc.hidden) return;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60, s = step(pos, vel, target, dt), f = step(fp, fv, ft, dt), rc;
      last = ts; pos = s[0]; vel = s[1]; fp = f[0]; fv = f[1];
      ctr();
      rc = draw(UPLOADS);
      if (s[2] || f[2] || rc & 1) request(); else last = 0;
      if (rc & 2 && !retry) retry = window.setTimeout(function () { retry = 0; request(); }, 150);
    }
    function ctr() {   // tell the page when the centre cover changes (caption, un-flip)
      var c = clamp(Math.round(pos), 0, Math.max(0, n - 1));
      if (c !== lc) { lc = c; if (o.onCenter) o.onCenter(c); }
    }
    function resize() {
      var d = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(canvas.clientWidth * d)), h = Math.max(1, Math.round(canvas.clientHeight * d));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      request();
    }
    function onVis() { request(); }
    function onLost(e) {
      e.preventDefault(); lost = true; stats.lost = true; tex = {}; stats.live = 0; last = 0;
      if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
      if (o.onLost) o.onLost();
    }
    function onRestored() {
      try { build(); } catch (e) { Flow.error = String(e && e.message || e); return; }
      lost = false; stats.lost = false; resize();
      if (o.onRestored) o.onRestored();
    }
    canvas.addEventListener("webglcontextlost", onLost, false);
    canvas.addEventListener("webglcontextrestored", onRestored, false);
    doc.addEventListener("visibilitychange", onVis, false);
    if (window.ResizeObserver) { ro = new window.ResizeObserver(resize); ro.observe(canvas); }

    var api = window.__flow = window.__flow || {}, r = api.render = {
      stats: stats, resize: resize, release: drop,   // release(key): covers.js evicted that cover, free its texture
      setCount: function (c) { n = Math.max(0, c | 0); target = clamp(target, 0, Math.max(0, n - 1)); pos = clamp(pos, 0, Math.max(0, n - 1)); ctr(); request(); },
      // setTarget(i, jump, v): spring to cover i, or jump to it; v = starting speed in covers per second
      setTarget: function (i, jump, v) {
        target = clamp(Math.round(i) || 0, 0, Math.max(0, n - 1));
        if (jump) { pos = target; vel = 0; ctr(); } else if (isFinite(v)) vel = v;
        request();
      },
      setPosition: function (p) { if (isFinite(p)) { pos = target = p; vel = 0; ctr(); request(); } },   // while dragging
      setFlip: function (i, on, now) { if (i !== fi) { fp = fv = 0; fi = i; } ft = on ? 1 : 0; if (now) { fp = ft; fv = 0; } request(); },   // turn cover i over (back face) or back; now = no animation (reduced motion)
      flipped: function () { return ft ? fi : -1; },
      pick: function (cx, cy) {   // client pixels -> cover index under them, or -1
        var b = canvas.getBoundingClientRect();
        return b.width > 0 && b.height > 0 ? pick(viewProj(canvas.width / canvas.height), pos, n, (cx - b.left) / b.width * 2 - 1, 1 - (cy - b.top) / b.height * 2) : -1;
      },
      position: function () { return pos; },
      center: function () { return clamp(Math.round(pos), 0, Math.max(0, n - 1)); },
      still: function (i) { pos = target = clamp(i | 0, 0, Math.max(0, n - 1)); vel = 0; ctr(); return draw(1e9); },   // one synchronous frame (X12); ctr() keeps the caption on the centre
      destroy: function () {
        dead = true; if (raf) window.cancelAnimationFrame(raf); if (retry) window.clearTimeout(retry);
        raf = retry = 0;
        canvas.removeEventListener("webglcontextlost", onLost, false);
        canvas.removeEventListener("webglcontextrestored", onRestored, false);
        doc.removeEventListener("visibilitychange", onVis, false);
        if (ro) ro.disconnect();
        if (!lost) { Object.keys(tex).forEach(drop); gl.deleteTexture(ph); gl.deleteBuffer(buf); gl.deleteProgram(prog); }
        tex = {}; stats.live = 0;
      }
    };
    resize();
    return r;
  }
})();
