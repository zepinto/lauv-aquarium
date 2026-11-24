// ============================================================================
// THE SURFACE: the sea seen from above (sky, sun, clouds, waves, Fresnel, foam, wake, the reef through the water), the
// same waves for the hull and the camera, and the waterline when the camera dips through.
// ============================================================================
// Waves: a Tessendorf FFT ocean on the GPU (the approach and constants of ~/workspace/lauv-ocean-3d, OceanSim.js and
// spectrum.js): a fetch-limited JONSWAP spectrum with Donelan-Banner spreading, three cascades whose tiles divide the
// world tile (PER / 2, PER / 13, PER / 89 m: the sea repeats with the world, a torus, and no two tilings line up),
// choppy (first-order Lagrangian) displacement, the second-order mean level, and foam where the surface folds (the
// Jacobian of the displacement), accumulated in label space so it rides with the water and fades after the crest.
// Each frame: two compute dispatches per transform (rows with the time evolution fused in, then columns with the
// assembly), mips, and a probe that samples the sea at the vehicle and at the camera.
// The CPU keeps the same sea for the physics: the few hundred strongest modes of the two long cascades summed directly
// (surfEval), corrected by the GPU probe (the exact sum of all three cascades) read back 1-3 frames later.
const SURF_U10 = 7, SURF_FETCH = 20000, SURF_WIND = 0.35, SURF_CHOP = 0.9, SURF_DEPTH = 100, SURF_SEED = 1337;
const OC_N = 256, OC_L = [PER / 2, PER / 13, PER / 89], OC_SPLIT = 6, OC_NC = 3;
const OC = (() => {
  const g = 9.81, U = SURF_U10, fetch = SURF_FETCH;
  const omegaP = 22 * Math.pow((g * g) / (U * fetch), 1 / 3), alpha = 0.076 * Math.pow((U * U) / (fetch * g), 0.22), gamma = 3.3;
  const jonswap = (w) => { if (w <= 0) return 0; const s = w <= omegaP ? 0.07 : 0.09, r = Math.exp(-((w - omegaP) ** 2) / (2 * s * s * omegaP * omegaP)); return alpha * g * g / w ** 5 * Math.exp(-1.25 * (omegaP / w) ** 4) * Math.pow(gamma, r); };
  const spread = (th, w) => {   // Donelan, Hamilton & Hui (1985) with Banner (1990)
    const x = w / omegaP; let b;
    if (x < 0.95) b = 2.61 * Math.pow(Math.max(x, 0.56), 1.3); else if (x < 1.6) b = 2.28 * Math.pow(x, -1.3); else b = Math.pow(10, -0.4 + 0.8393 * Math.exp(-0.567 * Math.log(x * x)));
    const s = 1 / Math.cosh(b * th); return b / (2 * Math.tanh(b * Math.PI)) * s * s;
  };
  const ST = 7.12e-5, disp = (k) => Math.sqrt((g * k + ST * k * k * k) * Math.tanh(Math.min(k * SURF_DEPTH, 20)));
  const dwdk = (k) => { const kh = Math.min(k * SURF_DEPTH, 20), th = Math.tanh(kh), gk = g * k + ST * k * k * k, sech2 = kh >= 20 ? 0 : 1 / Math.cosh(kh) ** 2; return ((g + 3 * ST * k * k) * th + gk * SURF_DEPTH * sech2) / (2 * Math.sqrt(gk * th)); };
  const specK = (kx, kz) => { const k = Math.hypot(kx, kz); if (k <= 0) return 0; const w = disp(k), th = Math.atan2(Math.sin(Math.atan2(kz, kx) - SURF_WIND), Math.cos(Math.atan2(kz, kx) - SURF_WIND)); return jonswap(w) * spread(th, w) * dwdk(k) / k; };
  let seed = SURF_SEED;
  const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = OC_N, h0 = new Float32Array(OC_NC * N * N * 4), cas = [];
  for (let c = 0; c < OC_NC; c++) {
    const L = OC_L[c], dk = TAU / L, kLow = c ? TAU / OC_L[c] * OC_SPLIT : 0, kHigh = c < OC_NC - 1 ? TAU / OC_L[c + 1] * OC_SPLIT : Math.PI * N / L;
    const a = new Float32Array(N * N * 2); let vr = 0, m1 = 0, sxx = 0, szz = 0;
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      const nx = u - N / 2, nz = v - N / 2, kx = nx * dk, kz = nz * dk, k = Math.hypot(kx, kz), ph = TAU * rng();
      if (u === 0 || v === 0 || (nx === 0 && nz === 0)) continue;
      if (k + dk * 0.7072 < kLow || k - dk * 0.7072 >= kHigh) continue;
      const nr = Math.hypot(nx, nz), ns = nr < 6 ? 8 : nr < 40 ? 4 : 2, sd = dk / ns; let E = 0;
      for (let b = 0; b < ns; b++) for (let q = 0; q < ns; q++) { const qx = kx - dk / 2 + (q + 0.5) * sd, qz = kz - dk / 2 + (b + 0.5) * sd, qk = Math.hypot(qx, qz); if (qk >= kLow && qk < kHigh) E += specK(qx, qz); }
      E *= sd * sd; if (E <= 0) continue;
      vr += E; m1 += k * E; sxx += kx * kx * E; szz += kz * kz * E;
      const A = Math.sqrt(E / 2), i = (v * N + u) * 2; a[i] = A * Math.cos(ph); a[i + 1] = A * Math.sin(ph);
    }
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {   // (h0(k), conj h0(-k))
      const i = (v * N + u) * 2, j = (((N - v) % N) * N + (N - u) % N) * 2, o = (c * N * N + v * N + u) * 4;
      h0[o] = a[i]; h0[o + 1] = a[i + 1]; h0[o + 2] = a[j]; h0[o + 3] = -a[j + 1];
    }
    cas.push({ L, kbar: vr > 0 ? m1 / vr : 0, var: vr, slope: sxx + szz });
  }
  // the CPU sea: the strongest modes of the two long cascades (one of each +-k pair), summed directly
  const modes = [];
  for (let c = 0; c < 2; c++) for (let v = 1; v < N; v++) for (let u = 1; u < N; u++) {
    const nx = u - N / 2, nz = v - N / 2; if (nz < 0 || (nz === 0 && nx <= 0)) continue;
    const o = (c * N * N + v * N + u) * 4, e = h0[o] ** 2 + h0[o + 1] ** 2 + h0[o + 2] ** 2 + h0[o + 3] ** 2; if (e <= 0) continue;
    const kx = nx * TAU / OC_L[c], kz = nz * TAU / OC_L[c], k = Math.hypot(kx, kz);
    modes.push({ e, c, kx, kz, k, w: disp(k), a: [h0[o], h0[o + 1], h0[o + 2], h0[o + 3]] });
  }
  modes.sort((p, q) => q.e - p.e);
  const NM = 360, M = new Float32Array(NM * 8); let kept = 0, tot = 0;
  for (const m of modes) tot += 2 * m.e;
  for (let i = 0; i < NM && i < modes.length; i++) { const m = modes[i], o = i * 8; kept += 2 * m.e; M.set([m.kx, m.kz, m.w, m.a[0], m.a[1], m.a[2], m.a[3], m.c], o); }
  const cm = 0.00316 * U + 0.003 + 0.00192 * U, res = cas.reduce((s, c) => s + c.slope, 0);
  return { h0, cas, M, NM: Math.min(NM, modes.length), kept: kept / tot, Hs: 4 * Math.sqrt(cas.reduce((s, c) => s + c.var, 0)), resid: Math.max(cm - res, 0.1 * cm), Lp: TAU * g / omegaP / omegaP };
})();

