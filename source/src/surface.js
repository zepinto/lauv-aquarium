// ============================================================================
// THE SURFACE: the sea seen from above (sky, sun, clouds, waves, reflection, foam, wake), the same waves for the hull,
// and the waterline when the camera dips through.
// ============================================================================
// Waves: a sum of sines whose wave vectors are whole numbers of 2*PI/PER, so the sea repeats with the world (a torus).
// surfWaveAt() here and wave() in the shader are the same function: the water, the hull and the camera agree.
const SURF_SEA = 0.65;   // sea state scale (1 = about 0.2 m rms)
const SURF_N = [[4, 2, 0.008], [7, -3, 0.015], [11, 4, 0.025], [17, -8, 0.035], [26, 9, 0.05], [38, -15, 0.06], [57, 20, 0.065], [83, -34, 0.06]];   // nx, nz, steepness a*k
const SURF_W = SURF_N.map(([nx, nz, st], i) => {
  const kx = TAU * nx / PER, kz = TAU * nz / PER, k = hypot(kx, kz);
  return { kx, kz, a: SURF_SEA * st / k, w: 0.8 * sqrt(9.81 * k), ph: i * 1.7 + 0.5 };
});
const surfS = { h: 0, sx: 0, sz: 0, vy: 0 };
// height, slope and vertical speed of the water at (x, z) at time t, into o
function surfWaveAt(x, z, t, o) {
  let h = 0, sx = 0, sz = 0, vy = 0;
  for (let i = 0; i < SURF_W.length; i++) {
    const w = SURF_W[i], p = w.kx * x + w.kz * z - w.w * t + w.ph, s = sin(p), c = cos(p);
    h += w.a * s; sx += w.a * w.kx * c; sz += w.a * w.kz * c; vy -= w.a * w.w * c;
  }
  o.h = h; o.sx = sx; o.sz = sz; o.vy = vy; return o;
}
// the hull's view of it (called by the physics every step)
function surfWave(v) {
  surfWaveAt(v.pos[0], v.pos[2], F[TIME], surfS);
  v.surfY = surfS.h; v.surfSx = surfS.sx; v.surfSz = surfS.sz; v.surfVy = surfS.vy;
}

