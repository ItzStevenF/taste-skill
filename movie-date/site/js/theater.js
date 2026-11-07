// The opening shot.
//
// A single photograph of the theater is turned into 3D: every pixel of the empty-seat plate gets
// a depth from a depth map, and a grid mesh is built from it. The couple is a second, cut-out
// mesh with its own depth. A perspective camera then really travels through the room, so each
// row of seats slides under the lens at its own speed, the couple passes out of the bottom of the
// frame, and the screen grows until it fills the display. "Loading a movie date…" is drawn into a
// texture that lives on the screen surface itself.

const NEAR = 0.04;
const FAR = 60;
const FOCAL = 1600;            // focal length in image pixels (portrait frame 1536 × 2752)
// The couple is one plane at the depth of their own seat backs (depth 1), so they move as one with
// their row and never reveal body we have no picture of. Nothing nearer ever crosses in front of
// them on this camera path (the camera rises, nearer rows fall away below), so the layer is drawn
// on top without a depth test and its edge is exactly the photograph's.
const COUPLE_Z = 1.0;
// Where her ring would catch the projector's first light (master image pixels).
const GLINT = { x: 738, y: 1786 };

export async function createTheater(canvas, { base = './', fontFamily = 'serif', onLost = () => {} } = {}) {
  const scene = await (await fetch(`${base}scene/scene.json`)).json();
  const gl2 = canvas.getContext('webgl2', ctxOptions());
  const gl = gl2 || canvas.getContext('webgl', ctxOptions()) || canvas.getContext('experimental-webgl', ctxOptions());
  if (!gl) throw new Error('WebGL unavailable');
  // iOS may take the GPU back under memory pressure; the director then cuts to the title card.
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; onLost(); }, { once: true });
  const isGL2 = !!gl2;
  if (!isGL2 && !gl.getExtension('OES_element_index_uint')) throw new Error('32-bit indices unavailable');
  if (!isGL2) gl.getExtension('OES_standard_derivatives');

  const [theaterImg, coupleImg, theaterDepth, coupleDepth] = await Promise.all([
    loadImage(`${base}scene/theater.webp`, `${base}scene/theater.jpg`),
    loadImage(`${base}scene/couple.webp`, `${base}scene/couple.png`),
    loadPixels(`${base}scene/theater-depth.png`),
    loadPixels(`${base}scene/couple-depth.png`),
  ]);

  const W = scene.image.w, H = scene.image.h;
  const cx = W / 2, cy = H / 2;
  const { a: calA, b: calB } = scene.calibration;
  const dmin = scene.depth.min, dmax = scene.depth.max;
  const depthAt = (px, i) => {
    const v = ((px[i * 4] << 8) | px[i * 4 + 1]) / 65535;
    const disp = dmin + v * (dmax - dmin);
    return calA / (disp - calB);
  };

  // ---------- meshes
  const theaterMesh = buildMesh(gl, theaterDepth, depthAt, { x: 0, y: 0, w: W, h: H }, cx, cy, true);
  const c = scene.couple;
  const coupleMesh = buildMesh(gl, coupleDepth, () => COUPLE_Z, c, cx, cy, false);

  // ---------- textures
  const texTheater = makeTexture(gl, theaterImg, isGL2, true);
  const texCouple = makeTexture(gl, coupleImg, isGL2, true);
  const textCanvas = document.createElement('canvas');
  textCanvas.width = 1024; textCanvas.height = Math.round(1024 * scene.screen.h / scene.screen.w);
  const texText = makeTexture(gl, textCanvas, isGL2, false);

  // ---------- programs
  const hasDeriv = isGL2 || !!gl.getExtension('OES_standard_derivatives');
  const progScene = program(gl, isGL2, hasDeriv, VERT, FRAG_THEATER);
  const progCouple = program(gl, isGL2, hasDeriv, VERT, FRAG_COUPLE);
  // WebGL2: render into a colour + depth target, then rack focus to the screen in a second pass.
  const post = isGL2 ? createFocusPass(gl) : null;

  const s = scene.screen;
  const screenRect = [s.x / W, s.y / H, s.w / W, s.h / H];
  const screenCenter = { u: s.x + s.w / 2, v: s.y + s.h / 2 };
  const Zs = calA / (scene.calibration.screenDisparity - calB);

  // ---------- state written by the director each frame
  const state = {
    fade: 0,         // 0 black → 1 picture
    house: 1,        // house lights: 1 up (warm room, bright sconces) → low (embers)
    light: 0,        // the screen's light on the room
    screen: 0,       // screen brightness 0 off → 1 projecting
    dim: 0,          // the reel ends: the projection falls to a dark frame
    text: 0,         // projected text opacity
    dots: 0,         // 0..3 dots after "Loading a movie date"
    glint: 0,        // her ring catching the first light
    flicker: 1,
    progress: 0,     // camera dolly 0 → 1
    drift: 0,        // handheld float amount
    time: 0,
    grainSeed: 0,
  };

  let viewW = 1, viewH = 1, dpr = 1;
  let framing = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    viewW = Math.max(1, Math.round(rect.width * dpr));
    viewH = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== viewW || canvas.height !== viewH) { canvas.width = viewW; canvas.height = viewH; }
    if (post) post.size(viewW, viewH);
    framing = computeFraming(viewW / viewH);
  }

  // Where the camera starts and where it must end so the screen fills the frame.
  function computeFraming(aspect) {
    const imgAspect = W / H;
    // Rest framing: on tall screens fill the height (sides crop); on wide screens show a band from
    // just above the screen down to the couple's seats, and fade the picture out at its sides.
    let halfW, halfH, centerV;
    const portrait = aspect <= imgAspect * 1.08;
    if (portrait) {
      halfH = H / 2 / 1.035;               // a little margin for the handheld float
      halfW = halfH * aspect;
      centerV = cy;
    } else {
      const top = s.y - 150, bottom = c.y + c.h * 0.82;
      halfH = (bottom - top) / 2;
      halfW = halfH * aspect;
      centerV = (top + bottom) / 2;
    }
    // End: the screen covers the viewport with 7% to spare, centred.
    const coverScale = Math.max((halfW * 2) / s.w, (halfH * 2) / s.h) * 1.07;
    // a point at depth Zs grows by Zs / (Zs - D)
    const Dend = Zs * (1 - 1 / coverScale);
    // camera rise that centres the screen vertically at the end
    const Yscreen = (screenCenter.v - cy) * Zs / FOCAL;      // negative: above the axis
    const Ycenter = (centerV - cy) * Zs / FOCAL;
    const Hend = -(Yscreen - 0);                               // rise to screen height
    return { halfW, halfH, centerV, portrait, Dend, Hend, Ycenter, aspect };
  }

  // Camera path. progress 0..1 → distance travelled and rise.
  function camera(p, t, drift) {
    const f = framing;
    const d = dollyCurve(p);
    const D = f.Dend * d;
    const H = f.Hend * Math.pow(d, 0.82);
    // Steadicam float: a few slow incommensurate sines, fading out as the camera speeds up.
    const k = drift * (1 - smooth(0.25, 0.7, p));
    const fx = (Math.sin(t * 0.61) * 0.6 + Math.sin(t * 1.37 + 1.3) * 0.4) * 0.006 * k;
    const fy = (Math.sin(t * 0.83 + 0.4) * 0.6 + Math.sin(t * 1.91 + 2.1) * 0.4) * 0.005 * k;
    const roll = (Math.sin(t * 0.47 + 0.7) * 0.0016 + Math.sin(t * 1.13) * 0.0009) * k;
    return { x: fx, y: -H + fy, z: D, roll };
  }

  function render() {
    if (!framing) resize();
    const f = framing;
    if (post) gl.bindFramebuffer(gl.FRAMEBUFFER, post.fbo);
    gl.viewport(0, 0, viewW, viewH);
    gl.clearColor(0.043, 0.035, 0.031, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const cam = camera(state.progress, state.time, state.drift);
    // principal point offset: centre of the rest framing relative to the optical centre, which the
    // camera rise also moves (the rise is already in cam.y); expressed in clip units at depth.
    const focal = [FOCAL / f.halfW, FOCAL / f.halfH];
    // y_ndc = -(v' - centerV) / halfH, and v' = cy + FOCAL·y/z  →  offset = (cy - centerV) / halfH
    const offset = [0, (cy - f.centerV) / f.halfH];

    for (const [prog, mesh, tex, isCouple, tw, th] of [[progScene, theaterMesh, texTheater, false, W, H], [progCouple, coupleMesh, texCouple, true, c.w, c.h]]) {
      gl.useProgram(prog.p);
      gl.uniform3f(prog.u.uCam, cam.x, cam.y, cam.z);
      gl.uniform1f(prog.u.uRoll, cam.roll);
      gl.uniform2f(prog.u.uFocal, focal[0], focal[1]);
      gl.uniform2f(prog.u.uOffset, offset[0], offset[1]);
      gl.uniform2f(prog.u.uDepthAB, (FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR));
      gl.uniform1f(prog.u.uCellPx, (W / theaterDepth.width) * (viewH / (f.halfH * 2)));
      gl.uniform2f(prog.u.uView, viewW, viewH);
      gl.uniform1f(prog.u.uFade, state.fade);
      gl.uniform1f(prog.u.uLight, state.light);
      gl.uniform1f(prog.u.uHouse, state.house);
      gl.uniform1f(prog.u.uFlicker, state.flicker);
      gl.uniform1f(prog.u.uSeed, state.grainSeed % 997);
      gl.uniform1f(prog.u.uGrainHere, post ? 0 : 1);
      gl.uniform1f(prog.u.uSideFade, f.portrait ? 0 : 1);
      gl.uniform2f(prog.u.uTexSize, tw, th);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u.uTex, 0);
      if (!isCouple) {
        gl.uniform4f(prog.u.uScreenRect, ...screenRect);
        gl.uniform1f(prog.u.uScreen, state.screen);
        gl.uniform1f(prog.u.uDim, state.dim);
        gl.uniform1f(prog.u.uText, state.text);
        gl.uniform2f(prog.u.uScreenPx, s.w, s.h);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texText);
        gl.uniform1i(prog.u.uTextTex, 1);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
      } else {
        gl.uniform1f(prog.u.uGlint, state.glint);
        gl.uniform2f(prog.u.uGlintUV, (GLINT.x - c.x) / c.w, (GLINT.y - c.y) / c.h);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (post) { gl.depthFunc(gl.ALWAYS); gl.depthMask(true); }   // on top, but its depth is recorded for focus
        else { gl.disable(gl.DEPTH_TEST); gl.depthMask(false); }
      }
      drawMesh(gl, prog, mesh);
    }
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    if (post) {
      // Focus racks from the couple to the screen as the words appear, then holds on the screen:
      // anything nearer softens in proportion to its depth (at rest the photograph is as shot).
      const moving = smooth(0.12, 0.34, state.progress) * (1 - smooth(0.9, 1.0, state.progress));
      post.draw({
        focus: Math.max(Zs - cam.z, 0.3),
        strength: 3.2 * dpr * moving,
        maxRadius: 7 * dpr,
        near: NEAR, far: FAR,
        width: viewW, height: viewH,
        seed: state.grainSeed % 997,
      });
    }
  }

  // ---------- projected text
  let drawnKey = '';
  function drawText() {
    const key = `${state.dots}`;
    if (key === drawnKey) return;
    drawnKey = key;
    const ctx = textCanvas.getContext('2d');
    const w = textCanvas.width, h = textCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const size = Math.round(w * 0.071);
    ctx.font = `300 ${size}px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    const words = 'Loading a movie date';
    const dot = '.';
    const ww = ctx.measureText(words).width;
    const dw = ctx.measureText(dot).width;
    const total = ww + dw * 3;
    const x0 = (w - total) / 2;
    const y = h * 0.53;
    ctx.fillText(words, x0, y);
    for (let i = 0; i < state.dots; i++) ctx.fillText(dot, x0 + ww + dw * i, y);
    gl.bindTexture(gl.TEXTURE_2D, texText);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  }

  resize();
  drawText();

  return {
    state,
    resize,
    frame() { if (!lost) { drawText(); render(); } },
    get lost() { return lost; },
    // how far through the move the couple has left the frame, for the director's timing
    get framing() { return framing; },
    destroy() {
      for (const m of [theaterMesh, coupleMesh]) { gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo); }
      for (const t of [texTheater, texCouple, texText]) gl.deleteTexture(t);
      if (post) post.destroy();
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}

// Distance curve: a slow, patient push while the couple is in frame, then the long approach,
// then a gentle arrival. Monotone cubic through hand-tuned keys (progress → fraction of distance).
const KEYS = [
  [0.00, 0.000],
  [0.16, 0.012],
  [0.30, 0.040],
  [0.42, 0.095],
  [0.55, 0.230],
  [0.68, 0.470],
  [0.80, 0.720],
  [0.90, 0.900],
  [1.00, 1.000],
];
const dollyCurve = monotone(KEYS);

function monotone(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(0);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(0);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function ctxOptions() {
  return { antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
}

function loadImage(src, fallback) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => {
      if (!fallback) return reject(new Error(`could not load ${src}`));
      loadImage(fallback).then(resolve, reject);
    };
    img.src = src;
  });
}

async function loadPixels(src) {
  const img = await loadImage(src);
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { width: cv.width, height: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
}

// Build a grid mesh over an image region. Each vertex: world position (from depth), texture
// uv within the layer, the depth of its nearest neighbour (for gap shading) and an emissive mask.
function buildMesh(gl, depth, depthAt, box, cx, cy, withEmissive) {
  const gw = depth.width, gh = depth.height, px = depth.data;
  const Z = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) Z[i] = depthAt(px, i);
  const stride = 8; // x y z u v nearZ emissive pad
  const verts = new Float32Array(gw * gh * stride);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      const u = i / (gw - 1), v = j / (gh - 1);
      const ix = box.x + u * box.w, iy = box.y + v * box.h;
      const z = Z[k];
      let nearZ = z;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
        nearZ = Math.min(nearZ, Z[jj * gw + ii]);
      }
      const o = k * stride;
      verts[o] = (ix - cx) * z / FOCAL;
      verts[o + 1] = (iy - cy) * z / FOCAL;
      verts[o + 2] = z;
      verts[o + 3] = u;
      verts[o + 4] = v;
      verts[o + 5] = nearZ;
      verts[o + 6] = withEmissive ? px[k * 4 + 2] / 255 : 0;
      verts[o + 7] = 0;
    }
  }
  const idx = new Uint32Array((gw - 1) * (gh - 1) * 6);
  let n = 0;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    // split each cell along the diagonal whose depths agree best (fewer stretched triangles)
    if (Math.abs(Z[a] - Z[d]) < Math.abs(Z[b] - Z[c])) { idx[n++] = a; idx[n++] = c; idx[n++] = d; idx[n++] = a; idx[n++] = d; idx[n++] = b; }
    else { idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d; }
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return { vbo, ibo, count: n, stride: stride * 4 };
}

function drawMesh(gl, prog, mesh) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
  const a = prog.a;
  gl.enableVertexAttribArray(a.aPos); gl.vertexAttribPointer(a.aPos, 3, gl.FLOAT, false, mesh.stride, 0);
  gl.enableVertexAttribArray(a.aUV); gl.vertexAttribPointer(a.aUV, 2, gl.FLOAT, false, mesh.stride, 12);
  gl.enableVertexAttribArray(a.aNearZ); gl.vertexAttribPointer(a.aNearZ, 1, gl.FLOAT, false, mesh.stride, 20);
  gl.enableVertexAttribArray(a.aEmis); gl.vertexAttribPointer(a.aEmis, 1, gl.FLOAT, false, mesh.stride, 24);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
}

function makeTexture(gl, source, isGL2, mipmap) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  const pot = isPow2(source.width) && isPow2(source.height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmap && (isGL2 || pot)) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  return t;
}

function isPow2(n) { return (n & (n - 1)) === 0; }

function program(gl, isGL2, hasDeriv, vsrc, fsrc) {
  const vs = isGL2 ? '#version 300 es\n' + vsrc.replace(/attribute /g, 'in ').replace(/varying /g, 'out ') : vsrc;
  const fs = isGL2
    ? '#version 300 es\nprecision highp float;\nout vec4 fragOut;\n#define HAS_DERIV 1\n' + fsrc.replace(/varying /g, 'in ').replace(/texture2D\(/g, 'texture(').replace(/gl_FragColor/g, 'fragOut')
    : (hasDeriv ? '#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n' : '') + 'precision highp float;\n' + fsrc;
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
  for (const name of ['aPos', 'aUV', 'aNearZ', 'aEmis']) if (!(name in a)) a[name] = gl.getAttribLocation(p, name);
  return { p, u: new Proxy(u, { get: (o, k) => (k in o ? o[k] : null) }), a };
}

// ---------- the focus pass (WebGL2): colour + depth target, then a depth-aware gather blur

function createFocusPass(gl) {
  const vs = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fs = `#version 300 es
precision highp float;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear, uFar, uFocus, uStrength, uMaxR, uSeed;
in vec2 vUv;
out vec4 o;
const vec2 DISK[16] = vec2[16](
  vec2(-0.613, 0.354), vec2(0.247, -0.902), vec2(0.774, 0.416), vec2(-0.284, -0.465),
  vec2(0.172, 0.264), vec2(-0.866, -0.118), vec2(0.512, -0.334), vec2(-0.104, 0.889),
  vec2(0.931, -0.086), vec2(-0.506, -0.837), vec2(0.391, 0.861), vec2(-0.913, 0.402),
  vec2(0.062, -0.236), vec2(0.658, -0.733), vec2(-0.338, 0.612), vec2(-0.034, 0.021));
float coc(vec2 uv) {
  float d = texture(uDepth, uv).r * 2.0 - 1.0;
  float z = 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear));
  return clamp((1.0 / z - 1.0 / uFocus) * uStrength, 0.0, uMaxR);   // only nearer than focus blurs
}
void main() {
  float c0 = coc(vUv);
  vec3 col = texture(uColor, vUv).rgb;
  if (c0 > 0.35) {
    vec3 acc = col; float wsum = 1.0;
    for (int i = 0; i < 16; i++) {
      vec2 uv = vUv + DISK[i] * c0 / uRes;
      // a sharper sample behind a soft one may only lend what its own blur would reach
      float w = clamp(coc(uv) / c0 + 0.25, 0.0, 1.0);
      acc += texture(uColor, uv).rgb * w; wsum += w;
    }
    col = acc / wsum;
  }
  vec2 cell = floor(gl_FragCoord.xy / 2.0) + uSeed * vec2(17.0, 31.0);
  float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col *= 1.0 + (n - 0.5) * 0.085 * (1.0 - 0.7 * smoothstep(0.3, 0.85, lum));
  o = vec4(col, 1.0);
}`;
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'focus shader failed');
    gl.attachShader(p, sh);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'focus link failed');
  const u = (n) => gl.getUniformLocation(p, n);
  const loc = { color: u('uColor'), depth: u('uDepth'), res: u('uRes'), near: u('uNear'), far: u('uFar'), focus: u('uFocus'), strength: u('uStrength'), maxR: u('uMaxR'), seed: u('uSeed') };
  const tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const fbo = gl.createFramebuffer();
  let color = null, depth = null, w = 0, h = 0;
  return {
    fbo,
    size(W, H) {
      if (W === w && H === h) return;
      w = W; h = H;
      if (color) gl.deleteTexture(color);
      if (depth) gl.deleteTexture(depth);
      color = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, color);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('focus target incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    draw(o) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, o.width, o.height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, color); gl.uniform1i(loc.color, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, depth); gl.uniform1i(loc.depth, 1);
      gl.uniform2f(loc.res, o.width, o.height);
      gl.uniform1f(loc.near, o.near); gl.uniform1f(loc.far, o.far);
      gl.uniform1f(loc.focus, o.focus); gl.uniform1f(loc.strength, o.strength);
      gl.uniform1f(loc.maxR, o.maxRadius); gl.uniform1f(loc.seed, o.seed);
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
    },
    destroy() {
      gl.deleteFramebuffer(fbo);
      if (color) gl.deleteTexture(color);
      if (depth) gl.deleteTexture(depth);
      gl.deleteBuffer(tri);
    },
  };
}

// ---------- shaders

const VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aNearZ;
attribute float aEmis;
uniform vec3 uCam;
uniform float uRoll;
uniform vec2 uFocal;
uniform vec2 uOffset;
uniform vec2 uDepthAB;
uniform float uCellPx;
uniform vec2 uView;
varying vec2 vUV;
varying float vGap;
varying float vEmis;
varying float vZ;

vec2 project(vec3 p) {
  vec3 q = p - uCam;
  float c = cos(uRoll), s = sin(uRoll);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  return vec2(r.x * uFocal.x / q.z, -(r.y * uFocal.y / q.z) - uOffset.y);
}

void main() {
  vec3 q = aPos - uCam;
  float c = cos(uRoll), s = sin(uRoll);
  vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float z = q.z;
  gl_Position = vec4(r.x * uFocal.x, -r.y * uFocal.y - uOffset.y * z, uDepthAB.x * z + uDepthAB.y, z);
  vUV = aUV;
  vEmis = aEmis;
  vZ = z;
  // Gap shading: a point on the same line of sight at the nearest neighbour's depth projects to
  // the same place at rest. As the camera moves the two separate; that separation, in mesh cells,
  // is how wide the gap behind a depth edge has opened. Zero at rest.
  float gap = 0.0;
  if (aNearZ < aPos.z * 0.96) {
    vec3 pn = vec3(aPos.xy * (aNearZ / aPos.z), aNearZ);
    vec2 d = (project(aPos) - project(pn)) * 0.5 * uView;
    gap = length(d) / max(uCellPx, 1.0);
  }
  vGap = gap;
}
`;