// ---------------------------------------------------------------- the CPU sea (physics, camera, tests)
const surfS = { h: 0, sx: 0, sz: 0, vy: 0 };
const surfHk = new Float32Array(OC.NM * 4); let surfHkT = NaN;   // h(k, t) and dh/dt of every CPU mode at time surfHkT
const surfAcc = new Float64Array(12);
function surfModesAt(t) {
  if (t === surfHkT) return;
  surfHkT = t; const M = OC.M;
  for (let i = 0; i < OC.NM; i++) {
    const o = i * 8, w = M[o + 2], c = cos(w * t), s = sin(w * t);
    // h = a e^{-iwt} + b e^{iwt};  dh/dt = -iw a e^{-iwt} + iw b e^{iwt}
    const ar = M[o + 3] * c + M[o + 4] * s, ai = M[o + 4] * c - M[o + 3] * s, br = M[o + 5] * c - M[o + 6] * s, bi = M[o + 6] * c + M[o + 5] * s;
    surfHk[i * 4] = ar + br; surfHk[i * 4 + 1] = ai + bi; surfHk[i * 4 + 2] = w * (ai - bi); surfHk[i * 4 + 3] = w * (br - ar);
  }
}
// sums at label point (x, z): per cascade h, Dx, Dz; and in total hx, hz, Dxx, Dzz, dh/dt (only the horizontal displacement when full is false)
function surfSum(x, z, full) {
  const M = OC.M, A = surfAcc; A.fill(0);
  for (let i = 0; i < OC.NM; i++) {
    const o = i * 8, kx = M[o], kz = M[o + 1], th = kx * x + kz * z, c = cos(th), s = sin(th), hr = surfHk[i * 4], hi = surfHk[i * 4 + 1];
    const re = 2 * (hr * c - hi * s), im = 2 * (hr * s + hi * c), k = Math.hypot(kx, kz), b = M[o + 7] * 3;
    // D = i k/|k| h e^{ik.x}  ->  -k/|k| Im
    A[b + 1] -= kx / k * im; A[b + 2] -= kz / k * im;
    if (full) {
      A[b] += re; A[6] -= kx * im; A[7] -= kz * im; A[8] -= kx * kx / k * re; A[9] -= kz * kz / k * re;
      A[10] += 2 * (surfHk[i * 4 + 2] * c - surfHk[i * 4 + 3] * s);
    }
  }
}
// the sea at the world point (x, z) at time t, into o: height, slope (dh/dx, dh/dz), vertical speed (CPU modes only)
function surfEval(x, z, t, o) {
  surfModesAt(t);
  let lx = x, lz = z;
  for (let it = 0; it < 3; it++) { surfSum(lx, lz, false); lx = x - SURF_CHOP * (surfAcc[1] + surfAcc[4]); lz = z - SURF_CHOP * (surfAcc[2] + surfAcc[5]); }
  surfSum(lx, lz, true); const A = surfAcc;
  let h = A[0] + A[3];
  for (let c = 0; c < 2; c++) { const b = c * 3; h += SURF_CHOP * 0.5 * OC.cas[c].kbar * (A[b] * A[b] + A[b + 1] * A[b + 1] + A[b + 2] * A[b + 2]); }
  o.h = h; o.sx = A[6] / max(1 + SURF_CHOP * A[8], 0.25); o.sz = A[7] / max(1 + SURF_CHOP * A[9], 0.25); o.vy = A[10];
  return o;
}
// GPU probe corrections (exact - CPU) at the vehicle [0] and the camera [1]: x, z, time, dh, dsx, dsz
const surfCor = [new Float64Array(6), new Float64Array(6)];
for (const c of surfCor) c[2] = -1e9;
function surfWaveAt(x, z, t, o) {
  surfEval(x, z, t, o);
  let best = null, bd = 1.5;
  for (const c of surfCor) { const d = hypot(wrapD(x - c[0]), wrapD(z - c[1])); if (d < bd && abs(t - c[2]) < 0.6) { bd = d; best = c; } }
  if (best) { o.h += best[3]; o.sx += best[4]; o.sz += best[5]; }
  return o;
}
// the hull's view of it (called by the physics every step)
function surfWave(v) {
  surfWaveAt(v.pos[0], v.pos[2], F[TIME], surfS);
  v.surfY = surfS.h; v.surfSx = surfS.sx; v.surfSz = surfS.sz; v.surfVy = surfS.vy;
  if (v === lv) surfTrailStep(v);
}
// the foam track the hull leaves, recorded every physics step on the vehicle's own clock (v.t), so it ages with the
// simulation (also in __app.sim and while the time of day is fixed)
const surfLast = [0, 0, 0], surfTrail = [];               // newest first: {x, z, t, s}
function surfTrailStep(v) {
  const t = v.t, sub = v.surfY - v.pos[1], moving = abs(v.v[0]) > 0.15 || abs(v.rpm) > 150;
  if (surfTrail.length && hypot(wrapD(v.pos[0] - surfLast[0]), wrapD(v.pos[2] - surfLast[2])) > 3) surfTrail.length = 0;   // teleported
  surfLast[0] = v.pos[0]; surfLast[2] = v.pos[2];
  if (surfTrail.length && t < surfTrail[0].t - 1) surfTrail.length = 0;   // time was reset
  if (sub < 0.3 && moving) {
    v.toWorld(0.1, 0, 0, lauvTmp);
    const l = surfTrail[0];
    if (l && hypot(wrapD(lauvTmp[0] - l.x), wrapD(lauvTmp[2] - l.z)) > 5) surfTrail.length = 0;
    if (!surfTrail.length || hypot(wrapD(lauvTmp[0] - surfTrail[0].x), wrapD(lauvTmp[2] - surfTrail[0].z)) > 0.18) {
      const p = surfTrail.length >= SURF_TRAIL ? surfTrail.pop() : {};
      p.x = lauvTmp[0]; p.z = lauvTmp[2]; p.t = t; p.s = clamp(0.2 + 0.3 * abs(v.v[0]) / 1.5 + abs(v.rpm) / 6000, 0, 1);
      surfTrail.unshift(p);
    }
  }
}

// ---------------------------------------------------------------- water optics (lauv-ocean-3d waterOptics.js, Lee et al. 1999/2002)
// clear blue open-shelf water: chlorophyll 0.25 mg/m3, a little mineral backscatter; deep-water remote-sensing reflectance
const SURF_RRS = (() => {
  const chl = 0.25, bbp550 = 0.002, lc = Math.log10(chl), vv = 0.5 * (lc - 0.3), bp550 = 0.416 * Math.pow(chl, 0.766), dAph = 0.0654 * (Math.pow(chl, 0.728) - Math.pow(0.3, 0.728));
  const a = [0.45 + 0.45 * dAph, 0.065 + 0.2 * dAph, 0.03 + dAph];
  return [680, 550, 440].map((l, i) => {
    const bw = 0.00288 * Math.pow(l / 500, -4.32), sp = Math.pow(l / 550, vv), bpl = bp550 * sp, bbR = 0.002 + 0.01 * (0.5 - 0.25 * lc) * sp, bbm = bbp550 * (550 / l);
    const bb = 0.5 * bw + bbR * bpl + bbm, u = bb / (a[i] + bb), rrs = (0.089 + 0.125 * u) * u;
    return 0.52 * rrs / (1 - 1.7 * rrs);
  });
})();