const SURF_NR = 130, SURF_NS = 256, SURF_TRAIL = 48;
const W_SURFA = S_B + /*wgsl*/`
struct SU { a: vec4f, w: array<vec4f, ${SURF_TRAIL}> }   // a: x speed, y rpm, z wave height at the camera, w the hull's height above the water; w: wake points (x, z, birth time, strength), newest first
@group(1) @binding(1) var<uniform> su: SU;
const WV = array<vec4f, 8>(${SURF_W.map((w) => `vec4f(${w.kx}, ${w.kz}, ${w.a}, ${w.w})`).join(', ')});
const WPH = array<f32, 8>(${SURF_W.map((w) => w.ph).join(', ')});
const SK = 2.5;   // the sky is written in display units; the exposure above the water is 0.6 * 0.62
const WIND = vec2f(.8, .35);
// (height, d/dx, d/dz); the short waves fade out with distance so they do not alias
fn wave(p: vec2f, t: f32, d: f32) -> vec3f {
  var r = vec3f(0.);
  let q = vec2f(wr(p.x), wr(p.y));
  for (var i = 0; i < 8; i++) {
    let w = WV[i];
    let lam = TAU / length(w.xy);
    let f = 1. - ss(lam * 22., lam * 45., d);
    let ph = dot(w.xy, q) - w.w * t + WPH[i];
    r += vec3f(sin(ph), cos(ph) * w.x, cos(ph) * w.y) * (w.z * f);
  }
  return r;
}
fn vn(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  let a = hs(dot(i, vec2f(1., 57.))); let b = hs(dot(i + vec2f(1., 0.), vec2f(1., 57.)));
  let c = hs(dot(i + vec2f(0., 1.), vec2f(1., 57.))); let d = hs(dot(i + vec2f(1., 1.), vec2f(1., 57.)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0; var a = .5; var s = 0.;
  for (var i = 0; i < oct; i++) { s += a * vn(p); p = vec2f(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + 11.3; a *= .5; }
  return s;
}
const HAZE = vec3f(.42, .62, .84);
fn skyBase(rd: vec3f) -> vec3f {
  let y = max(rd.y, 0.);
  var c = mix(HAZE, vec3f(.035, .20, .70), pow(y, .5));
  c = mix(c, vec3f(.62, .76, .90), (1. - ss(0., .10, y)) * .45);
  let sd = sat(dot(rd, g.sun.xyz));
  c += vec3f(1., .86, .62) * (pow(sd, 5.) * .10 + pow(sd, 48.) * .30);
  return c;
}
// the clouds: a flat layer, lit from the sun's side. full: shaded (the sky), otherwise a flat white (the reflection)
fn clouds(rd: vec3f, base: vec3f, t: f32, full: bool) -> vec3f {
  if (rd.y < .01) { return base; }
  let uv = rd.xz / (rd.y + .14) * 2.2 + vec2f(t * .006, t * .0022) + vec2f(3.1, 7.7);
  let n1 = fbm(uv, select(3, 5, full));
  let cov = ss(.47, .64, n1) * ss(.01, .14, rd.y);
  if (cov <= 0.) { return base; }
  var lit = .8;
  if (full) { let n2 = fbm(uv + g.sun.xz * .22, 4); lit = sat(.62 - (n2 - n1) * 4.5); }
  var cc = mix(vec3f(.40, .48, .66), vec3f(1.15, 1.1, 1.05), lit);
  cc *= 1. - .22 * ss(.62, .85, n1);
  cc += (1. - cov) * .18;
  return mix(base, cc, cov * .94);
}
fn skyCol(rd: vec3f, t: f32, full: bool) -> vec3f {
  var c = skyBase(rd);
  c = clouds(rd, c, t, full);
  let sd = dot(rd, g.sun.xyz);
  c += vec3f(1., .95, .85) * (ss(.9996, .99985, sd) * 40.) * select(0., 1., full);
  return c;
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
  let ny = g.cam.y + rd.y * (g.fwd.w / dot(rd, g.fwd.xyz));
  let z = g.sun.w;
  if (ny > su.a.z) {
    var c = skyCol(rd, g.cam.w, true) * SK;
    if (rd.y < 0.) { c = mix(c, fogIn(vec3f(0.), rd, 240., z, g.sun.xyz) * .62, sat(-rd.y * 28.)); }
    return fin(c);
  }
  return fin(fog(vec3f(0.), g.cam.xyz + rd * 240., z));
}

// ---- the mesh: rings round the camera, spaced more widely with distance
struct VM { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vsM(@builtin(vertex_index) vi: u32) -> VM {
  var o: VM;
  let i = f32(vi / ${SURF_NS + 1}u); let j = f32(vi % ${SURF_NS + 1}u);
  let r = 2.667 * (exp(.045 * i) - 1.);
  let a = j / ${SURF_NS}. * TAU;
  let p = vec2f(g.cam.x + r * cos(a), g.cam.z + r * sin(a));
  o.wp = vec3f(p.x, wave(p, g.cam.w, r).x, p.y);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
// the water seen from below: the world piece's own look (same maths as W_SURF), on the displaced mesh
fn below(wp: vec3f) -> vec4f {
  let v = wp - g.cam.xyz; let d = length(v); let V = v / d;
  let fl = ss(260., 60., d);
  let s = (textureSample(tW, sR, pu(wp.xz, 13.)).ba + textureSample(tW, sR, pu(wp.zx, 4.7) + .2).ba * .7 + textureSample(tW, sR, pu(wp.xz, 37.) + .6).ba * .8) * fl;
  let n = normalize(vec3f(-s.x * .8, -1., -s.y * .8));
  let ci = sat(dot(V, -n));
  let k = 1. - 1.769 * (1. - ci * ci);
  let win = ss(0., .22, k);
  let rr = refract(V, n, 1.33);
  let sd = max(dot(rr, g.sun.xyz), 0.);
  let fr = pow(1. - sqrt(max(k, 0.)), 5.);
  let sky = (vec3f(.30, .78, 1.) * 1.3 * clamp(1. + 3.8 * (s.x * .6 - s.y * .8), .25, 3.) + vec3f(1., .95, .85) * (pow(sd, 60.) * 1.3 + pow(sd, 500.) * 12.)) * (1. - fr);
  let z = zone(wp);
  let R = reflect(V, n);
  let refl = fogIn(wp, R, 300., z, g.sun.xyz) * 1.15;
  let c = mix(refl, sky, win);
  return fin(fog(c, wp, z));
}
// foam trail of the hull: the points of the track, each one's width growing and strength fading with its age
fn wake(p: vec3f, t: f32) -> f32 {
  let c0 = wd(vec3f(su.w[0].x, 0., su.w[0].y) - p).xz;
  if (dot(c0, c0) > 1200. || su.w[0].w <= 0.) { return 0.; }
  var acc = 0.; var a = c0;
  for (var k = 1; k < ${SURF_TRAIL}; k++) {
    let q = su.w[k]; let pv = su.w[k - 1];
    if (q.w <= 0.) { break; }
    let b = a + wd(vec3f(q.x - pv.x, 0., q.y - pv.y)).xz;
    let ab = b - a; let h = clamp(-dot(a, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
    let dd = length(a + ab * h);
    let age = t - mix(pv.z, q.z, h);
    let w = .10 + .22 * age;
    acc = max(acc, mix(pv.w, q.w, h) * exp(-age * .38) * ss(w, w * .2, dd));
    a = b;
  }
  return acc;
}
@fragment fn fsU(i: VM) -> @location(0) vec4f { return below(i.wp); }
@fragment fn fsM(i: VM) -> @location(0) vec4f {
  let t = g.cam.w; let wp = i.wp;
  let v = g.cam.xyz - wp; let d = length(v); let V = v / d;
  let wv = wave(wp.xz, t, d);
  // ripples: the world's animated slope texture at three scales, drifting with the wind
  let fl = ss(220., 30., d);
  let q = wp.xz + WIND * t * .5;
  let s = (textureSample(tW, sR, pu(q, 1.5)).ba * 1.2 + textureSample(tW, sR, pu(q.yx, .62) + .3).ba * 1.4 + textureSample(tW, sR, pu(q * .7, 3.4) + .6).ba * .8 + textureSample(tW, sR, pu(q.yx * 1.3, .29) + .1).ba * 1.1) * fl;
  let n = normalize(vec3f(-wv.y - s.x * 1.1, 1., -wv.z - s.y * 1.1));
  let nv = sat(dot(n, V));
  let F = .02 + .98 * pow(1. - nv, 5.);
  var R = reflect(-V, n); R.y = abs(R.y) + .01; R = normalize(R);
  let L = g.sun.xyz;
  let refl = skyCol(R, t, false);
  let sd = sat(dot(R, L));
  let glint = (pow(sd, 1400.) * 90. + pow(sd, 150.) * 1.2 + pow(sd, 18.) * .06) * ss(0., .2, R.y);
  // foam: caps on the crests, bubbles round the hull, the wake
  let nz = textureSample(tD, sR, pu(q, 1.6)).b * .55 + textureSample(tD, sR, pu(q.yx, .45) + .3).a * .45;
  let steep = length(wv.yz);
  let cap = ss(.07, .24, wv.x + steep * .30 + (nz - .5) * .18);
  var foam = cap * ss(.38, .62, nz + cap * .25) * fl * .85;
  let aw = ss(.16, .03, su.a.w);
  if (aw > 0. || su.w[0].w > 0.) {
    foam = max(foam, wake(wp, t) * ss(.28, .58, nz + .24));
    let ta = wd(g.va.xyz - wp).xz; let nb = wd(g.vb.xyz - wp).xz;
    let ab = nb - ta; let h = clamp(-dot(ta, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
    let dh = length(ta + ab * h);
    let ring = ss(.20, .075, dh) * aw * ss(.25, .55, nz);
    let bow = ss(.55, .0, length(nb)) * aw * clamp(su.a.x * .7, 0., 1.) * ss(.2, .6, nz);
    foam = max(foam, max(ring * .9, bow));
  }
  foam = sat(foam);
  let lit = .5 + .5 * sat(dot(n, L));
  let foamC = (vec3f(.90, .94, .96) * lit + vec3f(.10, .14, .20)) * .95;
  var src = refl * F * (1. - foam) + foamC * foam + SUNC * glint * F * (1. - foam) * .8;
  var al = F * (1. - foam) + foam;
  // far away the sea becomes the haze of the horizon
  let hz = ss(300., 900., d);
  let hd = normalize(-V.xz);
  src = mix(src, skyBase(vec3f(hd.x * .999, .01, hd.y * .999)), hz);
  al = mix(al, 1., hz);
  return vec4f(min(src * SK, vec3f(60.)), al);
}
`;

