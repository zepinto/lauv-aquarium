// ============================================================================
// rays: southern stingrays resting on the sand (they lift off in a puff of sediment when the LAUV comes close and glide away,
// then settle somewhere else), spotted eagle rays and mantas in open water (they veer off when the LAUV approaches)
// ============================================================================
// Half span 1 in the mesh, x along the span, y up, z towards the nose. The vertex shader flaps / undulates the wings (wave from the
// body to the tips, trailing edge lag) and whips the tail; the instance carries position, heading, up (bank), flap phase and amplitude.
FAUNA.push((() => {
  const NS = 7, NE = 5, NM = 2, N = NS + NE + NM, rng = bfRng(88121), rf = (a, b) => a + (b - a) * rng();
  const REST = 0, STARTLE = 1, LIFT = 2, GLIDE = 3, LAND = 4, CRUISE = 5;
  const W_RAY = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f, @location(5) d: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32, @location(5) on: vec3f, @location(6) @interpolate(flat) ty: f32, @location(7) au: f32 };
// wing displacement (in half spans) at span fraction au, along z; type 0 stingray (an undulation along the chord), 1 eagle ray, 2 manta (flaps, tips lag)
fn wv(ty: f32, au: f32, z: f32, ph: f32, amp: f32) -> f32 {
  if (ty < .5) { return amp * .46 * ss(.06, .9, au) * sin(ph + z * 3.6 - au * 0.8); }
  if (ty < 1.5) { return amp * (.5 * pow(au, 1.5) * sin(ph - au * 1.1) - .05 * sin(ph)); }
  return amp * (.45 * pow(au, 1.5) * sin(ph - au * 1.0) - .1 * sin(ph));
}
@vertex fn vsRay(i: VI) -> VO {
  var o: VO;
  let ph = i.b.w; let amp = i.c.w; let ty = i.d.x; let u = i.n.w; let au = abs(u);
  var l = i.p;
  let dy = wv(ty, au, l.z, ph, amp);
  let a0 = max(au - .012, 0.); let a1 = au + .012;
  let slx = (wv(ty, a1, l.z, ph, amp) - wv(ty, a0, l.z, ph, amp)) / (a1 - a0) * sign(u);
  let slz = (wv(ty, au, l.z + .02, ph, amp) - dy) / .02;
  l.y += dy;
  // the tail trails behind and whips from side to side
  let t0 = select(select(-.45, -.78, ty < .5), -.48, ty > 1.5);
  let tail = ss(t0, t0 - 1.6, l.z) * step(au, .001);
  l.x += tail * sin(ph * .55 + l.z * 2.1) * (.08 + .12 * amp) * select(1., 2.4, ty > .5 && ty < 1.5);
  l.y += tail * dy * .0;
  let n = normalize(vec3f(i.n.x - slx * i.n.y, i.n.y + slx * i.n.x + slz * i.n.z, i.n.z - slz * i.n.y));
  let T = i.b.xyz; let Up = i.c.xyz; let S = cross(T, Up);
  let P = g.cam.xyz + wd(i.a.xyz - g.cam.xyz);
  let w = P + (S * l.x + Up * l.y + T * l.z) * i.a.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * n.x + Up * n.y + T * n.z; o.op = i.p; o.sd = i.d.z; o.on = i.n.xyz; o.ty = ty; o.au = u;
  o.lt = shadow1(w);
  return o;
}
fn hh3(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn spots(p: vec2f, sc: f32, rad: f32, seed: f32) -> f32 {
  let q = p * sc; let c = floor(q); let f = fract(q) - .5; let h = hh3(vec3f(c, seed));
  let r = rad * (.55 + .8 * h.z);
  return (1. - ss(r * .6, r, length(f - (h.xy - .5) * .45))) * step(.18, h.x * .5 + h.y * .5 + .15);
}
@fragment fn fsRay(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus(i.wp, dist);
  let tx = textureSample(tD, sR, i.op.xz * .9 + i.sd);
  let nn = normalize(i.n);
  let tx2 = textureSample(tD, sR, i.op.xz * 3.1 + i.sd * 1.7);
  let n = normalize(nn + (vec3f(tx.r + tx2.r - 1., 0., tx.g + tx2.g - 1.)) * .55);
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let top = ss(-.12, .22, normalize(i.on).y);
  let au = abs(i.op.x); let zz = i.op.z; let ty = i.ty;
  var back = vec3f(0.); var belly = vec3f(0.); var gl = .5;
  if (ty < .5) {
    // southern stingray: sand-coloured, mottled, pale speckles; white underneath with a darker rim; eyes and spiracles
    let mot = tx.b * .6 + tx.a * .4;
    back = mix(vec3f(.085, .07, .048), vec3f(.03, .025, .018), ss(.3, .7, mot)) * (.8 + .4 * tx.a);
    back += vec3f(.22, .19, .14) * ss(.78, .9, tx.a);
    back = mix(back, vec3f(.012), spots(i.op.xz, 9., .3, 5.) * .9 * ss(.1, .5, au));
    back = mix(back, vec3f(.3, .26, .19), spots(i.op.xz + 3., 8., .2, 8.) * .8);
    back = mix(back, back * 1.35, ss(.6, 1., au) * .6);
    let eye = ss(.05, .025, length(vec2f(abs(i.op.x) - .14, zz - .5)));
    let spir = ss(.07, .03, length(vec2f(abs(i.op.x) - .24, zz - .33))) * .85;
    back = mix(back, vec3f(.02), max(eye, spir));
    belly = mix(vec3f(.46, .44, .39), vec3f(.22, .19, .15), ss(.7, 1., au) * .8) * (.9 + .2 * tx.b);
    gl = .25;
  } else if (ty < 1.5) {
    // spotted eagle ray: blue-black back with a white dotted pattern, white belly
    let sp = spots(i.op.xz * vec2f(1., 1.), 5.2, .3, 3.) * ss(1., .15, au) * ss(-.4, .1, zz);
    back = mix(vec3f(.006, .008, .016), vec3f(.02, .026, .045), ss(.5, .9, tx.a)) + vec3f(.9, .92, .88) * sp;
    back = mix(back, vec3f(.07, .08, .1), ss(.34, .5, zz) * .5);
    let eye = ss(.035, .014, length(vec2f(abs(i.op.x) - .17, zz - .22)));
    back = mix(back, vec3f(.005), eye);
    belly = mix(vec3f(.62, .64, .65), vec3f(.07, .08, .1), ss(.8, 1., au) * .8);
    gl = .6;
  } else {
    // manta: black back with white shoulder patches, white belly with dark spots, gill slits and a dark mouth
    back = vec3f(.014, .018, .026) + vec3f(.05, .06, .075) * ss(.55, .85, tx.a);
    let sh = ss(.075, .0, abs(au - .27 - (zz - .12) * .9)) * ss(.34, .26, zz) * ss(-.03, .05, zz) * ss(.7, .45, au);
    back = mix(back, vec3f(.55, .58, .6), sh * .9);
    back = mix(back, vec3f(.3, .33, .36), ss(.93, 1., au) * .6);
    let gill = ss(.25, .0, abs(au - .14) * 8.) * ss(.04, .12, zz) * ss(.34, .26, zz) * ss(.2, .8, sin(zz * 110.));
    let spots2 = spots(i.op.xz, 9., .22, 11.) * ss(.5, .12, au) * ss(-.3, .05, zz) * ss(.34, .12, zz);
    belly = mix(vec3f(.66, .68, .7), vec3f(.1, .12, .15), ss(.88, 1., au) * .75);
    belly = mix(belly, vec3f(.04, .05, .06), max(spots2 * .8, gill * .7));
    belly = mix(belly, vec3f(.015), ss(.36, .42, zz) * ss(.2, .1, au) * .9);
    gl = .6;
  }
  let alb = mix(belly, back, top);
  let E = sunE(i.wp.y, z) * i.lt * shadow4(i.wp + n * .3);
  let ndv = sat(dot(n, V));
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = alb * (E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * gl * (.3 + ca) * .7;
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += alb * sky * ca * .45 * (1. - top) + sky * pow(1. - ndv, 2.5) * 1.0 * (.4 + .6 * sat(n.y * .6 + .5));
  return fin(fog(c, i.wp, z));
}
`;
const W_PUFF = S_B + /*wgsl*/`
struct PO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) @interpolate(flat) fl: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> PO {
  var o: PO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let p = g.cam.xyz + wd(a.xyz - g.cam.xyz);
  let sz = a.w * (.6 + b.x * 1.5);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p; o.fl = b;
  return o;
}
@fragment fn fs(i: PO) -> @location(0) vec4f {
  let sd = i.fl.z;
  // billowy: a ragged edge from two noise octaves, lit on the side facing up / the sun, dense in the core
  let a = atan2(i.uv.y, i.uv.x);
  let rag = .75 + .22 * sin(a * 3. + sd * 11.) + .12 * sin(a * 7. - sd * 5. + i.fl.x * 3.) + .06 * sin(a * 13. + sd * 3.);
  let r = length(i.uv) / rag;
  let core = .6 + .4 * sin(i.uv.x * 5.3 + sd * 31.) * sin(i.uv.y * 4.7 - sd * 17.);
  let al = (1. - ss(.35, 1., r)) * (.45 + .55 * core) * i.fl.y * pow(1. - i.fl.x, 1.2) * ss(0., .08, i.fl.x);
  let z = zone(i.wp); let v = i.wp - g.cam.xyz; let d = length(v);
  let E = sunE(i.wp.y, z) * (.55 + .45 * shadow1(i.wp));
  let lit = .62 + .5 * ss(-.6, .8, i.uv.y) + .25 * ss(.6, 1., r) * ss(-.2, .8, i.uv.y);
  var c = vec3f(1.0, .94, .78) * (E * .75 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * 1.0) * lit * (1. - .25 * (1. - core) * (1. - r));
  let T = exp(-SIG.g * d) * ss(.15, .8, d);
  c = c * T + fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz) * (1. - T);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(12.)), al * mix(.5, 1., T));
}
`;
const W_PIT = S_B + /*wgsl*/`
struct PO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) @interpolate(flat) fl: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> PO {
  var o: PO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let p = g.cam.xyz + wd(a.xyz - g.cam.xyz);
  let f = vec3f(sin(b.x), 0., -cos(b.x)); let r = vec3f(cos(b.x), 0., sin(b.x));
  let w = p + (r * q.x * 1.05 + f * q.y * 1.0) * a.w + vec3f(0., .04, 0.);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.wp = p; o.fl = b;
  return o;
}
@fragment fn fs(i: PO) -> @location(0) vec4f {
  let r = length(i.uv * vec2f(1., .95)); let n = .85 + .15 * sin(i.uv.x * 7. + i.fl.z * 20.) * sin(i.uv.y * 6.);
  let rim = ss(.55, .9, r) * ss(1., .8, r);   // a low lip of thrown sand round the dip
  let dip = ss(1., .5, r);
  let z = zone(i.wp); let v = i.wp - g.cam.xyz; let d = length(v);
  let E = sunE(i.wp.y, z) * (.55 + .45 * shadow1(i.wp));
  let base = vec3f(.80, .74, .60) * (E * .55 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .85);
  var c = mix(base * 1.12, base * .5, dip) * n;
  let T = exp(-SIG.g * d);
  c = c * T + fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz) * (1. - T);
  let al = max(dip * .28, rim * .3) * i.fl.y * ss(1., .85, r);
  return vec4f(c * al, al);
}
`;
  // ---------------------------------------------------------------- meshes
  // planform of one species: nose edge zl(au) and tail edge zt(au) (au = |x|, wing tip at 1), thickness th(au)
  const PLAN = {
    sting: { zl: (a) => 0.02 + 0.93 * pow(max(1 - pow(a, 2.2), 0), 0.6), zt: (a) => 0.02 - 0.82 * pow(max(1 - pow(a, 2.1), 0), 0.6), th: (a) => 0.17 * pow(1 - a, 1.0) + 0.006 + 0.17 * exp(-pow(a / 0.3, 2)), tail: 2.0, tr: 0.08 },
    eagle: { zl: (a) => -0.1 + 0.62 * pow(max(1 - pow(a, 1.35), 0), 0.8) + 0.12 * exp(-pow(a / 0.09, 2)), zt: (a) => -0.1 - 0.34 * pow(max(1 - pow(a, 1.5), 0), 0.6), th: (a) => 0.12 * pow(1 - a, 1.1) + 0.005 + 0.2 * exp(-pow(a / 0.24, 2)), tail: 5.5, tr: 0.032 },
    manta: { zl: (a) => 0.52 - 0.74 * pow(a, 1.35) + 0.07 * exp(-pow((a - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(a / 0.05, 2)) - 0.08 * pow(a, 5), zt: (a) => -0.5 + 0.3 * pow(a, 0.8) + 0.02 - 0.08 * pow(a, 5), th: (a) => 0.11 * pow(1 - a, 1.15) + 0.005 + 0.16 * exp(-pow(a / 0.24, 2)), tail: 1.0, tr: 0.02 },
  };
  function disc(P) {
    const m = new Mesh(), NU = 72, M = 22, rings = [];
    for (let j = 0; j <= NU; j++) {
      const u = j / NU * 2 - 1, au = abs(u), zt = P.zt(au); let zl = P.zl(au); if (zl < zt + 0.006) zl = zt + 0.006;
      const th = P.th(au), ring = [];
      for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)) * (sin(a) > 0 ? 1 : 0.5), zt + (zl - zt) * (0.5 + 0.5 * cos(a)), u)); }
      rings.push(ring);
    }
    for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
    return m;
  }
  function tail(P, len, tr, y0) {
    const m = new Mesh(), z0 = P.zt(0) + 0.1, pts = [];
    for (let i = 0; i <= 12; i++) { const q = i / 12; pts.push([0, y0 - 0.02 * q * q * len * 0.2, z0 - q * len]); }
    m.tube(pts, (k) => tr * pow(1 - k / 13, 1.3) + 0.0025, 6, true, () => 0);
    return m;
  }
  function species(kind) {
    const P = PLAN[kind], parts = [disc(P), tail(P, P.tail, P.tr, 0)];
    if (kind === 'sting') {   // the spine: a short dark thorn on the tail
      const m = new Mesh(); m.tube([[0, 0.05, -1.0], [0, 0.08, -1.4], [0, 0.07, -1.9]], (k) => 0.03 * (1 - k / 3.2), 4, true, () => 0); parts.push(m);
    }
    if (kind === 'manta') for (const sx of [-1, 1]) {   // cephalic fins
      const m = new Mesh();
      m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true, () => sx * 0.1);
      parts.push(m);
    }
    return bfMerge(parts.map((p) => bfBuild(p)));
  }
  // ---------------------------------------------------------------- state
  const R = [];
  for (let i = 0; i < N; i++) {
    const type = i < NS ? 0 : i < NS + NE ? 1 : 2;
    R.push({ i, type, p: new Float64Array(3), v: new Float64Array(3), yaw: rng() * TAU, pitch: 0, roll: 0, yawRate: 0, phase: rng() * 6, amp: 0.15, freq: 0.6, ampT: 0.15,
      scale: type === 0 ? rf(0.5, 0.75) : type === 1 ? rf(0.75, 1.05) : rf(2.0, 2.4), state: type === 0 ? REST : CRUISE, t: 0, site: -1, cool: 0, react: 0, glideT: 0, veer: 0, hd: 0, wanderT: 0,
      leader: null, off: [0, 0], pause: 3 + rng() * 6, gy: -20, gyT: 0, puffT: 0, speed: type === 1 ? 1.7 : 1.3 });
  }
  let sites = [], placed = false, off = false, ibuf, vbs = [], pipe, inst;
  const wrapA = (a) => a - TAU * floor((a + PI) / TAU);
  // ---------------------------------------------------------------- the seabed: flat, sandy, open spots (once the world exists)
  function findSites() {
    const cand = [];
    for (let iz = 3; iz < NZ; iz += 5) for (let ix = 3; ix < NX; ix += 5) {
      const o = (ix + NX * iz) * 4, sand = MAP[o], fl = MAP[o + 1];
      if (sand > 0.8 && fl > -22 && fl < -3) cand.push(OX + (ix + 0.5) * VS, OZ + (iz + 0.5) * VS, fl);
    }
    const n = cand.length / 3, order = Array.from({ length: n }, (_, k) => k); for (let k = n - 1; k > 0; k--) { const j = floor(rng() * (k + 1)); const q = order[k]; order[k] = order[j]; order[j] = q; }
    for (const k of order) {
      if (sites.length >= 90) break;
      const x = cand[k * 3], z = cand[k * 3 + 1], fl = cand[k * 3 + 2];
      let ok = true; for (const s of sites) if (hypot(wrapD(s.x - x), wrapD(s.z - z)) < 9) { ok = false; break; }
      if (!ok) continue;
      const y0 = bfGround(x, z, fl + 3); if (y0 > fl + 2.9) continue;
      let lo = y0, hi = y0; for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) { const y = bfGround(x + dx, z + dz, y0 + 1.5); lo = min(lo, y); hi = max(hi, y); }
      if (hi - lo > 0.3 || sdAt(x, y0 + 1.6, z) > -0.3 || sdAt(x, y0 + 3, z) > -0.3) continue;
      sites.push({ x, y: hi, z, used: -1 });
    }
  }
  const nearestSite = (x, z, minD, exclude) => { let b = -1, bd = 1e9; for (let k = 0; k < sites.length; k++) { const s = sites[k]; if (s.used >= 0 && s.used !== exclude) continue; const d = hypot(wrapD(s.x - x), wrapD(s.z - z)); if (d < bd && d >= minD) { bd = d; b = k; } } return b; };
  function settle(r, k, yaw, cool = 0) { const s = sites[k]; if (r.site >= 0) sites[r.site].used = -1; r.site = k; s.used = r.i; r.p[0] = s.x; r.p[2] = s.z; r.p[1] = s.y - 0.005 * r.scale + 0.01; r.v.fill(0); r.yaw = yaw; r.pitch = 0; r.roll = 0; r.state = REST; r.amp = r.ampT = 0.3; r.freq = 0.6; r.cool = cool; }
  function place() {
    bfVehicle(); findSites(); placed = true;
    // stingrays: the first three on the sites nearest the vehicle (so some are always close), the rest spread out
    for (const r of R) {
      if (r.type === 0) { const k = r.i < 3 ? nearestSite(bfV.x, bfV.z, 6 + r.i * 14, -1) : floor(rng() * sites.length); if (k >= 0) { if (sites[k].used >= 0) continue; settle(r, k, rng() * TAU); } }
      else {   // open water: 20-90 m from the vehicle, away from rock
        for (let tries = 0; tries < 30; tries++) {
          const a = rng() * TAU, d = r.type === 1 ? rf(22, 60) : rf(35, 85), x = wrapT(bfV.x + cos(a) * d), z = wrapT(bfV.z + sin(a) * d), gy = bfGround(x, z, -2), y = max(gy + rf(3, 5), r.type === 2 ? -9 : -7.5);
          if (y > -2.5 || sdAt(x, y, z) > -0.9 || sdAt(x + 4, y, z) > -0.9 || sdAt(x - 4, y, z) > -0.9) continue;
          r.p[0] = x; r.p[1] = y; r.p[2] = z; r.yaw = r.hd = rng() * TAU; break;
        }
        if (r.type === 1 && r.i > NS) { r.leader = R[NS + (r.i - NS - 1) % 1 * 0 + (r.i - NS < 3 ? 0 : 3)]; }
      }
    }
    for (const r of R) if (r.type === 0 && r.site >= 0) pitSet(r);
    // eagle rays: a group of three (leader + two) and two singles
    const lead = R[NS], g1 = R[NS + 1], g2 = R[NS + 2];
    for (const [f, o] of [[g1, [-2.6, 2.2]], [g2, [-3.2, -2.4]]]) { f.leader = lead; f.off = o; f.p[0] = wrapT(lead.p[0] + o[1]); f.p[1] = lead.p[1] + 0.3; f.p[2] = wrapT(lead.p[2] - o[0] * 0 + 3); f.yaw = lead.yaw; }
    R[NS + 3].leader = null; R[NS + 4].leader = null;
  }
  // ---------------------------------------------------------------- sand puffs: soft billboards that rise, slow down and fade
  const NP = 256, pp = new Float32Array(NP * 8), pv = new Float32Array(NP * 3), pl = new Float32Array(NP), pi = new Float32Array(NP * 8);   // pp: x y z size | age alpha seed 0
  let np = 0, pbuf, ppipe;
  function puff(x, y, z, r, n, up, size) {
    for (let k = 0; k < n && np < NP; k++) {
      const a = rng() * TAU, d = r * rf(0.15, 1), s = rf(0.2, 0.65), o = np * 8; np++;
      pp[o] = x + cos(a) * d; pp[o + 1] = y + rf(0, 0.12); pp[o + 2] = z + sin(a) * d; pp[o + 3] = size * rf(0.7, 1.3); pp[o + 4] = 0; pp[o + 5] = rf(0.35, 0.7); pp[o + 6] = rng() * 10; pp[o + 7] = 0;
      pv[(np - 1) * 3] = cos(a) * s; pv[(np - 1) * 3 + 1] = up * rf(0.3, 1); pv[(np - 1) * 3 + 2] = sin(a) * s; pl[np - 1] = rf(5, 9);
    }
  }
  // sand streaming from the wing tips, left behind along the path
  function puffTips(r, n) {
    const fx = sin(r.yaw), fz = -cos(r.yaw), rx = cos(r.yaw), rz = sin(r.yaw);
    for (const sd of [-1, 1]) for (let k = 0; k < n && np < NP; k++) {
      const o = np * 8; np++;
      pp[o] = r.p[0] + rx * sd * r.scale * rf(0.7, 1) - fx * rf(0, 0.3); pp[o + 1] = r.p[1] - 0.15 + rf(0, 0.2); pp[o + 2] = r.p[2] + rz * sd * r.scale * rf(0.7, 1) - fz * rf(0, 0.3);
      pp[o + 3] = 0.35 * (0.6 + r.scale) * rf(0.7, 1.3); pp[o + 4] = 0; pp[o + 5] = rf(0.35, 0.65); pp[o + 6] = rng() * 10; pp[o + 7] = 0;
      pv[(np - 1) * 3] = -fx * 0.3 + rx * sd * 0.25 + rf(-0.1, 0.1); pv[(np - 1) * 3 + 1] = rf(0.1, 0.35); pv[(np - 1) * 3 + 2] = -fz * 0.3 + rz * sd * 0.25 + rf(-0.1, 0.1); pl[np - 1] = rf(4, 7);
    }
  }
  function puffUpdate(dt) {
    for (let k = 0; k < np; k++) {
      const o = k * 8; pp[o + 4] += dt / pl[k];
      if (pp[o + 4] >= 1) { np--; if (k < np) { for (let j = 0; j < 8; j++) pp[o + j] = pp[np * 8 + j]; for (let j = 0; j < 3; j++) pv[k * 3 + j] = pv[np * 3 + j]; pl[k] = pl[np]; } k--; continue; }
      const damp = exp(-dt * 1.5); pv[k * 3] *= damp; pv[k * 3 + 1] = pv[k * 3 + 1] * damp - (pp[o + 4] > 0.35 ? 0.05 : -0.02) * dt; pv[k * 3 + 2] *= damp;
      pp[o] += pv[k * 3] * dt; pp[o + 1] += pv[k * 3 + 1] * dt; pp[o + 2] += pv[k * 3 + 2] * dt;
    }
    if (np) Q.writeBuffer(pbuf, 0, pp.buffer, 0, np * 32);
  }
  // ray-shaped dips in the sand: one under every resting stingray, and the one it leaves behind (fades over ~80 s)
  const NPIT = 24, pits = [], pitData = new Float32Array(NPIT * 8); let pitBuf, pitPipe;
  function pitSet(r) { for (let k = pits.length - 1; k >= 0; k--) if (pits[k].owner === r.i) pits.splice(k, 1); const s = sites[r.site]; pits.push({ x: s.x, y: s.y, z: s.z, yaw: r.yaw, sz: r.scale, a: 0.45, owner: r.i, seed: rng() * 9 }); }
  function pitLift(r) { for (const p of pits) if (p.owner === r.i) { p.owner = -1; p.a = 0.95; } }
  function pitUpdate(dt) {
    for (let k = pits.length - 1; k >= 0; k--) { const p = pits[k]; if (p.owner < 0) { p.a -= dt / 80; if (p.a <= 0) pits.splice(k, 1); } }
    while (pits.length > NPIT) pits.shift();
    for (let k = 0; k < pits.length; k++) { const p = pits[k], o = k * 8; pitData[o] = p.x; pitData[o + 1] = p.y; pitData[o + 2] = p.z; pitData[o + 3] = p.sz * 1.15; pitData[o + 4] = p.yaw; pitData[o + 5] = p.a; pitData[o + 6] = p.seed; }
    if (pits.length) Q.writeBuffer(pitBuf, 0, pitData.buffer, 0, pits.length * 32);
  }
  // ---------------------------------------------------------------- behaviour
  const away = new Float64Array(3);
  function stepRay(r, dt, t) {
    const dxv = wrapD(bfV.x - r.p[0]), dzv = wrapD(bfV.z - r.p[2]), dyv = bfV.y - r.p[1], d3 = hypot(dxv, dyv, dzv), d2 = hypot(dxv, dzv) || 1;
    away[0] = -dxv / d2; away[2] = -dzv / d2;
    const moving = abs(bfV.u) > 0.2;
    let speed = 0, yawDes = r.yaw, vyT = 0;
    r.cool -= dt;
    if (r.state === REST) {
      r.ampT = 0.3; r.freq = 0.55; speed = 0;
      if (r.cool <= 0 && ((d3 < 5.5 && moving) || d3 < 2.8)) { r.state = STARTLE; r.t = 0; r.react = rf(0.1, 0.3); }
    } else if (r.state === STARTLE) {
      r.t += dt; r.ampT = 0.5; r.freq = 1.6;
      if (r.t > r.react) {
        r.state = LIFT; r.t = 0; r.yaw = atan2(away[0], -away[2]) + rf(-0.5, 0.5);
        puff(r.p[0], r.p[1], r.p[2], 0.9 * r.scale, 50, 0.9, 0.5 * (0.6 + r.scale)); if (r.site >= 0) pitLift(r); if (r.site >= 0) { sites[r.site].used = -1; r.site = -1; }
      }
    } else if (r.state === LIFT) {
      r.t += dt; r.ampT = 1; r.freq = 3.0; yawDes = r.yaw;
      speed = 0.45 + 0.85 * bfSS(0, 1.3, r.t); vyT = 1.15 * (1 - bfSS(0.7, 2.0, r.t)) + 0.1;
      r.puffT -= dt; if (r.puffT < 0) { r.puffT = 0.05; puffTips(r, 3); if (r.t < 1.2) puff(r.p[0], r.p[1] - 0.1, r.p[2], 0.6 * r.scale, 3, 0.5, 0.5 * (0.6 + r.scale)); }
      if (r.t > 2.4) { r.state = GLIDE; r.t = 0; r.glideT = rf(16, 26); }
    } else if (r.state === GLIDE) {
      r.t += dt; r.glideT -= dt; if (r.t < 3.5) { r.puffT -= dt; if (r.puffT < 0) { r.puffT = 0.07; puffTips(r, 2); } }
      speed = 1.15; r.freq = 0.95; r.ampT = r.t < 5 ? 0.7 : 0.5 + 0.2 * sin(t * 0.9 + r.i);
      if (r.t < dt * 1.5) r.hd = r.yaw;
      r.wanderT -= dt; if (r.wanderT < 0) { r.wanderT = rf(3, 6); if (r.t > 8) r.hd = r.yaw + rf(-0.7, 0.7); }   // keep going the way it was thrown for the first 8 s
      yawDes = r.hd;
      if (r.glideT < 0) { const k = nearestSite(r.p[0] + sin(r.yaw) * 18, r.p[2] - cos(r.yaw) * 18, 16, r.i); if (k >= 0) { r.site = k; sites[k].used = r.i; r.state = LAND; r.t = 0; } else r.glideT = 8; }
    } else if (r.state === LAND) {
      r.t += dt; const s = sites[r.site], sx = wrapD(s.x - r.p[0]), sz = wrapD(s.z - r.p[2]), sd = hypot(sx, sz);
      yawDes = atan2(sx, -sz); speed = bfClamp(sd * 0.3, 0.22, 1.1); r.freq = 0.8 + 0.5 * bfSS(2, 0, sd); r.ampT = 0.55 + 0.3 * bfSS(2, 0, sd);
      if (sd < 1.5) { r.v[0] *= 1 - min(1, 2 * dt); r.v[2] *= 1 - min(1, 2 * dt); }
      if (sd < 0.6 && r.p[1] < s.y + 0.35) { puff(s.x, s.y, s.z, 0.8 * r.scale, 10, 0.3, 0.4 * (0.6 + r.scale)); settle(r, r.site, r.yaw, 14); pitSet(r); return place_inst(r, dt); }
    } else {   // open water: wander, follow the leader, stay clear of rock, veer off from the LAUV
      r.wanderT -= dt; if (r.wanderT < 0) { r.wanderT = rf(5, 11); r.hd = r.yaw + rf(-0.9, 0.9); }
      yawDes = r.hd;
      const leash = r.type === 2 ? 95 : 80;
      if (d2 > leash) r.hd = yawDes = atan2(-away[0], away[2]);
      if (r.leader) { const L = r.leader, ox = sin(L.yaw) * r.off[0] + cos(L.yaw) * r.off[1], oz = -cos(L.yaw) * r.off[0] + sin(L.yaw) * r.off[1]; yawDes = atan2(wrapD(L.p[0] + ox - r.p[0]), -wrapD(L.p[2] + oz - r.p[2])); }
      speed = r.speed;
      if (r.leader) speed = r.leader.speed + bfClamp(hypot(wrapD(r.leader.p[0] - r.p[0]), wrapD(r.leader.p[2] - r.p[2])) - 3.5, -0.8, 1.2) * 0.4;
      const R0 = r.type === 2 ? 15 : 17;
      if (r.veer <= 0 && d3 < R0 && (moving || d3 < 7)) { r.veer = 5; r.vside = rng() < 0.5 ? -1 : 1; }
      if (r.veer > 0) { r.veer -= dt; r.hd = yawDes = atan2(away[0], -away[2]) + r.vside * 0.35; speed = r.speed * 1.7; r.freq = 1.5; r.ampT = 1; vyT = (dyv < 0 ? 0.3 : -0.3); }
      else { r.freq = r.type === 2 ? 0.45 : 0.85; r.pause -= dt; r.ampT = r.pause < 0 ? 0.14 : r.type === 2 ? 0.8 : 0.9; if (r.pause < -2.6 - r.i * 0.1) r.pause = rf(7, 14); }
      // rock ahead: turn to the freer side
      const fx = sin(r.yaw), fz = -cos(r.yaw);
      if (!bfFree(r.p[0], r.p[1], r.p[2], fx, 0, fz, 9, 1.2)) {
        const l = bfFree(r.p[0], r.p[1], r.p[2], sin(r.yaw - 0.8), 0, -cos(r.yaw - 0.8), 7, 1.0);
        yawDes = r.hd = r.yaw + (l ? -0.9 : 0.9); speed *= 0.8; if (!bfFree(r.p[0], r.p[1], r.p[2], fx, 0.3, fz, 9, 1.2)) vyT = 0.6;
      }
      // depth: above the seabed, below the surface
      r.gyT -= dt; if (r.gyT < 0) { r.gyT = 0.4 + rng() * 0.2; r.gy = bfGround(r.p[0] + fx * 4, r.p[2] + fz * 4, min(r.p[1] + 2, -1)); }
      const want = bfClamp(max(r.gy + (r.type === 2 ? 4.5 : 3.2), r.type === 2 ? -10 : -8.5), -14, r.type === 2 ? -5 : -4.5) + 0.8 * sin(t * 0.17 + r.i);
      vyT += bfClamp((want - r.p[1]) * 0.5, -0.5, 0.5);
    }
    // integrate: heading (turn rate limited), speed, climb
    const rate = r.state === CRUISE ? (r.type === 2 ? 0.28 : 0.4) * (r.veer > 0 ? 1.8 : 1) : 0.6;
    const dyaw = bfClamp(wrapA(yawDes - r.yaw), -rate * dt, rate * dt); r.yaw = wrapA(r.yaw + dyaw);
    if (dt > 1e-5) r.yawRate += (dyaw / dt - r.yawRate) * min(1, 3 * dt);
    const fx = sin(r.yaw), fz = -cos(r.yaw), k = min(1, 2.2 * dt);
    r.v[0] += (fx * speed - r.v[0]) * k; r.v[2] += (fz * speed - r.v[2]) * k;
    let vy = vyT;
    if (r.state === GLIDE || r.state === LAND || r.state === LIFT) {
      // follow the sand: a metre and a bit above it, looking ahead
      r.gyT -= dt; if (r.gyT < 0) { r.gyT = 0.15; r.gy = max(bfGround(r.p[0], r.p[2], r.p[1] + 1.5), bfGround(r.p[0] + fx * 2.5, r.p[2] + fz * 2.5, r.p[1] + 2.5)); }
      if (r.state === GLIDE) vy = bfClamp((r.gy + 1.3 + 0.35 * sin(t * 0.5 + r.i) - r.p[1]) * 0.8, -0.5, 0.8);
      else if (r.state === LAND) { const s = sites[r.site], sd = hypot(wrapD(s.x - r.p[0]), wrapD(s.z - r.p[2])); vy = bfClamp((s.y + 0.02 + min(sd, 6) * 0.22 - r.p[1]) * 1.0, -0.5, 0.6); }
    }
    r.v[1] += (vy - r.v[1]) * min(1, 3 * dt);
    r.p[0] = wrapT(r.p[0] + r.v[0] * dt); r.p[1] += r.v[1] * dt; r.p[2] = wrapT(r.p[2] + r.v[2] * dt);
    if (r.state !== REST && r.type === 0 && r.p[1] < r.gy + 0.04 && r.state !== LAND) r.p[1] = r.gy + 0.04;
    place_inst(r, dt);
  }
  function place_inst(r, dt) {
    const sp = hypot(r.v[0], r.v[2]);
    const pitchT = r.state === REST ? 0 : bfClamp(atan2(r.v[1], max(sp, 0.3)) * 1.1 + (r.state === LIFT ? 0.2 : 0), -0.6, 0.6);
    r.pitch += (pitchT - r.pitch) * min(1, 4 * dt);
    const rollT = r.state === REST ? 0 : bfClamp(r.yawRate * 0.9, -0.45, 0.45); r.roll += (rollT - r.roll) * min(1, 3 * dt);
    r.amp += (r.ampT - r.amp) * min(1, 3 * dt); r.phase += TAU * r.freq * dt;
    const cp = cos(r.pitch), sp_ = sin(r.pitch), fx = sin(r.yaw) * cp, fy = sp_, fz = -cos(r.yaw) * cp, rx = cos(r.yaw), rz = sin(r.yaw);
    // up0 = right0 x fwd
    const ux = -rz * fy * 1 + 0 * fz, uy = rz * fx - rx * fz, uz = rx * fy;
    const ul = hypot(ux, uy, uz) || 1, cr = cos(r.roll), sr = sin(r.roll), o = r.i * 16;
    inst[o] = r.p[0]; inst[o + 1] = r.p[1]; inst[o + 2] = r.p[2]; inst[o + 3] = r.scale;
    inst[o + 4] = fx; inst[o + 5] = fy; inst[o + 6] = fz; inst[o + 7] = r.phase;
    inst[o + 8] = ux / ul * cr + rx * sr; inst[o + 9] = uy / ul * cr; inst[o + 10] = uz / ul * cr + rz * sr; inst[o + 11] = r.amp;
    inst[o + 12] = r.type; inst[o + 13] = 0; inst[o + 14] = r.i * 1.73; inst[o + 15] = 0;
  }
  const ranges = [[0, NS], [NS, NE], [NS + NE, NM]];
  let meshes = [];
  function rayInit() {
    const all = ['sting', 'eagle', 'manta'].map(species); let v0 = 0, i0 = 0; const vbAll = new Uint8Array(all.reduce((a, m) => a + m.nv * 16, 0)), ibAll = new Uint32Array(all.reduce((a, m) => a + m.ni, 0));
    for (const m of all) { vbAll.set(new Uint8Array(m.vb.buffer || m.vb), v0 * 16); for (let k = 0; k < m.ni; k++) ibAll[i0 + k] = m.ib[k]; meshes.push({ i0, v0, ni: m.ni }); v0 += m.nv; i0 += m.ni; }
    meshes.vb = buf(vbAll, BU.VERTEX); meshes.ib = buf(ibAll, BU.INDEX);
    inst = new Float32Array(N * 16); ibuf = device.createBuffer({ size: N * 64, usage: BU.VERTEX | BU.COPY_DST });
    pbuf = device.createBuffer({ size: NP * 32, usage: BU.VERTEX | BU.COPY_DST });
    pitBuf = device.createBuffer({ size: NPIT * 32, usage: BU.VERTEX | BU.COPY_DST });
    { const m2 = mod(W_PIT); pitPipe = device.createRenderPipeline({ layout: pl0, vertex: { module: m2, entryPoint: 'vs', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] }] },
      fragment: { module: m2, entryPoint: 'fs', targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
      primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } }); }
    const mp = mod(W_PUFF);
    ppipe = device.createRenderPipeline({ layout: pl0, vertex: { module: mp, entryPoint: 'vs', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] }] },
      fragment: { module: mp, entryPoint: 'fs', targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
      primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
    pipe = scenePipe(mod(W_RAY), 'vsRay', 'fsRay', [vbSolid, { arrayStride: 64, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4'), A(5, 48, 'float32x4')] }]);
  }
  let tAll = 0, ok = false;
  function update(dt) {
    if (!inst || typeof window.__app !== 'object' || off) { ok = false; return; }
    const t0 = performance.now();
    bfVehicle(); tAll += dt;
    if (!placed) place();
    for (const r of R) { if (r.type === 0 && r.state === REST && r.site < 0) continue; stepRay(r, dt, tAll); }
    Q.writeBuffer(ibuf, 0, inst); ok = true; puffUpdate(dt); pitUpdate(dt);
    bfMis.ms += performance.now() - t0;
  }
  function draw(r) {
    if (!ok) return;
    useTile(r, 4); if (pits.length) { r.setPipeline(pitPipe); r.setVertexBuffer(0, pitBuf); r.draw(4, pits.length); }
    r.setPipeline(pipe); r.setVertexBuffer(0, meshes.vb); r.setVertexBuffer(1, ibuf); r.setIndexBuffer(meshes.ib, 'uint32');
    for (let k = 0; k < 3; k++) r.drawIndexed(meshes[k].ni, ranges[k][1], meshes[k].i0, meshes[k].v0, ranges[k][0]);
    if (np) { r.setPipeline(ppipe); r.setVertexBuffer(0, pbuf); r.draw(4, np); }
  }
  // test hooks: __big.rays
  const hook = (window.__big ||= {});
  hook.rays = {
    R, sites, off: (b) => { off = !!b; },
    // a resting stingray on the free site nearest (x, z) (default: 9 m ahead of the vehicle), returns it
    stingNear(x, z, i = 0) { bfVehicle(); const r = R[i], k = nearestSite(x ?? bfV.x + bfV.fx * 9, z ?? bfV.z + bfV.fz * 9, 0, r.i); settle(r, k, rng() * TAU); pitSet(r); return { site: sites[k], dist: hypot(wrapD(sites[k].x - bfV.x), wrapD(sites[k].z - bfV.z)) }; },
    // an eagle ray / manta cruising ahead of the vehicle
    cruiseNear(i, ahead = 12, side = 0, dy = 0) { bfVehicle(); const r = R[i]; r.p[0] = wrapT(bfV.x + bfV.fx * ahead + bfV.rx * side); r.p[2] = wrapT(bfV.z + bfV.fz * ahead + bfV.rz * side); r.p[1] = bfV.y + dy; r.yaw = bfV.yaw + PI / 2; r.v.fill(0); r.state = CRUISE; r.leader = null; r.veer = 0; r.hd = r.yaw; },
    lift(i) { R[i].state = STARTLE; R[i].t = 0; R[i].react = 0.05; R[i].cool = 0; },
  };
  return { name: 'rays', init: rayInit, update, draw };
})());