// the text of WGSL function `name` in src (to share one with another module: the surface from below is the look piece's)
const wgslFn = (src, name) => { const i = src.indexOf('fn ' + name + '('); let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1) + '\n'; } throw new Error('no fn ' + name); };
const SURF_V = +(new URLSearchParams(location.search).get('sv') || 0);   // cost experiments (dev): 1 flat water, 2 no refraction, 3 no clouds in the reflection, 4 no scene copy
const SURF_WK = 512, SURF_WKE = 64;   // the wake texture: texels, metres across
const SURF_M = 96, SURF_LV = 12, SURF_SP0 = 0.08, SURF_TRAIL = 48, SURF_NP = 4;
const W_SURFA = S_B + /*wgsl*/`
struct SU { a: vec4f, o: vec4f, sv: vec4f, bb: vec4f, w: array<vec4f, ${SURF_TRAIL}> }   // bb: the wake's bounding box (min x, min z, max x, max z, relative to its newest point)
   // a: speed, 1 with the camera under the water, the vehicle's clock (wake ages), hull height above the water; o: foam threshold, 0, 0, 0; sv: slope variance per cascade, unresolved; w: wake points (x, z, birth time, strength), newest first
@group(1) @binding(1) var<uniform> su: SU;
@group(1) @binding(2) var tFl: texture_2d<f32>;          // height of the sea floor (r: (h + 40) / 40), from the world's ground map
@group(1) @binding(3) var tDisp: texture_2d_array<f32>;  // per cascade: Dx, h, Dz, accumulated foam (label space)
@group(1) @binding(4) var tDer: texture_2d_array<f32>;   // per cascade: dh/dx, dh/dz, dDx/dx, dDz/dz
@group(1) @binding(5) var<storage, read> pr: array<vec4f, ${SURF_NP}>;   // the probe: [0] the vehicle, [1] the camera: height, slope x, z, Jacobian
@group(1) @binding(6) var tScn: texture_2d<f32>;         // the scene under the water (copied before the water is drawn)
@group(1) @binding(7) var tScnD: texture_depth_2d;
@group(1) @binding(8) var sO: sampler;                   // the ocean textures: trilinear, a little anisotropy
@group(1) @binding(9) var tWake: texture_2d<f32>;        // the hull's foam trail round su.o.zw (r: foam, g: its edge)
const ON = ${OC_N}.;
const OL = array<f32, 3>(${OC_L.join(', ')});
const REFR = ${AA === 1};
const SK = 2.5;   // the sky is written in display units; the exposure above the water is 0.6 * 0.62
const WIND = vec2f(${Math.cos(SURF_WIND)}, ${Math.sin(SURF_WIND)});
const SKYSUN = vec3f(.553, .669, -.497);   // the sun as the sky shows it: 42 degrees up (the underwater light keeps the world's own)
const RRS = vec3f(${SURF_RRS.join(', ')});
const F0 = .0204;
fn vn2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  let a = hs(dot(i, vec2f(1., 57.))); let b = hs(dot(i + vec2f(1., 0.), vec2f(1., 57.)));
  let c = hs(dot(i + vec2f(0., 1.), vec2f(1., 57.))); let d = hs(dot(i + vec2f(1., 1.), vec2f(1., 57.)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm2(p0: vec2f, oct: i32) -> f32 {
  var p = p0; var a = .5; var s = 0.;
  for (var i = 0; i < oct; i++) { s += a * vn2(p); p = vec2f(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + 11.3; a *= .5; }
  return s;
}
const HAZE = vec3f(.42, .62, .84);
fn skyBase(rd: vec3f) -> vec3f {
  let y = max(rd.y, 0.);
  var c = mix(HAZE, vec3f(.025, .15, .66), pow(y, .4));
  c = mix(c, vec3f(.62, .76, .90), (1. - ss(0., .10, y)) * .45);
  let sd = sat(dot(rd, SKYSUN));
  c += vec3f(1., .86, .62) * (pow(sd, 5.) * .10 + pow(sd, 48.) * .30);
  return c;
}
// the clouds: a flat layer, lit from the sun's side. full: shaded (the sky), otherwise flat (the reflection)
fn clouds(rd: vec3f, base: vec3f, t: f32, full: bool) -> vec3f {
  if (rd.y < .01) { return base; }
  let uv = rd.xz / (rd.y + .14) * 2.2 + vec2f(t * .006, t * .0022) + vec2f(3.1, 7.7);
  let n1 = fbm2(uv, select(3, 5, full));
  let cov = ss(.47, .64, n1) * ss(.01, .14, rd.y);
  if (cov <= 0.) { return base; }
  var lit = .8;
  if (full) { let n2 = fbm2(uv + SKYSUN.xz * .6, 4); lit = sat(.62 - (n2 - n1) * 4.5); }
  var cc = mix(vec3f(.40, .48, .66), vec3f(1.15, 1.1, 1.05), lit);
  cc *= 1. - .22 * ss(.62, .85, n1);
  cc += (1. - cov) * .18;
  return mix(base, cc, cov * .94);
}
fn skyCol(rd: vec3f, t: f32, full: bool) -> vec3f {
  var c = skyBase(rd);
  c = clouds(rd, c, t, full);
  let sd = dot(rd, SKYSUN);
  c += vec3f(1., .95, .85) * (ss(.9996, .99985, sd) * 40.) * select(0., 1., full);
  return c;
}
// the water height where the ray of direction rd meets the lens (the near plane), and that point's height: the waterline across the lens follows the waves
fn dispAt(p: vec2f, c: i32, exact: bool) -> vec4f {
  if (!exact) { return textureSampleLevel(tDisp, sR, p / OL[c] + .5 / ON, c, 0.); }
  // bilinear in full float (the hardware's 8-bit weights make steps across a texel when one texel spans 150 pixels of the lens)
  let x = p / OL[c] * ON; let i0 = floor(x); let f = x - i0; let n = i32(ON);
  let a = vec2i(i0) & vec2i(n - 1); let b = (a + 1) & vec2i(n - 1);
  return mix(mix(textureLoad(tDisp, a, c, 0), textureLoad(tDisp, vec2i(b.x, a.y), c, 0), f.x), mix(textureLoad(tDisp, vec2i(a.x, b.y), c, 0), textureLoad(tDisp, b, c, 0), f.x), f.y);
}
fn lensH(rd: vec3f, exact: bool) -> vec2f {
  let t = g.fwd.w / dot(rd, g.fwd.xyz);
  let np = g.cam.xz + rd.xz * t;
  var lh = 0.; var lx = np;
  for (var c = 0; c < 3; c++) { lx -= dispAt(np, c, exact).xz; }
  for (var c = 0; c < 3; c++) { lh += dispAt(lx, c, exact).y; }
  return vec2f(lh * ss(-.4, -.15, g.cam.y), g.cam.y + rd.y * t);
}
struct VS2 { @builtin(position) cp: vec4f, @location(0) dir: vec3f };
@vertex fn vsSky(@builtin(vertex_index) i: u32) -> VS2 {
  var o: VS2;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.dir = g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
// behind everything: sky where the pixel's ray has left the water (judged at the near plane: that is the waterline across the lens), the deep water haze elsewhere
@fragment fn fsSky(i: VS2) -> @location(0) vec4f {
  let rd = normalize(i.dir);
  let lh = lensH(rd, false); let z = g.sun.w;
  if (lh.y > lh.x) {
    var c = skyCol(rd, g.cam.w, true) * SK;
    if (rd.y < 0.) { c = mix(c, fogIn(vec3f(0.), rd, 240., z, g.sun.xyz) * .62, sat(-rd.y * 28.)); }
    return fin(c);
  }
  if (g.cam.y > 0.) { return fin(wFog(vec3f(0.), vec3f(g.cam.x, -.02, g.cam.z), rd, 240., g.sun.xyz)); }   // the lens is under a crest that stands above the mean level
  return fin(fog(vec3f(0.), g.cam.xyz + rd * 240., z));
}

// the lens half under a wave while the camera is in the air: what lies below the waterline is seen through water (bluer, dimmer),
// and the water film on the lens makes a bright, wavering meniscus along the line
@fragment fn fsLens(i: VS2) -> @location(0) vec4f {
  let rd = normalize(i.dir);
  let lh = lensH(rd, true);
  let e = lh.y - lh.x;
  if (g.cam.y <= 0. || e > .0006) { discard; }
  let px = vec2i(i.cp.xy);
  let dims = vec2i(textureDimensions(tScn));
  let wob = vec2i(i32(sin(i.cp.x * .011 + g.cam.w * 3.) * 3. * ss(-.0007, -.003, e)), 0);
  let sc = textureLoad(tScn, clamp(px + wob, vec2i(0), dims - 1), 0).rgb;
  let d = min(g.fwd.w / max(textureLoad(tScnD, px, 0), 1e-7) / max(dot(rd, g.fwd.xyz), .05), 60.);
  var c = wFog(sc, vec3f(g.cam.x, -.01, g.cam.z), rd, d * .6, g.sun.xyz) * vec3f(.8, .95, 1.);
  let rim = ss(.0006, .0001, e) * ss(-.0007, -.0001, e);
  c = mix(c, vec3f(.8, 1.05, 1.15) * 1.2 + sc * .3, rim * .6);
  return vec4f(c, 1.);
}

// ---- the mesh: a camera-centred clipmap, ${SURF_LV} square rings of ${SURF_M} x ${SURF_M} cells whose spacing doubles per ring, snapped to
// their own grid (the vertices stay put on the water as the camera moves); rings overlap their inner neighbour, and since
// everything depends only on the world position the overlap does not show
const CM = ${SURF_M}.; const SP0 = ${SURF_SP0};
struct VM { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) lp: vec2f, @location(2) eta: f32 };
@vertex fn vsM(@location(0) gi: vec4u) -> VM {
  var o: VM;
  let s = SP0 * exp2(f32(gi.z));
  let snap = floor(g.cam.xz / (2. * s)) * (2. * s);
  let p = snap + (vec2f(gi.xy) - CM * .5) * s;
  let dist = length(p - g.cam.xz);
  // the displacement filtered to the local vertex spacing (a continuous function of distance, so overlapping rings agree)
  let sc = SP0 * max(1., dist / (SP0 * CM * .25));
  var d = vec3f(0.);
  for (var c = 0; c < 3; c++) {
    let lod = max(0., log2(sc * ON / OL[c]));
    d += textureSampleLevel(tDisp, sR, p / OL[c] + .5 / ON, c, lod).xyz * (1. - ss(4.5, 6.5, lod));
  }
  d *= (1. - ss(3000., 8000., dist)) * ss(-.4, -.15, g.cam.y) * select(1., 1. - ss(12., 45., dist), g.cam.y < 0.);
  var w = vec3f(p.x + d.x, d.y, p.y + d.z);
  // the curvature of the Earth (with refraction): the far sea drops below the horizon
  let rel = w.xz - g.cam.xz;
  w.y -= dot(rel, rel) / (2. * 7.3e6) * select(0., 1., g.cam.y > 0.);   // (not from below: the sea above stays flat out to the visible range)
  o.wp = w; o.lp = p; o.eta = d.y;
  o.cp = g.vp * vec4f(w, 1.);
  return o;
}
// rough-sea Fresnel (Bruneton, Neyret & Holzschuch 2010): the Fresnel of water averaged over the facets a pixel sees
fn meanFresnel(cv: f32, sv: f32) -> f32 { return F0 + (1. - F0) * pow(1. - cv, 5. * exp(-2.69 * sv)) / (1. + 22.7 * pow(sv, 1.5)); }
// slopes of the three cascades at label point p (mip-filtered), the unresolved slope variance, and the fold (Jacobian)
struct SL { s: vec2f, J: f32, v: f32, foam: f32, crest: f32 };
fn slopes(p: vec2f, damp: f32) -> SL {
  var o: SL; var gs = vec2f(0.); var dxx = 0.; var dzz = 0.; var v = su.sv.w; var acc = 0.;
  for (var c = 0; c < 3; c++) {
    let uv = p / OL[c] + .5 / ON;
    let a = textureSample(tDer, sO, uv, c);
    gs += a.xy * select(1., damp, c == 2); dxx += a.z; dzz += a.w;
    let fp = max(length(dpdx(uv)), length(dpdy(uv))) * ON;
    v += su.sv[c] * ss(.6, 5., fp);
    if (c < 2) { acc = max(acc, textureSample(tDisp, sO, uv, c).w); }
  }
  // capillary-gravity detail below the finest cascade: its slope field shrunk 7.3 times (the saturation range is scale invariant, Phillips 1985)
  gs += textureSample(tDer, sO, p / OL[2] * 7.31 + .37, 2).xy * .45 * damp;
  let jx = max(1. + dxx, .2); let jz = max(1. + dzz, .2);
  o.s = vec2f(gs.x / jx, gs.y / jz); o.J = jx * jz; o.v = v; o.foam = acc;
  return o;
}
// foam trail of the hull (the wake texture, drawn by W_WAKE)
fn wake(p: vec2f) -> vec2f {
  let uv = wr2v(p - su.o.zw) / ${SURF_WKE}. + .5;
  if (su.w[0].w <= 0. || any(uv < vec2f(0.)) || any(uv > vec2f(1.))) { return vec2f(0.); }
  return textureSampleLevel(tWake, sC, uv, 0.).rg;
}
fn wr2v(v: vec2f) -> vec2f { return vec2f(wr(v.x), wr(v.y)); }
@fragment fn fsM(i: VM) -> @location(0) vec4f {
  if (su.a.y > .5) { return underside(i); }   // the camera is under the water: the far wave faces turned towards it are seen from below too
  if (${SURF_V} == 1) { return vec4f(.1, .3, .5, 1.); }
  let t = g.cam.w; let wp = i.wp; let p = i.lp;
  let v = g.cam.xyz - wp; let d = length(v); let V = v / d;
  let wk0 = select(vec2f(0.), wake(wp.xz), ${SURF_V} != 7);
  let S = slopes(p, 1. - select(.3, 0., ${SURF_V} == 10) * sat(wk0.y * 1.3));
  if (${SURF_V} == 5) { return vec4f(S.s * .5 + .5, S.foam, 1.); }
  var sl = S.s;
  // how far behind the surface the scene lies along this ray (the hull, kelp, the reef)
  let zw = g.fwd.w / max(i.cp.z, 1e-7); let zo = g.fwd.w / max(textureLoad(tScnD, vec2i(i.cp.xy), 0), 1e-7);
  let dObj = max(zo - zw, 0.) / max(dot(-V, g.fwd.xyz), .05);
  // ---- the hull: waterline, bow wave, wake (a slick behind it: the short waves are damped)
  var foamV = 0.; var slick = 0.;
  let aw = ss(.25, .03, su.a.w);
  let ta = wd(g.va.xyz - wp).xz; let nb = wd(g.vb.xyz - wp).xz;
  let ab = nb - ta; let hh = clamp(-dot(ta, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
  let dh = length(ta + ab * hh);
  let hdir = normalize(ab); let rel = -nb; let back = -dot(rel, hdir); let sd = abs(dot(rel, vec2f(-hdir.y, hdir.x)));
  var lacew = 0.;
  if (((aw > 0. && dh < 1.5) || wk0.x + wk0.y > 0.) && ${SURF_V} != 8) {
    let lw = 1. - abs(sD(pu(p, .7) + .5).a * 2. - 1.); let lw2 = 1. - abs(sD(pu(p.yx, .23) + .2).a * 2. - 1.);
    lacew = lw * .55 + lw2 * .45;
    let wk = wk0;
    slick = sat(wk.y * 1.2);
    foamV = ss(.8 - .3 * wk.x, .9 - .3 * wk.x, lacew) * sat(wk.x * 1.6) * .85;
    // a broken skirt of bubbles round the hull
    let skirt = ss(.2, .1, dh) * ss(.06, .1, dh) * .4 * ss(.72, .8, lacew) * aw;
    // bow wave: a V of foam lines opening behind the nose, stronger with speed
    let vl = ss(.04 + .04 * back, 0., abs(sd - (.10 + .33 * max(back, 0.)))) * ss(-.05, .1, back) * ss(1.3, 0., back);
    let bowK = aw * clamp(su.a.x * .7, 0., 1.);
    let bow = (vl * ss(.68, .8, lacew) * .65 + ss(.3, .0, length(nb)) * ss(.5, .65, lacew)) * bowK;
    foamV = max(foamV, max(skirt, bow));
  }
  // waterline: a thin film where the hull pierces the water (the scene is just behind the surface here and in front of it a few pixels away)
  if (aw > 0. && dh < .4 && dObj < .06) {
    let q = vec2i(i.cp.xy);
    let zn = min(min(textureLoad(tScnD, q + vec2i(3, 0), 0), textureLoad(tScnD, q - vec2i(3, 0), 0)), min(textureLoad(tScnD, q + vec2i(0, 3), 0), textureLoad(tScnD, q - vec2i(0, 3), 0)));
    let zx = max(max(textureLoad(tScnD, q + vec2i(3, 0), 0), textureLoad(tScnD, q - vec2i(3, 0), 0)), max(textureLoad(tScnD, q + vec2i(0, 3), 0), textureLoad(tScnD, q - vec2i(0, 3), 0)));
    if (zx > i.cp.z) { foamV = max(foamV, ss(.06, .0, dObj) * (.5 + .4 * ss(.4, .7, lacew))); }
  }
  // Kelvin wake: divergent waves along the two arms of the 19.5 degree wedge behind the hull, wavelength 2 pi U^2 / g
  let u = su.a.x;
  if (aw > 0. && u > .3 && back > 0. && back < 25. && sd < back * .5 + 1. && ${SURF_V} != 9) {
    let kw = 9.81 / (u * u);
    let arm = sd - back * .354;
    let env = ss(.35 * back + .4, 0., abs(arm)) * exp(-back * .12) * aw * min(u, 1.5) * .06;
    let ph = kw * (back * .94 + sd * .34);
    sl += vec2f(-hdir.y, hdir.x) * sign(dot(rel, vec2f(-hdir.y, hdir.x))) * cos(ph) * env;
  }
  let n0 = normalize(vec3f(-sl.x, 1., -sl.y));
  var n = n0;
  if (dot(n, V) < .02) { n = normalize(n + V * (.02 - dot(n, V))); }
  let NoV = clamp(dot(n, V), 1e-3, 1.);
  let s2 = S.v * (1. - select(.3, 0., ${SURF_V} == 10) * slick);
  let sv = sqrt(s2 * .5);
  // ---- the water body: deep-water reflectance under the sun and the sky, brighter where the view runs flat through a wave face
  let tv = refract(-V, n, 1. / 1.333);
  let horiz = 1. / (.25 + .75 * sat(-tv.y));
  let Ed = vec3f(2.5, 2.25, 1.9) * SKYSUN.y * 3.2 + vec3f(.5, .9, 1.6) * 1.6;
  let Lbody = RRS * Ed * horiz * 1.0;
  // light through thin back-lit crests (turquoise)
  let crest = ss(-.05, .45, i.eta) * (.35 + .65 * pow(sat(dot(-V.xz, normalize(SKYSUN.xz)) * .5 + .5), 2.));
  let sss = vec3f(.02, .32, .30) * crest * (1. - ss(60., 200., d));
  // ---- the reef through the water: the scene copied before the water, sampled where the refracted ray lands
  var under = Lbody;
  if (REFR && ${SURF_V} != 2) {
    let dep = clamp(dObj * max(V.y, 0.), 0., 4.);
    let t0 = refract(-V, vec3f(0., 1., 0.), 1. / 1.333);
    let dl = (tv.xz / max(-tv.y, .25) - t0.xz / max(-t0.y, .25)) * dep * .6 * d / (d + dep / max(V.y, .1));
    let q = g.vp * vec4f(wp + vec3f(dl.x, 0., dl.y), 1.);
    let suv = vec2f(q.x / q.w * .5 + .5, .5 - q.y / q.w * .5);
    let dims = vec2f(textureDimensions(tScn));
    var px = vec2i(clamp(suv * dims, vec2f(0.), dims - 1.));
    if (textureLoad(tScnD, px, 0) > i.cp.z) { px = vec2i(i.cp.xy); }   // that pixel is above the water (the hull): no refraction
    // the water between the surface and what is seen through it: absorbed red first, then green, filled in with the water's own blue
    let Tw = exp(-vec3f(.20, .055, .04) * min(dObj, 80.));
    let sc = textureLoad(tScn, px, 0).rgb * Tw + Lbody * (1. - Tw);
    under = mix(Lbody, sc, ss(.02, .2, V.y) * ss(220., 120., d));
  }
  // ---- foam: whitecaps where the sea folds (the sum of the cascades) and what they leave behind (accumulated per cascade, in label space)
  let wp2 = vec2f(dot(p, WIND), dot(p, vec2f(-WIND.y, WIND.x)));
  let fold = ss(su.o.x, su.o.x - .35, S.J);
  let amt = max(fold * 1.1, S.foam * .9) * (1. - ss(300., 900., d));
  var foamA = 0.; var l3b = .5;
  if (amt > .02) {
    let l1 = sD(wp2 * vec2f(.05, .09) + .3); let l2 = sD(wp2 * vec2f(.21, .34) + .7); let l3 = sD(wp2 * vec2f(.9, 1.3));
    let lace = (1. - abs(l1.a * 2. - 1.)) * .35 + (1. - abs(l2.a * 2. - 1.)) * .4 + (1. - abs(l3.a * 2. - 1.)) * .25;
    let th = amt * 1.5 - 1.15 * (1. - lace);
    foamA = .92 * ss(-.02, .45, th); l3b = l3.b;
  }
  foamA = max(foamA, foamV);
  let plume = sat(fold * 1.5 + S.foam * .4 + wk0.x * .8);
  under = mix(under, under * 1.4 + vec3f(.06, .14, .16), plume * .5);
  // ---- reflection: the sky along the reflected ray; rough water blurs the clouds; rays turned down see the next wave
  var R = reflect(-V, n); let below = ss(0., -.15, R.y); R.y = abs(R.y) + .002; R = normalize(R);
  var sky = select(mix(skyCol(R, t, false), skyBase(R), sat(sqrt(s2) * 2.5)), skyBase(R), ${SURF_V} == 3) * SK;
  sky = mix(sky, .7 * sky + .3 * Lbody, below);
  let Fs = meanFresnel(NoV, sv);
  var col = Fs * sky + (1. - Fs) * (under + sss);
  // ---- the sun: a Gaussian microfacet lobe of the unresolved slopes (the resolved ones are already in n)
  let H = normalize(V + SKYSUN); let zH = max(dot(H, n), 1e-3);
  let t2 = (1. - zH * zH) / (zH * zH); let a2 = max(s2 * .5, 2e-4);
  let pdf = exp(-t2 / (2. * a2)) / (TAU * a2 * zH * zH * zH * zH);
  let zL = max(dot(SKYSUN, n), .01);
  let FH = F0 + (1. - F0) * pow(1. - max(dot(V, H), 0.), 5.);
  var spec = vec3f(1., .95, .85) * 9. * FH * pdf * zL / (4. * NoV * zL + 1e-4) * .5;
  let spL = dot(spec, vec3f(.2126, .7152, .0722));
  if (spL > .6) { spec *= (.6 + .35 * log(1. + (spL - .6) / .35)) / spL; }
  col += spec * (1. - foamA);
  // ---- foam colour: a bubble layer lit by the sun (wrapped) and the sky
  let EdN = vec3f(2.5, 2.25, 1.9) * max((dot(n, SKYSUN) + .6) / 1.6, 0.) * .9 + vec3f(.55, .75, 1.) * (.55 + .45 * n.y);
  let foamC = EdN * (.62 + .25 * l3b) * mix(.8, 1., ss(-.2, .3, i.eta));
  col = mix(col, foamC, foamA);
  // ---- aerial perspective: the far sea takes the colour of the horizon haze, the horizon line stays crisp
  let hz = 1. - exp(-d / 14000.);
  col = mix(col, skyBase(normalize(vec3f(-V.x, .02, -V.z))) * SK * .85, hz);
  if (su.o.y > 3.5) { col = vec3f(wk0.x, wk0.y, lacew) * 3.; }
  else if (su.o.y > .5) { col = select(select(vec3f(fold, S.foam, 0.), vec3f(S.J * .5), su.o.y > 1.5), vec3f(foamA, foamV, 0.), su.o.y > 2.5) * 3.; }   // debug views (__surf.TUNE.dbg)
  return vec4f(min(col, vec3f(40.)), 1.);
}
// the water seen from below (camera under the surface, the crossing): Snell's window, total internal reflection, foam from below
${wgslFn(W_SURF, 'surfBelow')}
@fragment fn fsU(i: VM) -> @location(0) vec4f { return underside(i); }
fn underside(i: VM) -> vec4f {
  let wp = i.wp; let v = wp - g.cam.xyz; let d = length(v);
  let S = slopes(i.lp, 1.);
  var c = surfBelow(wp);
  // foam and the bubbles of breaking crests, bright from below
  c = mix(c, vec3f(.9, 1., 1.05) * 1.6, sat(S.foam * 1.2 + ss(su.o.x, su.o.x - .3, S.J)) * .55);
  c = fin(fog(c, wp, zone(wp))).rgb;
  // the meniscus: close to the lens the water film is bright and its edge wavers, so the cut is not a straight seam
  let nz = sD(pu(wp.xz * 2.3, 1.1)).b + sD(pu(wp.zx * 5., .7)).a * .5;
  let rim = ss(.3 + .2 * (nz - .7), .1, d);
  return vec4f(mix(c, vec3f(.55, .95, 1.1) * 1.2, rim * .6), 1.);
}
`;