// ---------------------------------------------------------------- GPU side
let surfOn = false;                 // the camera is near or above the water: the sky and the mesh are drawn
let surfBG = null, surfUBO = null, pSurfSky = null, pSurfWater = null, pSurfUnder = null, surfIB = null, surfNI = 0;
const surfU = new Float32Array(4 + SURF_TRAIL * 4);
const surfLast = [0, 0, 0], surfTrail = [];               // newest first: {x, z, t, s}
async function surfInit() {
  const m = mod(W_SURFA), VFr = SS.VERTEX | SS.FRAGMENT;
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFr, buffer: {} }, { binding: 1, visibility: VFr, buffer: {} }] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl] });
  const dummy = device.createBuffer({ size: 16, usage: BU.UNIFORM });
  surfUBO = device.createBuffer({ size: surfU.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
  surfBG = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: dummy } }, { binding: 1, resource: { buffer: surfUBO } }] });
  const OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  pSurfSky = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsSky' }, fragment: { module: m, entryPoint: 'fsSky', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
  pSurfWater = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsM' }, fragment: { module: m, entryPoint: 'fsM', targets: [{ format: HDR, blend: OVER }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
  pSurfUnder = device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: 'vsM' }, fragment: { module: m, entryPoint: 'fsU', targets: [{ format: HDR }] },
    primitive: { topology: 'triangle-list', cullMode: 'front' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
  const idx = new Uint32Array(SURF_NR * SURF_NS * 6); let k = 0;
  for (let i = 0; i < SURF_NR; i++) for (let j = 0; j < SURF_NS; j++) {
    const a = i * (SURF_NS + 1) + j, b = a + SURF_NS + 1;
    idx[k++] = a; idx[k++] = a + 1; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b + 1; idx[k++] = b;
  }
  surfNI = idx.length; surfIB = buf(idx, BU.INDEX);
}
// every frame, after the vehicle has moved: the track of foam it leaves and the uniforms
function surfUpdate() {
  const t = F[TIME], cy = F[CY];
  surfOn = cy > -1;
  const sub = lv.surfY - lv.pos[1], moving = abs(lv.v[0]) > 0.15 || abs(lv.rpm) > 150;
  if (surfTrail.length && hypot(wrapD(lv.pos[0] - surfLast[0]), wrapD(lv.pos[2] - surfLast[2])) > 3) surfTrail.length = 0;   // teleported
  surfLast[0] = lv.pos[0]; surfLast[2] = lv.pos[2];
  if (sub < 0.35 && moving) {
    lv.toWorld(0.1, 0, 0, lauvTmp);
    const l = surfTrail[0];
    if (l && hypot(wrapD(lauvTmp[0] - l.x), wrapD(lauvTmp[2] - l.z)) > 5) surfTrail.length = 0;
    if (!surfTrail.length || hypot(wrapD(lauvTmp[0] - surfTrail[0].x), wrapD(lauvTmp[2] - surfTrail[0].z)) > 0.18) {
      surfTrail.unshift({ x: lauvTmp[0], z: lauvTmp[2], t, s: clamp(0.3 + 0.5 * abs(lv.v[0]) / 1.5 + abs(lv.rpm) / 3500, 0, 1.2) });
      if (surfTrail.length > SURF_TRAIL) surfTrail.pop();
    }
  }
  if (surfTrail.length && t < surfTrail[0].t - 1) surfTrail.length = 0;   // time was reset
  if (!surfOn) return;
  surfWaveAt(F[CX], F[CZ], t, surfS);
  surfU[0] = abs(lv.v[0]); surfU[1] = abs(lv.rpm) / 2100; surfU[2] = surfS.h; surfU[3] = abs(lv.pos[1] - lv.surfY);
  for (let i = 0; i < SURF_TRAIL; i++) {
    const p = surfTrail[i], o = 4 + i * 4;
    if (p) { surfU[o] = p.x; surfU[o + 1] = p.z; surfU[o + 2] = p.t; surfU[o + 3] = p.s; } else { surfU[o] = surfU[o + 1] = surfU[o + 2] = 0; surfU[o + 3] = 0; }
  }
  Q.writeBuffer(surfUBO, 0, surfU);
}
// the sky first (it sits at the far plane), the water mesh after the scene
function surfDrawSky(r) { if (!surfOn) return false; r.setBindGroup(1, surfBG); r.setPipeline(pSurfSky); r.draw(4); return true; }
function surfDrawWater(r) { r.setBindGroup(1, surfBG); r.setIndexBuffer(surfIB, 'uint32'); r.setPipeline(pSurfUnder); r.drawIndexed(surfNI); r.setPipeline(pSurfWater); r.drawIndexed(surfNI); }
