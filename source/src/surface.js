// ============================================================================
// THE SURFACE: the sea seen from above (sky, sun, clouds, waves, reflection, foam, wake), the same waves for the hull,
// and the waterline when the camera dips through.
// ============================================================================
// Waves: a sum of sines whose wave vectors are whole numbers of 2*PI/PER, so the sea repeats with the world (a torus).
// surfWaveAt() here and wave() in the shader are the same function: the water, the hull and the camera agree.
// Sea state: a Pierson-Moskowitz spectrum for a fetch-limited wind sea (lauv-ocean-3d uses JONSWAP with U10 6-8 m/s), as 20 waves
// from 57 m swell to 1.5 m chop, directions spread round the wind, wave vectors whole numbers of 2*PI/PER.
const SURF_U10 = 7, SURF_SEA = 0.9, SURF_CHOP = 0.8, SURF_WIND = 0.35, SURF_NW = 20;
const SURF_W = (() => {
  const g = 9.81, kp = 0.769 * g / (SURF_U10 * SURF_U10), kmin = 0.07, r = Math.pow(4.2 / kmin, 1 / (SURF_NW - 1)), out = [];
  for (let i = 0; i < SURF_NW; i++) {
    const k0 = kmin * Math.pow(r, i), dk = k0 * (Math.sqrt(r) - 1 / Math.sqrt(r));
    const S = 0.00405 * Math.pow(k0, -3) * Math.exp(-1.25 * (kp / k0) * (kp / k0));
    const fr = (i * 0.618034) % 1, th = SURF_WIND + (fr - 0.5) * 2 * (0.12 + 1.1 * i / SURF_NW);
    let nx = Math.round(k0 * Math.cos(th) * PER / TAU), nz = Math.round(k0 * Math.sin(th) * PER / TAU);
    if (!nx && !nz) nx = 1;
    const kx = TAU * nx / PER, kz = TAU * nz / PER, k = Math.hypot(kx, kz);
    out.push({ kx, kz, a: SURF_SEA * Math.sqrt(2 * S * dk) * (1 + 1.6 * Math.exp(-k0 / 0.18)), w: 0.85 * Math.sqrt(g * k), ph: ((i * 2.399963) % 1) * TAU });
  }
  return out;
})();
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
@group(1) @binding(2) var tFl: texture_2d<f32>;   // height of the sea floor (r: (h + 40) / 40), from the world's ground map
const NW = ${SURF_NW};
const WV = array<vec4f, ${SURF_NW}>(${SURF_W.map((w) => `vec4f(${w.kx}, ${w.kz}, ${w.a}, ${w.w})`).join(', ')});
const WPH = array<f32, ${SURF_NW}>(${SURF_W.map((w) => w.ph).join(', ')});
const SK = 2.5;   // the sky is written in display units; the exposure above the water is 0.6 * 0.62
const WIND = vec2f(.8, .35);
const SKYSUN = vec3f(.647, .5, -.575);   // the sun as the sky shows it: 30 degrees up (the underwater light keeps the world's own)
// the sea at p: .x height, .yz slope, .w the Jacobian of the choppy displacement (below ~.7 the crests break into foam); the short waves fade with distance
fn wave(p: vec2f, t: f32, d: f32) -> vec4f {
  var r = vec4f(0., 0., 0., 1.);
  let q = vec2f(wr(p.x), wr(p.y));
  for (var i = 0; i < NW; i++) {
    let w = WV[i];
    let k = length(w.xy);
    let f = 1. - ss(TAU / k * 7., TAU / k * 18., d);
    let ph = dot(w.xy, q) - w.w * t + WPH[i];
    let s = sin(ph); let c = cos(ph);
    r += vec4f(s, c * w.x, c * w.y, -${SURF_CHOP} * k * s) * (w.z * f);
  }
  r.w += 1.;
  return r;
}
// horizontal displacement of the surface point whose rest position is p (choppy waves: crests sharpen)
fn waveDisp(p: vec2f, t: f32, d: f32) -> vec2f {
  var r = vec2f(0.);
  let q = vec2f(wr(p.x), wr(p.y));
  for (var i = 0; i < NW; i++) {
    let w = WV[i];
    let k = length(w.xy);
    let f = 1. - ss(TAU / k * 7., TAU / k * 18., d);
    r += w.xy / k * (cos(dot(w.xy, q) - w.w * t + WPH[i]) * w.z * f * ${SURF_CHOP});
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
  let sd = sat(dot(rd, SKYSUN));
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
  if (full) { let n2 = fbm(uv + SKYSUN.xz * .6, 4); lit = sat(.62 - (n2 - n1) * 4.5); }
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
  let dsp = waveDisp(p, g.cam.w, r);
  o.wp = vec3f(p.x + dsp.x, wave(p, g.cam.w, r).x, p.y + dsp.y);
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
    let w = .12 + .16 * age;
    acc = max(acc, mix(pv.w, q.w, h) * exp(-age * .45) * ss(w, w * .3, dd));
    a = b;
  }
  return acc;
}
@fragment fn fsU(i: VM) -> @location(0) vec4f {
  let c = below(i.wp);
  // the meniscus: close to the lens the water film is bright and its edge wavers, so the cut is not a straight seam
  let d = length(i.wp - g.cam.xyz);
  let nz = textureSample(tD, sR, pu(i.wp.xz * 2.3, 1.1)).b + textureSample(tD, sR, pu(i.wp.zx * 5., .7)).a * .5;
  let rim = ss(.9 + .6 * (nz - .7), .1, d);
  return vec4f(mix(c.rgb, vec3f(.55, .95, 1.1) * 1.4 + vec3f(.4, .4, .4) * ss(.35, .1, d), rim * .8), 1.);
}
@fragment fn fsM(i: VM) -> @location(0) vec4f {
  let t = g.cam.w; let wp = i.wp;
  let v = g.cam.xyz - wp; let d = length(v); let V = v / d;
  let wv = wave(wp.xz, t, d);
  // ripples on top of the swell: the world's animated slope texture at four scales, drifting with the wind, each gone before it can alias
  let fl = ss(130., 20., d);
  let q = wp.xz + WIND * t * .5;
  // patches of rougher and calmer water (gusts), and every ripple layer sampled at its own angle and scale so nothing visibly repeats
  let pm = .45 + 1.1 * fbm(wp.xz / 38. + vec2f(t * .01, 4.), 3);
  let qa = vec2f(q.x * .8 - q.y * .6, q.x * .6 + q.y * .8); let qb = vec2f(q.x * .5 + q.y * .87, q.x * .87 - q.y * .5) * (1. + .13 * sin(wp.x * .021 + wp.z * .017));
  // each layer's ripples are about 1/11 of its tile: they fade out when one pixel covers more than half a ripple (the footprint, so no stripes towards the horizon)
  let fw = max(length(dpdx(wp.xz)), length(dpdy(wp.xz)));
  let s = (textureSample(tW, sR, pu(qa, 1.5)).ba * 1.0 * (1. - ss(1.5 / 50., 1.5 / 14., fw)) + textureSample(tW, sR, pu(qb, .62) + .3).ba * 1.1 * (1. - ss(.62 / 50., .62 / 14., fw)) + textureSample(tW, sR, pu(qa * .7, 3.4) + .6).ba * .7 * (1. - ss(3.4 / 50., 3.4 / 14., fw)) + textureSample(tW, sR, pu(qb * 1.3, .29) + .1).ba * .9 * (1. - ss(.29 / 50., .29 / 14., fw))) * pm;
  let n = normalize(vec3f(-wv.y - s.x * .9, 1., -wv.z - s.y * .9));
  let mic = (textureSample(tW, sR, pu(qb * 2.1, .17) + .4).ba + textureSample(tW, sR, pu(qa * 1.7, .23) + .8).ba) * (1. - ss(.2 / 50., .2 / 14., fw)) * pm;
  // Schlick Fresnel (F0 = .02) on the swell normal with a third of the ripple tilt, so the middle and far sea go to sky and the near sea stays clear
  let nm = normalize(vec3f(-wv.y, 1., -wv.z));
  let nv = sat(dot(normalize(nm + (n - nm) * .35), V));
  let F = .02 + .98 * pow(1. - nv, 5.);
  var R = reflect(-V, n); R.y = abs(R.y) + .01; R = normalize(R);
  let L = SKYSUN;
  let refl = skyCol(R, t, false);
  let sd = sat(dot(R, L));
  let Rm = normalize(reflect(-V, normalize(n + vec3f(-mic.x * 2.2, 0., -mic.y * 2.2))));
  let sdm = sat(dot(Rm, L));
  var glint = pow(sdm, 4000.) * 160. + pow(sd, 400.) * 3. + pow(sd, 40.) * .08;   // sharp view-dependent sparkles on micro-ripples
  glint = glint / (1. + glint * .08) * ss(0., .15, R.y);   // soft clip: bright, never a white blob
  // foam: breaking crests where the choppy surface folds over itself, bubbles round the hull, bow wave and wake
  let nz = textureSample(tD, sR, pu(q, 1.6)).b * .55 + textureSample(tD, sR, pu(q.yx, .45) + .3).a * .45;
  let wdir = normalize(WIND); let sq = vec2f(dot(q, wdir) * .22, dot(q, vec2f(-wdir.y, wdir.x)));
  let streak = textureSample(tD, sR, pu(sq * 2., .5) * 1.).a * .6 + textureSample(tD, sR, pu(sq * 5., .3) + .3).b * .4;   // foam streaks stretched along the wind
  let fold = ss(.90, .55, wv.w + (nz - .5) * .25 - (pm - .8) * .12);
  var foam = fold * ss(.30, .55, nz + fold * .3) * ss(500., 80., d) * .95;
  foam += ss(.14, .30, wv.x + (nz - .5) * .1 + (pm - .8) * .06) * ss(.45, .7, streak) * ss(500., 60., d) * .5;   // thin streaks on the highest crests
  let aw = ss(.16, .03, su.a.w);
  if (aw > 0. || su.w[0].w > 0.) {
    let wk = wake(wp, t);
    let fz = textureSample(tD, sR, pu(q * 1.1, .33)).a * .5 + textureSample(tD, sR, pu(q.yx, .8) + .2).b * .5;
    foam = max(foam, ss(.50 - .16 * wk, .70 - .08 * wk, fz) * sat(wk * 2.) * .9);
    let ta = wd(g.va.xyz - wp).xz; let nb = wd(g.vb.xyz - wp).xz;
    let ab = nb - ta; let h = clamp(-dot(ta, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
    let dh = length(ta + ab * h);
    // waterline: a tight bright meniscus on the hull, a looser skirt of bubbles around it
    let ring = (ss(.115, .08, dh) * ss(.07, .085, dh) * .95 + ss(.2, .09, dh) * .2 * ss(.3, .6, nz)) * aw;
    // bow wave: a V of foam lines opening behind the nose, stronger with speed
    let hdir = normalize(ab); let rel = -nb; let back = -dot(rel, hdir); let side = abs(dot(rel, vec2f(-hdir.y, hdir.x)));
    let vl = ss(.08 + .1 * back, 0., abs(side - (.12 + .3 * max(back, 0.)))) * ss(-.05, .1, back) * ss(9., 0., back);
    let bowK = aw * clamp(su.a.x * .8, 0., 1.);
    let bow = (vl * ss(.2, .5, nz) * .95 + ss(.6, .0, length(nb)) * .85 * ss(.15, .4, nz)) * bowK;
    foam = max(foam, max(ring, bow));
  }
  foam = sat(foam);
  let lit = .45 + .55 * sat(dot(n, L));
  let foamC = (vec3f(.92, .95, .97) * lit + vec3f(.08, .12, .18)) * .9;
  // what the water itself does to the view down into it: it absorbs red first and scatters blue-green, more the longer the path (about 8 m of water, seen along V)
  // transmittance T = exp(-sigma * depth / cos(refracted ray)) with the real depth below this pixel (the world's ground map), and less seabed the farther it is from the lens
  let fh = textureSampleLevel(tFl, sR, (wp.xz - vec2f(${OX}., ${OZ}.)) / PER, 0.).r * 40. - 40.;
  let cr = sqrt(max(1. - (1. - nv * nv) / 1.77, .3));
  let T = exp(-.15 * max(-fh, .3) / cr - .03 * d);
  let body = (1. - T) * (1. - F);
  let deep = .75 + .6 * fbm(wp.xz / 90. + 7., 2);   // patches of deeper, bluer water
  let bodyC = vec3f(.02, .15, .28) * deep * (.55 + .45 * sat(dot(n, L)));
  var src = refl * F * (1. - foam) + foamC * foam + SUNC * glint * F * (1. - foam) * .5 + bodyC * body * (1. - foam);
  var al = F * (1. - foam) + foam + body * (1. - foam);
  // far away the sea becomes the haze of the horizon
  let hz = ss(150., 800., d);
  let hd = normalize(-V.xz);
  src = mix(src, skyBase(vec3f(hd.x * .999, .01, hd.y * .999)) * .92, hz);
  al = mix(al, 1., hz);
  return vec4f(min(src * SK, vec3f(40.)), min(al, 1.));
}
`;

// ---------------------------------------------------------------- GPU side
const SURF_SKIP = { sky: false, water: false };
let surfFloorTex = null;
// the world's ground map (floor height per cell) as a texture, once the world is built
function surfFloor(map) {
  const b = new Uint8Array(NX * NZ);
  for (let i = 0; i < b.length; i++) b[i] = clamp((map[i * 4 + 1] + 40) / 40, 0, 1) * 255 + 0.5;
  Q.writeTexture({ texture: surfFloorTex }, b, { bytesPerRow: NX }, [NX, NZ]);
}
let surfOn = false;                 // the camera is near or above the water: the sky and the mesh are drawn
let surfBG = null, surfUBO = null, pSurfSky = null, pSurfWater = null, pSurfUnder = null, surfIB = null, surfNI = 0;
const surfU = new Float32Array(4 + SURF_TRAIL * 4);
const surfLast = [0, 0, 0], surfTrail = [];               // newest first: {x, z, t, s}
async function surfInit() {
  const m = mod(W_SURFA), VFr = SS.VERTEX | SS.FRAGMENT;
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFr, buffer: {} }, { binding: 1, visibility: VFr, buffer: {} }, { binding: 2, visibility: VFr, texture: {} }] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl] });
  surfFloorTex = device.createTexture({ size: [NX, NZ], format: 'r8unorm', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  const dummy = device.createBuffer({ size: 16, usage: BU.UNIFORM });
  surfUBO = device.createBuffer({ size: surfU.byteLength, usage: BU.UNIFORM | BU.COPY_DST });
  surfBG = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: dummy } }, { binding: 1, resource: { buffer: surfUBO } }, { binding: 2, resource: surfFloorTex.createView() }] });
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
      surfTrail.unshift({ x: lauvTmp[0], z: lauvTmp[2], t, s: clamp(0.4 + 0.45 * abs(lv.v[0]) / 1.5 + abs(lv.rpm) / 4000, 0, 1.2) });
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
function surfDrawSky(r) { if (!surfOn || SURF_SKIP.sky) return false; r.setBindGroup(1, surfBG); r.setPipeline(pSurfSky); r.draw(4); return true; }
function surfDrawWater(r) { if (SURF_SKIP.water) return; r.setBindGroup(1, surfBG); r.setIndexBuffer(surfIB, 'uint32'); r.setPipeline(pSurfUnder); r.drawIndexed(surfNI); r.setPipeline(pSurfWater); r.drawIndexed(surfNI); }