const FRAG_COMMON = `
uniform sampler2D uTex;
uniform float uFade;
uniform float uLight;
uniform float uHouse;
uniform float uFlicker;
uniform float uSeed;
uniform float uGrainHere;
uniform float uSideFade;
uniform vec2 uTexSize;
uniform vec2 uView;
varying vec2 vUV;
varying float vGap;
varying float vEmis;
varying float vZ;

// Light on the room. The photograph is lit by the screen; with the house lights up and the screen
// dark the room is a dim warm fill instead, and the sconces burn brighter, then sink to embers.
vec3 roomLight(vec3 col, float emis) {
  vec3 house = vec3(0.64, 0.51, 0.39) * uHouse;
  vec3 room = col * max(house, vec3(uLight));
  float sconce = mix(0.42, 1.3, clamp(uHouse, 0.0, 1.0));
  return mix(room, col * sconce, emis);
}

// How much light survives once the camera has moved: texture stretched across a disocclusion and
// anything brushing the lens fall into shadow, the way the gaps between real rows look.
float shade() {
  float k = 1.0 - 0.94 * smoothstep(0.5, 1.8, vGap);
#ifdef HAS_DERIV
  vec2 t = vUV * uTexSize;
  vec2 dx = dFdx(t), dy = dFdy(t);
  float su = length(vec2(dx.x, dy.x)) + 1e-5;
  float sv = length(vec2(dx.y, dy.y)) + 1e-5;
  k *= 1.0 - 0.94 * smoothstep(1.6, 3.4, su / sv);
#endif
  k *= smoothstep(0.05, 0.3, vZ);
  return k;
}

float vignette() {
  vec2 v = gl_FragCoord.xy / uView * 2.0 - 1.0;
  return 1.0 - 0.32 * smoothstep(0.55, 1.45, length(v * vec2(0.9, 0.75)));
}

float sideFade(float imageU) {
  float e = min(imageU, 1.0 - imageU);
  return mix(1.0, smoothstep(0.0, 0.16, e), uSideFade);
}

// film grain in two-pixel clumps, new 24 times a second; multiplied, so black stays black, and
// weakest in the highlights, as on real stock
float grain(vec3 col) {
  vec2 cell = floor(gl_FragCoord.xy / 2.0) + uSeed * vec2(17.0, 31.0);
  float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  return 1.0 + (n - 0.5) * 0.085 * (1.0 - 0.7 * smoothstep(0.3, 0.85, lum)) * uGrainHere;
}
`;