// ---------------------------------------------------------------- the FFT ocean (compute)
const W_OCEAN = /*wgsl*/`
struct OU { t: f32, dt: f32, decay: f32, thr: f32, gain: f32, chop: f32, flip: u32, pad: f32, kbar: vec4f, L: vec4f }
@group(0) @binding(0) var<uniform> ou: OU;
@group(0) @binding(1) var<storage, read> h0: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> fb: array<vec4f>;
@group(0) @binding(3) var tPrev: texture_2d_array<f32>;
@group(0) @binding(4) var oDisp: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(5) var oDer: texture_storage_2d_array<rgba16float, write>;
const N = ${OC_N}u; const NF = ${OC_N}.; const LOGN = ${Math.log2(OC_N)}u; const TAU = 6.2831853;
var<workgroup> sa: array<vec4f, ${OC_N}>;
var<workgroup> sb: array<vec4f, ${OC_N}>;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn mulI(a: vec2f) -> vec2f { return vec2f(-a.y, a.x); }
fn cm2(w: vec2f, a: vec4f) -> vec4f { return vec4f(cmul(w, a.xy), cmul(w, a.zw)); }
fn brev(m: u32) -> u32 { return reverseBits(m) >> (32u - LOGN); }
// in-place radix-2 inverse FFT (e^{+i}) of the bit-reversed rows in sa, sb; thread j does one butterfly per stage
fn fft(j: u32) {
  for (var s = 1u; s <= LOGN; s++) {
    workgroupBarrier();
    let half = 1u << (s - 1u); let k = j % half; let i0 = (j / half) * 2u * half + k; let i1 = i0 + half;
    let an = TAU * f32(k) / f32(2u * half); let w = vec2f(cos(an), sin(an));
    let a0 = sa[i0]; let a1 = cm2(w, sa[i1]); sa[i0] = a0 + a1; sa[i1] = a0 - a1;
    let b0 = sb[i0]; let b1 = cm2(w, sb[i1]); sb[i0] = b0 + b1; sb[i1] = b0 - b1;
  }
  workgroupBarrier();
}
// h(k, t) and the spectra of eight real fields, packed two per complex number:
// (Dx + i h, Dz + i dh/dx), (dh/dz + i dDx/dx, dDz/dz + i dDx/dz)
fn evolve(u: u32, v: u32, c: u32) -> array<vec4f, 2> {
  let s = h0[(c * N + v) * N + u];
  let k = (vec2f(f32(u), f32(v)) - NF * .5) * TAU / ou.L[c];
  let kl = length(k);
  let w = sqrt((9.81 * kl + 7.12e-5 * kl * kl * kl) * tanh(min(kl * ${SURF_DEPTH}., 20.)));
  let ph = (w * ou.t) % TAU;
  let e = vec2f(cos(ph), sin(ph));
  let h = cmul(s.xy, vec2f(e.x, -e.y)) + cmul(s.zw, e);
  let kn = select(vec2f(0.), k / kl, kl > 0.); let ik = select(0., 1. / kl, kl > 0.);
  let ih = mulI(h);
  let Dx = ih * kn.x; let Dz = ih * kn.y; let hx = ih * k.x; let hz = ih * k.y;
  let Dxx = -h * k.x * k.x * ik; let Dzz = -h * k.y * k.y * ik; let Dxz = -h * k.x * k.y * ik;
  return array<vec4f, 2>(vec4f(Dx + mulI(h), Dz + mulI(hx)), vec4f(hz + mulI(Dxx), Dzz + mulI(Dxz)));
}
@compute @workgroup_size(${OC_N / 2}) fn rows(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let v = wg.x; let c = wg.y; let j = li.x;
  for (var r = 0u; r < 2u; r++) {
    let u = j + r * (N / 2u);
    let e = evolve(u, v, c);
    let b = brev(u); sa[b] = e[0]; sb[b] = e[1];
  }
  fft(j);
  for (var r = 0u; r < 2u; r++) {
    let m = j + r * (N / 2u); let o = ((c * N + v) * N + m) * 2u;
    fb[o] = sa[m]; fb[o + 1u] = sb[m];
  }
}
@compute @workgroup_size(${OC_N / 2}) fn cols(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let u = wg.x; let c = wg.y; let j = li.x;
  for (var r = 0u; r < 2u; r++) {
    let v = j + r * (N / 2u); let o = ((c * N + v) * N + u) * 2u;
    let b = brev(v); sa[b] = fb[o]; sb[b] = fb[o + 1u];
  }
  fft(j);
  let kb = ou.kbar[c]; let ch = ou.chop;
  for (var r = 0u; r < 2u; r++) {
    let v = j + r * (N / 2u);
    // the spectrum is centred (k = 0 at N/2): undo it with (-1)^(u + v)
    let sg = select(-1., 1., ((u + v) & 1u) == 0u);
    let a = sa[v] * sg; let b = sb[v] * sg;
    // a = (Dx, h, Dz, hx), b = (hz, Dxx, Dzz, Dxz)
    let D = a.xz;
    // second-order Lagrangian mean level (Fouques, Krogstad & Myrhaug 2006): restores the crest / trough asymmetry
    let h = a.y + ch * .5 * kb * (a.y * a.y + dot(D, D));
    let gx = a.w + ch * kb * (a.y * a.w + D.x * b.y + D.y * b.w);
    let gz = b.x + ch * kb * (a.y * b.x + D.x * b.w + D.y * b.z);
    let Dxx = ch * b.y; let Dzz = ch * b.z; let Dxz = ch * b.w;
    let J = (1. + Dxx) * (1. + Dzz) - Dxz * Dxz;
    // foam of this band: injected where it folds, fading with the e-folding time ou.decay
    let pv = textureLoad(tPrev, vec2u(u, v), c, 0).w;
    let thr = select(-9., ou.thr - .2 + f32(c) * .05, c < 2u);
    let fo = max(pv * exp(-ou.dt / ou.decay), clamp((thr - J) * ou.gain, 0., 1.));
    textureStore(oDisp, vec2u(u, v), c, vec4f(D.x * ch, h, D.y * ch, fo));
    textureStore(oDer, vec2u(u, v), c, vec4f(gx, gz, Dxx, Dzz));
  }
}
`;
// the hull's foam trail, drawn into a 64 m square texture round its newest point every frame (the water reads one texel
// instead of walking the whole trail per pixel)
const W_WAKE = /*wgsl*/`
struct SU { a: vec4f, o: vec4f, sv: vec4f, bb: vec4f, w: array<vec4f, ${SURF_TRAIL}> }
@group(0) @binding(0) var<uniform> su: SU;
@group(0) @binding(1) var oWake: texture_storage_2d<rgba16float, write>;
const PER = ${PER}.;
fn wr(a: f32) -> f32 { return a - PER * round(a / PER); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${SURF_WK}u || id.y >= ${SURF_WK}u) { return; }
  // c0: the newest point seen from this texel
  let c0 = -((vec2f(id.xy) + .5) / ${SURF_WK}. - .5) * ${SURF_WKE}. - (su.o.zw - su.w[0].xy);
  var acc = 0.; var edge = 0.;
  if (su.w[0].w > 0. && all(-c0 >= su.bb.xy) && all(-c0 <= su.bb.zw)) {
    var a = c0; let t = su.a.z;
    for (var k = 1; k < ${SURF_TRAIL}; k++) {
      let q = su.w[k]; let pv = su.w[k - 1];
      if (q.w <= 0.) { break; }
      let b = a + vec2f(wr(q.x - pv.x), wr(q.y - pv.y));
      let ab = b - a; let h = clamp(-dot(a, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
      let dd = length(a + ab * h);
      let age = t - mix(pv.z, q.z, h);
      let s = mix(pv.w, q.w, h);
      // the white wash: narrow, gone in a couple of seconds; the slick it leaves: wider, smoother water that lasts
      let w = .07 + .04 * age;
      acc = max(acc, s * exp(-age * 1.8) * ss(w, w * .25, dd));
      let ws = .12 + .12 * age;
      edge = max(edge, s * exp(-age * .22) * ss(ws, ws * .4, dd));
      a = b;
    }
  }
  textureStore(oWake, id.xy, vec4f(acc, edge, 0., 0.));
}
`;
// mips of the displacement and slope textures (2x2 box)
const W_OCEANMIP = /*wgsl*/`
@group(0) @binding(0) var sDisp: texture_2d_array<f32>;
@group(0) @binding(1) var dDisp: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var sDer: texture_2d_array<f32>;
@group(0) @binding(3) var dDer: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(dDisp).x;
  if (id.x >= n || id.y >= n) { return; }
  let p = id.xy * 2u; let c = id.z;
  let a = textureLoad(sDisp, p, c, 0) + textureLoad(sDisp, p + vec2u(1u, 0u), c, 0) + textureLoad(sDisp, p + vec2u(0u, 1u), c, 0) + textureLoad(sDisp, p + vec2u(1u, 1u), c, 0);
  let b = textureLoad(sDer, p, c, 0) + textureLoad(sDer, p + vec2u(1u, 0u), c, 0) + textureLoad(sDer, p + vec2u(0u, 1u), c, 0) + textureLoad(sDer, p + vec2u(1u, 1u), c, 0);
  textureStore(dDisp, id.xy, c, a * .25);
  textureStore(dDer, id.xy, c, b * .25);
}
`;
// the probe: the sea under a few world points (the vehicle, the camera): the label whose displaced position lands on the
// point (fixed-point iteration), then height, slope and Jacobian there
const W_OCEANPROBE = /*wgsl*/`
@group(0) @binding(0) var<uniform> pts: array<vec4f, ${SURF_NP}>;
@group(0) @binding(1) var tDisp: texture_2d_array<f32>;
@group(0) @binding(2) var tDer: texture_2d_array<f32>;
@group(0) @binding(3) var sL: sampler;
@group(0) @binding(4) var<storage, read_write> outp: array<vec4f, ${SURF_NP}>;
const OL = array<f32, 3>(${OC_L.join(', ')});
fn D(p: vec2f) -> vec4f { var r = vec4f(0.); for (var c = 0; c < 3; c++) { r += textureSampleLevel(tDisp, sL, p / OL[c] + .5 / ${OC_N}., c, 0.); } return r; }
@compute @workgroup_size(${SURF_NP}) fn main(@builtin(local_invocation_id) li: vec3u) {
  let p = pts[li.x].xy;
  var x0 = p;
  for (var it = 0; it < 6; it++) { x0 = p - D(x0).xz; }
  let d = D(x0);
  var gr = vec4f(0.);
  for (var c = 0; c < 3; c++) { gr += textureSampleLevel(tDer, sL, x0 / OL[c] + .5 / ${OC_N}., c, 0.); }
  let jx = max(1. + gr.z, .2); let jz = max(1. + gr.w, .2);
  outp[li.x] = vec4f(d.y, gr.x / jx, gr.y / jz, jx * jz);
}
`;