const FRAG_THEATER = FRAG_COMMON + `
uniform sampler2D uTextTex;
uniform vec4 uScreenRect;
uniform vec2 uScreenPx;
uniform float uScreen;
uniform float uDim;
uniform float uText;

void main() {
  vec3 col = texture2D(uTex, vUV).rgb;
  vec3 room = roomLight(col, vEmis);

  vec2 sp = (vUV - uScreenRect.xy) / uScreenRect.zw;
  float inside = smoothstep(-0.002, 0.002, sp.x) * smoothstep(-0.002, 0.002, 1.0 - sp.x)
               * smoothstep(-0.003, 0.003, sp.y) * smoothstep(-0.003, 0.003, 1.0 - sp.y);

  // The screen as a live surface: warm lamp, brightest in the middle, never a lightbox.
  vec2 c = sp - vec2(0.5, 0.48);
  float hot = 1.0 - 0.2 * smoothstep(0.0, 0.62, length(c * vec2(1.0, 1.25)));
  vec3 lamp = col * vec3(1.0, 0.945, 0.86) * hot;
  vec3 darkFrame = vec3(0.043, 0.035, 0.031) * (0.85 + 0.35 * hot);
  vec3 projected = mix(lamp, darkFrame, uDim);
  vec3 scr = mix(col * 0.07, projected, uScreen);

  // projected type: dark letters are light withheld; a few taps soften them like a lens would
  vec2 px = vec2(1.0 / 1024.0, 1.0 / 662.0) * 1.4;
  float ta = texture2D(uTextTex, sp).a * 0.4
           + (texture2D(uTextTex, sp + vec2(px.x, 0.0)).a + texture2D(uTextTex, sp - vec2(px.x, 0.0)).a
           +  texture2D(uTextTex, sp + vec2(0.0, px.y)).a + texture2D(uTextTex, sp - vec2(0.0, px.y)).a) * 0.15;
  scr *= 1.0 - 0.8 * ta * uText;

#ifdef HAS_DERIV
  // Close enough, the screen shows its perforations.
  vec2 g = sp * vec2(240.0, 240.0 * uScreenPx.y / uScreenPx.x);
  float cellPx = 1.0 / max(fwidth(g.x), 1e-4);
  vec2 f = fract(g) - 0.5;
  float hole = 1.0 - smoothstep(0.12, 0.2, length(f));
  scr *= 1.0 - 0.1 * hole * smoothstep(3.0, 9.0, cellPx);
#endif

  col = mix(room, scr, inside);

  // a little of the lamp spills onto the black masking around the screen
  vec2 o = max(max(-sp, sp - 1.0), 0.0) * vec2(uScreenPx.x / uScreenPx.y, 1.0);
  float spill = exp(-length(o) * 22.0) * (1.0 - inside) * uScreen * (1.0 - uDim);
  col += vec3(0.20, 0.16, 0.11) * spill;

  col *= shade() * uFade * uFlicker * vignette() * sideFade(vUV.x);
  col *= grain(col);
  gl_FragColor = vec4(col, 1.0);
}
`;

const FRAG_COUPLE = FRAG_COMMON + `
uniform float uGlint;
uniform vec2 uGlintUV;

void main() {
  vec4 t = texture2D(uTex, vUV);   // premultiplied
  if (t.a < 0.004) discard;
  vec3 col = roomLight(t.rgb, 0.0);
  // the ring: a real highlight, a few frames long, as the first light reaches their hands
  vec2 d = (vUV - uGlintUV) * uTexSize;
  float r2 = dot(d, d);
  col += vec3(1.0, 0.93, 0.8) * uGlint * (exp(-r2 / 5.0) * 1.4 + exp(-r2 / 90.0) * 0.22) * t.a;
  float k = uFade * uFlicker * vignette() * smoothstep(0.05, 0.3, vZ);
  col *= k;
  col *= grain(col);
  gl_FragColor = vec4(col, t.a);
}
`;