// ---------------------------------------------------------------- GPU side
const SURF_SKIP = { sky: false, water: false, ocean: false };
const SURF_TUNE = { thr: 0.72, gain: 2.0, decay: 3.0, dbg: 0 };
let surfFloorTex = null;
// the world's ground map (floor height per cell) as a texture, once the world is built
function surfFloor(map) {
  const b = new Uint8Array(NX * NZ);
  for (let i = 0; i < b.length; i++) b[i] = clamp((map[i * 4 + 1] + 40) / 40, 0, 1) * 255 + 0.5;
  Q.writeTexture({ texture: surfFloorTex }, b, { bytesPerRow: NX }, [NX, NZ]);
}
let surfOn = false;                 // the camera is near or above the water: the sky and the mesh are drawn
let surfBGL = null, surfBG = [null, null], surfUBO = null, pSurfSky = null, pSurfLens = null, pSurfWater = null, pSurfUnder = null, surfVB = null, surfIB = null, surfNI = 0;
let ocU = null, ocUF = null, ocUB = null, ocBG = [null, null], ocMipBG = [[], []], pOcRows = null, pOcCols = null, pOcMip = null, ocDisp = [null, null], ocDer = null, ocK = 0, ocLastT = -1;
let prU = null, prUB = null, prOut = null, prBG = [null, null], pProbe = null;
const prRing = [];                  // readback buffers: {b, busy, t, pts}
let surfWakeT = null, pWake = null, wakeBG = null, surfSO = null, surfScn = null, surfScnD = null, surfPass = null, surfDummy = null, surfTS = null;
const surfU = new Float32Array(16 + SURF_TRAIL * 4);
async function surfInit() {
  const N = OC_N, NC = OC_NC, VFr = SS.VERTEX | SS.FRAGMENT;
  // ---- the FFT ocean
  const mips = 6;
  const mkArr = () => device.createTexture({ size: [N, N, NC], format: 'rgba16float', mipLevelCount: mips, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
  ocDisp = [mkArr(), mkArr()]; ocDer = mkArr();
  const h0b = buf(OC.h0, BU.STORAGE), fbb = device.createBuffer({ size: NC * N * N * 32, usage: BU.STORAGE });
  ocU = new ArrayBuffer(64); ocUF = new Float32Array(ocU); ocUB = device.createBuffer({ size: 64, usage: BU.UNIFORM | BU.COPY_DST });
  const mO = mod(W_OCEAN), C = SS.COMPUTE;
  const av = (t, l) => t.createView({ dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 });
  const bglO = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: {} }, { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: C, buffer: { type: 'storage' } },
    { binding: 3, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } }, { binding: 5, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } }] });
  const plO = device.createPipelineLayout({ bindGroupLayouts: [bglO] });
  pOcRows = device.createComputePipeline({ layout: plO, compute: { module: mO, entryPoint: 'rows' } });
  pOcCols = device.createComputePipeline({ layout: plO, compute: { module: mO, entryPoint: 'cols' } });
  for (let k = 0; k < 2; k++) ocBG[k] = device.createBindGroup({ layout: bglO, entries: [{ binding: 0, resource: { buffer: ocUB } }, { binding: 1, resource: { buffer: h0b } }, { binding: 2, resource: { buffer: fbb } },
    { binding: 3, resource: av(ocDisp[1 - k], 0) }, { binding: 4, resource: av(ocDisp[k], 0) }, { binding: 5, resource: av(ocDer, 0) }] });
  const mM = mod(W_OCEANMIP);
  const bglM = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => b & 1 ? { binding: b, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } }
    : { binding: b, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }) });
  pOcMip = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglM] }), compute: { module: mM, entryPoint: 'main' } });
  for (let k = 0; k < 2; k++) for (let l = 1; l < mips; l++) ocMipBG[k].push(device.createBindGroup({ layout: bglM, entries: [{ binding: 0, resource: av(ocDisp[k], l - 1) }, { binding: 1, resource: av(ocDisp[k], l) },
    { binding: 2, resource: av(ocDer, l - 1) }, { binding: 3, resource: av(ocDer, l) }] }));
  // ---- the probe
  prU = new Float32Array(SURF_NP * 4); prUB = device.createBuffer({ size: prU.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
  prOut = device.createBuffer({ size: SURF_NP * 16, usage: BU.STORAGE | BU.COPY_SRC });
  const sLin = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' });
  const mP = mod(W_OCEANPROBE);
  const bglP = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: {} }, { binding: 1, visibility: C, texture: { viewDimension: '2d-array' } }, { binding: 2, visibility: C, texture: { viewDimension: '2d-array' } },
    { binding: 3, visibility: C, sampler: {} }, { binding: 4, visibility: C, buffer: { type: 'storage' } }] });
  pProbe = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglP] }), compute: { module: mP, entryPoint: 'main' } });
  for (let k = 0; k < 2; k++) prBG[k] = device.createBindGroup({ layout: bglP, entries: [{ binding: 0, resource: { buffer: prUB } }, { binding: 1, resource: ocDisp[k].createView({ dimension: '2d-array' }) },
    { binding: 2, resource: ocDer.createView({ dimension: '2d-array' }) }, { binding: 3, resource: sLin }, { binding: 4, resource: { buffer: prOut } }] });
  for (let i = 0; i < 3; i++) prRing.push({ b: device.createBuffer({ size: SURF_NP * 16, usage: BU.MAP_READ | BU.COPY_DST }), busy: false, t: 0, pts: new Float64Array(SURF_NP * 2), cpu: new Float64Array(SURF_NP * 3) });
  // ---- the wake texture
  surfWakeT = device.createTexture({ size: [SURF_WK, SURF_WK], format: 'rgba16float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
  // ---- the render side
  const m = mod(W_SURFA);
  surfBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFr, buffer: {} }, { binding: 1, visibility: VFr, buffer: {} }, { binding: 2, visibility: VFr, texture: {} },
    { binding: 3, visibility: VFr, texture: { viewDimension: '2d-array' } }, { binding: 4, visibility: VFr, texture: { viewDimension: '2d-array' } },
    { binding: 5, visibility: VFr, buffer: { type: 'read-only-storage' } }, { binding: 6, visibility: VFr, texture: { sampleType: 'unfilterable-float' } }, { binding: 7, visibility: VFr, texture: { sampleType: 'depth' } },
    { binding: 8, visibility: VFr, sampler: {} }, { binding: 9, visibility: VFr, texture: {} }] });
  surfSO = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: SURF_V === 6 ? 1 : 2 });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [bgl0, surfBGL] });
  surfFloorTex = device.createTexture({ size: [NX, NZ], format: 'r8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  surfDummy = device.createBuffer({ size: 16, usage: BU.UNIFORM });
  surfUBO = device.createBuffer({ size: surfU.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
  {
    const mW = mod(W_WAKE);
    const bglW = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: {} }, { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } }] });
    pWake = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bglW] }), compute: { module: mW, entryPoint: 'main' } });
    wakeBG = device.createBindGroup({ layout: bglW, entries: [{ binding: 0, resource: { buffer: surfUBO } }, { binding: 1, resource: surfWakeT.createView() }] });
  }
  pSurfSky = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsSky' }, fragment: { module: m, entryPoint: 'fsSky', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
  pSurfLens = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsSky' }, fragment: { module: m, entryPoint: 'fsLens', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'always' }, multisample: { count: AA } });
  const vb = [{ arrayStride: 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'uint8x4' }] }];
  pSurfWater = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsM', buffers: vb }, fragment: { module: m, entryPoint: 'fsM', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
  pSurfUnder = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsM', buffers: vb }, fragment: { module: m, entryPoint: 'fsU', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-list', cullMode: 'front' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
  // clipmap: ring l covers M x M cells of spacing SP0 * 2^l, less the hole the finer ring fills (two coarse cells smaller, so they overlap)
  const M = SURF_M, verts = [], idx = [];
  for (let l = 0; l < SURF_LV; l++) {
    const hole = l === 0 ? -1 : M / 4 - 2, base = verts.length / 4, id = new Int32Array((M + 1) * (M + 1)).fill(-1);
    const vid = (i, j) => { const k = j * (M + 1) + i; if (id[k] < 0) { id[k] = verts.length / 4 - base; verts.push(i, j, l, 0); } return base + id[k]; };
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      if (abs(i - M / 2 + 0.5) < hole && abs(j - M / 2 + 0.5) < hole) continue;
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
  }
  surfVB = buf(new Uint8Array(verts), BU.VERTEX); surfIB = buf(new Uint32Array(idx), BU.INDEX); surfNI = idx.length;
}
// (re)made with the render targets (main.js resize): the copy of the scene under the water and the pass that draws the water over it
function surfResize(tRes, tDp) {
  if (surfScn) { surfScn.destroy(); surfScnD.destroy(); }
  const w = AA === 1 ? W : 1, h = AA === 1 ? H : 1;
  surfScn = device.createTexture({ size: [w, h], format: HDR, usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  surfScnD = device.createTexture({ size: [w, h], format: DEPTH, usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  surfScn.src = tRes; surfScnD.src = tDp;
  for (let k = 0; k < 2; k++) surfBG[k] = device.createBindGroup({ layout: surfBGL, entries: [{ binding: 0, resource: { buffer: surfDummy } }, { binding: 1, resource: { buffer: surfUBO } }, { binding: 2, resource: surfFloorTex.createView() },
    { binding: 3, resource: ocDisp[k].createView({ dimension: '2d-array' }) }, { binding: 4, resource: ocDer.createView({ dimension: '2d-array' }) }, { binding: 5, resource: { buffer: prOut } },
    { binding: 6, resource: surfScn.createView() }, { binding: 7, resource: surfScnD.createView() }, { binding: 8, resource: surfSO }, { binding: 9, resource: surfWakeT.createView() }] });
  surfPass = AA === 1 ? { colorAttachments: [{ view: tRes.createView(), loadOp: 'load', storeOp: 'store' }], depthStencilAttachment: { view: tDp.createView(), depthLoadOp: 'load', depthStoreOp: 'store' } } : null;
}
// every frame, after the vehicle has moved: the track of foam it leaves and the uniforms
function surfUpdate() {
  const t = F[TIME], cy = F[CY];
  surfOn = cy > -0.4;   // deeper, the look piece's own surface (shaders.js W_SURF) takes over
  surfU[0] = abs(lv.v[0]); surfU[1] = cy < pr0H() ? 1 : 0; surfU[2] = lv.t; surfU[3] = abs(lv.pos[1] - lv.surfY);
  surfU[4] = SURF_TUNE.thr; surfU[5] = SURF_TUNE.dbg;
  { const tx = SURF_WKE / SURF_WK, p = surfTrail[0]; surfU[6] = p ? Math.round(p.x / tx) * tx : 0; surfU[7] = p ? Math.round(p.z / tx) * tx : 0; }
  surfU[8] = OC.cas[0].slope; surfU[9] = OC.cas[1].slope; surfU[10] = OC.cas[2].slope; surfU[11] = OC.resid;
  // the wake's bounding box round its newest point, grown by the widest the trail gets (its oldest point's width)
  let x0 = 0, z0 = 0, x1 = 0, z1 = 0;
  const p0 = surfTrail[0];
  for (let i = 1; i < surfTrail.length; i++) { const dx = wrapD(surfTrail[i].x - p0.x), dz = wrapD(surfTrail[i].z - p0.z); if (dx < x0) x0 = dx; if (dx > x1) x1 = dx; if (dz < z0) z0 = dz; if (dz > z1) z1 = dz; }
  const mg = p0 ? 1.2 + 0.25 * Math.max(0, lv.t - surfTrail[surfTrail.length - 1].t) : 0;
  surfU[12] = x0 - mg; surfU[13] = z0 - mg; surfU[14] = x1 + mg; surfU[15] = z1 + mg;
  for (let i = 0; i < SURF_TRAIL; i++) {
    const p = surfTrail[i], o = 16 + i * 4;
    if (p) { surfU[o] = p.x; surfU[o + 1] = p.z; surfU[o + 2] = p.t; surfU[o + 3] = p.s; } else { surfU[o] = surfU[o + 1] = surfU[o + 2] = 0; surfU[o + 3] = 0; }
  }
  Q.writeBuffer(surfUBO, 0, surfU);
  // the ocean: time, foam, the probe points (the vehicle, the camera)
  const f = ocUF;
  const dt = ocLastT < 0 ? 0 : clamp(t - ocLastT, 0, 0.1); ocLastT = t;
  f[0] = t; f[1] = dt; f[2] = SURF_TUNE.decay; f[3] = SURF_TUNE.thr; f[4] = SURF_TUNE.gain; f[5] = SURF_CHOP; f[6] = 0; f[7] = 0;
  for (let c = 0; c < 3; c++) { f[8 + c] = OC.cas[c].kbar; f[12 + c] = OC_L[c]; }
  Q.writeBuffer(ocUB, 0, ocU);
  prU[0] = lv.pos[0]; prU[1] = lv.pos[2]; prU[4] = F[CX]; prU[5] = F[CZ];
  lv.toWorld(-0.6, 0, 0, lauvTmp); prU[8] = lauvTmp[0]; prU[9] = lauvTmp[2];
  lv.toWorld(1.2, 0, 0, lauvTmp); prU[12] = lauvTmp[0]; prU[13] = lauvTmp[2];
  Q.writeBuffer(prUB, 0, prU);
}
// the ocean compute (every frame: the physics and the camera use it under water too), then the probe and its readback
function surfCompute(e, tsw) {
  ocK ^= 1;
  const c = e.beginComputePass(tsw ? { timestampWrites: tsw } : undefined);
  if (!SURF_SKIP.ocean) {
    c.setBindGroup(0, ocBG[ocK]);
    c.setPipeline(pOcRows); c.dispatchWorkgroups(OC_N, OC_NC);
    c.setPipeline(pOcCols); c.dispatchWorkgroups(OC_N, OC_NC);
    c.setPipeline(pOcMip);
    for (let l = 1; l < 6; l++) { c.setBindGroup(0, ocMipBG[ocK][l - 1]); const n = OC_N >> l; c.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8), OC_NC); }
  }
  c.setPipeline(pProbe); c.setBindGroup(0, prBG[ocK]); c.dispatchWorkgroups(1);
  if (surfOn && surfTrail.length) { c.setPipeline(pWake); c.setBindGroup(0, wakeBG); c.dispatchWorkgroups(SURF_WK / 8, SURF_WK / 8); }
  c.end();
  let slot = null; for (let i = 0; i < prRing.length; i++) if (!prRing[i].busy) { slot = prRing[i]; break; }
  if (slot) {
    e.copyBufferToBuffer(prOut, 0, slot.b, 0, SURF_NP * 16);
    slot.busy = true; slot.pend = true; slot.t = F[TIME];
    for (let i = 0; i < SURF_NP; i++) { slot.pts[i * 2] = prU[i * 4]; slot.pts[i * 2 + 1] = prU[i * 4 + 1]; }
  }
  return slot;
}
// after the submit: read the probe back; the difference to the CPU sea at the same points and time corrects the CPU sea
function surfProbeRead(slot) {
  if (!slot) return;
  slot.b.mapAsync(GPUMapMode.READ).then(() => {
    const a = new Float32Array(slot.b.getMappedRange());
    for (let i = 0; i < 2; i++) {
      const x = slot.pts[i * 2], z = slot.pts[i * 2 + 1], c = surfCor[i];
      surfEval(x, z, slot.t, surfS);
      c[0] = x; c[1] = z; c[2] = slot.t; c[3] = a[i * 4] - surfS.h; c[4] = a[i * 4 + 1] - surfS.sx; c[5] = a[i * 4 + 2] - surfS.sz;
    }
    slot.b.unmap(); slot.busy = false;
  }, () => { slot.busy = false; });
}
// the sky first (it sits at the far plane)
function surfDrawSky(r) { if (!surfOn || SURF_SKIP.sky) return false; r.setBindGroup(1, surfBG[ocK]); r.setPipeline(pSurfSky); r.draw(4); return true; }
// the water: from above, the scene drawn so far is copied (it is what the refracted rays see) and the water is drawn over
// it in a pass of its own; from below, its underside in the scene pass. Returns the open render pass.
function surfDrawWater(e, r, ts) {
  if (SURF_SKIP.water) return r;
  const above = F[CY] > pr0H() - 0.05;
  if (above && surfPass) {
    r.end();
    if (SURF_V !== 4) {
      e.copyTextureToTexture({ texture: surfScn.src }, { texture: surfScn }, [W, H]);
      e.copyTextureToTexture({ texture: surfScnD.src }, { texture: surfScnD }, [W, H]);
    }
    surfPass.timestampWrites = ts;
    r = e.beginRenderPass(surfPass);
    r.setBindGroup(0, bg0);
  }
  r.setBindGroup(1, surfBG[ocK]); r.setVertexBuffer(0, surfVB); r.setIndexBuffer(surfIB, 'uint32');
  // the top first, then the underside, which shows only from below or across the lens (its faces hidden behind the top fail the depth test early)
  r.setPipeline(pSurfWater); r.drawIndexed(surfNI);
  if (F[CY] - pr0H() < 0.35) { r.setPipeline(pSurfUnder); r.drawIndexed(surfNI); }
  if (above && surfPass && F[CY] > 0 && F[CY] < 1.5) { r.setPipeline(pSurfLens); r.draw(4); }
  return r;
}
// the height of the sea at the camera (CPU sea with the probe's correction)
function pr0H() { return surfWaveAt(F[CX], F[CZ], F[TIME], surfS).h; }
window.__surf = { OC, TUNE: SURF_TUNE, cor: surfCor, trail: surfTrail, U: surfU, eval: (x, z) => surfEval(x, z, F[TIME], {}) };
