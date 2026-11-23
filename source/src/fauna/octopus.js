// ============================================================================
// octopuses (Octopus vulgaris): procedural arms, camouflage skin, alarm flash, ink, jet escape, den
// ============================================================================
// Each animal lives near a crevice found in the collision field (a den) and rests on the rock close to it, matched to the
// rock. When the LAUV comes near it blanches, flashes dark with white spots, inks, jets mantle-first with its arms
// trailing to the den, squeezes in, and later peeks out and comes back to its perch. Geometry (body rings, 8 arms of
// 16 rings, 2 eyes) is built on the CPU every frame for the animals that are near the camera: about 0.1 ms each.
const OCT_N = 6, OCT_NA = 8, OCT_NS = 16, OCT_NRB = 20, OCT_BR = 17, OCT_AR = 9, OCT_ER = 9, OCT_EC = 10;
const OCT_VA = OCT_NA * OCT_NS * OCT_AR, OCT_VB = OCT_NRB * OCT_BR, OCT_VE = OCT_ER * OCT_EC, OCT_VPO = OCT_VA + OCT_VB + 2 * OCT_VE;
const OCT_MAXINK = 128, OCT_SEE = 150;
const OS = { REST: 0, CRAWL: 1, ALARM: 2, JET: 3, ENTER: 4, HIDE: 5, PEEK: 6, EXIT: 7 };

const W_OCTO = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) uv: vec2f, @location(3) sk: vec4f, @location(4) mi: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) sk: vec4f, @location(4) mi: vec4f };
@vertex fn vs(i: VI) -> VO {
  var o: VO; let w = i.p + tl.xyz;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = i.n.xyz; o.uv = i.uv; o.sk = i.sk; o.mi = i.mi;
  return o;
}
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vn3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
// distance to the nearest of the jittered points of the cell grid (papillae, spots): x = distance, y = cell hash
fn cell2(p: vec2f) -> vec2f {
  let i = floor(p); let f = fract(p); var d = 9.; var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let hh = h31(vec3f(i + o, 3.7));
    let r = o + vec2f(hh, h31(vec3f(i + o, 9.1))) * .8 + .1 - f; let dd = dot(r, r);
    if (dd < d) { d = dd; id = hh; }
  } }
  return vec2f(sqrt(d), id);
}
fn skinH(q: vec3f, pap: f32, sc: f32) -> f32 {
  // papillae: a dome per cell, several sizes; flat when the skin is smooth
  let a = cell2(vec2f(q.x, q.y + q.z * .37) * sc);
  let b = cell2(vec2f(q.y, q.x * .6 - q.z) * sc * 2.1 + 5.);
  return pap * (ss(.62, .05, a.x) * (.6 + .4 * a.y) + .35 * ss(.5, .05, b.x));
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let part = i.mi.x; let t = g.cam.w;
  var N = normalize(i.n);
  if (!ff) { N = N; }
  let dist = length(i.wp - g.cam.xyz);
  let pale = i.sk.x; let dark = i.sk.y; let pap = i.sk.z; let mot = i.sk.w; let sand = i.mi.y; let seed = i.mi.z * 91.;
  // skin coordinates in metres, continuous around the tube
  let R = select(.08, .035, part > .25);
  let q = vec3f(i.uv.x, cos(i.uv.y) * R, sin(i.uv.y) * R);
  let hgt = skinH(q, pap, 52.);
  let dpx = dpdx(i.wp); let dpy = dpdy(i.wp); let dhx = dpdx(hgt); let dhy = dpdy(hgt);
  var alb = vec3f(0.);
  var gloss = .5; var spec = 1.;
  if (part > .75) {
    // eye: golden iris, horizontal slit pupil that stays level, eyelid skin around it
    let e = i.uv; let rr = length(e);
    var skin = mix(vec3f(.10, .075, .055), vec3f(.26, .21, .15), sand) * (.7 + .5 * vn3(vec3f(e * 9., seed)));
    skin = mix(skin, vec3f(.55, .5, .45), pale * .8); skin = mix(skin, vec3f(.03, .02, .015), dark * .85);
    let iris = ss(.74, .6, rr);
    let streak = .6 + .5 * vn3(vec3f(atan2(e.y, e.x) * 5., rr * 6., seed));
    var ic = mix(vec3f(.62, .36, .07), vec3f(.95, .72, .25), streak * ss(.15, .6, rr)) * (.5 + .7 * ss(.7, .3, rr));
    let slit = ss(.12, .08, abs(e.y)) * ss(.5, .42, abs(e.x));
    ic = mix(ic, vec3f(.004), slit);
    ic = mix(ic, skin * .5, ss(.6, .72, rr));
    alb = mix(skin, ic, iris);
    alb = mix(skin, alb, ss(0., .3, i.mi.w));   // mi.w: how open the eye is (blinks)
    gloss = 1.; spec = 3.;
  } else {
    let base = mix(vec3f(.27, .235, .19), vec3f(.44, .38, .28), sand);
    let m1 = vn3(q * vec3f(14., 30., 30.) + seed) * .6 + vn3(q * 60. + seed * 2.) * .4;
    let m2 = vn3(q * vec3f(40., 85., 85.) + 11. + seed + t * .05);
    // chromatophores: broad warm and dark patches with fine flecks, drifting slowly like clouds
    let cl = vn3(vec3f(q.x * 11., q.y * 24., q.z * 24.) + vec3f(t * .07, 0., seed));
    var col = base * (1. + (m1 - .5) * 1.1 * mot);
    col = mix(col, base * vec3f(.52, .38, .30), ss(.55, .8, cl) * mot * .7);
    col = mix(col, base * vec3f(1.35, 1.25, 1.15), ss(.62, .9, m2) * mot * .4);
    // mantle and arms are a touch darker above than below
    let under = ss(.1, .9, -N.y);
    col *= mix(1., 1.25, under) * mix(.9, 1.1, part);
    // pale: blanched, translucent grey-white; dark: deep brown with white spots (the deimatic display)
    col = mix(col, vec3f(.60, .57, .52) * (.8 + .3 * m1), pale * .9);
    let sp = ss(.30, .17, cell2(vec2f(q.x, q.y + q.z * .5) * 26. + 3.).x);
    col = mix(col, vec3f(.035, .018, .016), dark * .92);
    col = mix(col, vec3f(.75, .72, .66), sp * dark * dark * .9);
    // arms: rows of suckers along the underside (the side that faces the rock when resting)
    if (part < .75 && part > .25) {
      let ang = i.uv.y; let ca_ = cos(ang);
      let un = ss(.25, .8, ca_);
      var sk = 0.;
      for (var rw = 0; rw < 2; rw++) {
        let a0 = select(-.42, .42, rw == 1); let sa = fract(i.uv.x * 52. + select(0., .5, rw == 1)) - .5;
        let da = atan2(sin(ang - a0 - 3.14159), cos(ang - a0 - 3.14159));
        let dd = length(vec2f(sa * .9, da * 1.5));
        sk = max(sk, ss(.5, .32, dd) * (1. - .45 * ss(.2, .0, dd)));
      }
      let lighter = col * vec3f(1.3, 1.22, 1.1) + .03;
      col = mix(col, lighter, un * .8);
      col = mix(col, col * vec3f(.7, .55, .5), un * sk * .6);
      // white rim of the suckers, as in the footage of the dark display
      col = mix(col, vec3f(.8, .75, .7), un * ss(.38, .3, abs(sk - .5)) * dark * .6);
      // arm tips are paler and finer
      col = mix(col, col * 1.2 + .03, ss(.75, 1., i.uv.x / .8) * .6);
    }
    alb = col;
    // papillae: bumps by screen-space derivatives of a height field
    let h = hgt;
    let r1 = cross(dpy, N); let r2 = cross(N, dpx); let det = dot(dpx, r1);
    let grad = sign(det) * (dhx * r1 + dhy * r2);
    N = normalize(abs(det) * N - grad * .0032 * ss(5., 1.2, dist));
    // papillae catch the light: pale tips, dark crevices between them
    alb = alb * (1. - .3 * pap * ss(.45, .0, h)) + vec3f(.34, .31, .26) * pap * ss(.55, .95, h) * (1. - dark * .6) * .5;
    gloss = mix(.55, .25, pap);
  }
  alb = max(alb, vec3f(.004));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp);
  let v1 = vol(i.wp + N * .35); let v2 = vol(i.wp + N * 1.2);
  let ao = mix(.75, 1., sat((v1.r - .5) * 6.)) * mix(.85, 1., sat((v2.r - .5) * 3.));
  let sh = shadow4(i.wp + N * .03);
  let E = sunE(i.wp.y, z) * sh;
  let ca = caus(i.wp, dist);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, max(v1.g, .75), z) + side(i.wp, N, .9, z)) * ao;
  let dl = E * ndl * (.10 + mix(vec3f(.33), ca, ss(.1, .45, dot(N, L))) * 2.5);
  var c = alb * (dl + am * 2.8);
  // wet skin: a tight highlight and a soft sheen at grazing angles; blanched skin glows a little from within
  let H = normalize(V + L);
  c += E * (.3 + ca) * pow(sat(dot(N, H)), mix(18., 90., gloss)) * gloss * ndl * 1.6 * spec;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) * ao) * .12 * pow(1. - sat(dot(N, V)), 3.) * gloss;
  c += alb * pale * am * .5;
    return fin(fog(c, i.wp, z));
}

// ink: soft billboards, one instance = 8 floats (x, y, z, radius | age 0-1, alpha, seed, 0)
struct IO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) b: vec4f, @location(2) wp: vec3f, @location(3) @interpolate(flat) sh: f32 };
@vertex fn vsInk(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> IO {
  var o: IO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let c = g.cam.xyz + wd(a.xyz - g.cam.xyz) + tl.xyz; let w = c + (g.right.xyz * q.x + g.up.xyz * q.y) * a.w;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.b = b; o.wp = c; o.sh = shadow1(c);
  return o;
}
@fragment fn fsInk(i: IO) -> @location(0) vec4f {
  let z = zone(i.wp); let v = i.wp - g.cam.xyz; let d = length(v);
  let age = i.b.x; let seed = i.b.z * 53.;
  // the cloud's edge is eroded by noise that grows with age: a tight blob at first, then wisps
  let p3 = vec3f(i.uv * 2.2, seed + age * 1.6);
  let n = vn3(p3) * .55 + vn3(p3 * 2.3 + 7.) * .3 + vn3(p3 * 5.1 + 3.) * .15;
  let r = length(i.uv);
  let n2 = vn3(p3 * 4.3 + 17.);
  let lump = vn3(vec3f(i.uv * 1.7, seed * .5 + age * .5));
  let core = 1. - ss(.2, 1., r + (n - .5) * (.8 + age * 1.3) + (n2 - .5) * .3 + (lump - .5) * .5);
  var al = ss(0., .8, core) * i.b.y;
  al *= ss(.1, .9, d);
  if (al < .002) { discard; }
  let T = exp(-SIG.g * d);
  let fg = fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz);
  let E = sunE(i.wp.y, z) * (.3 + .7 * i.sh);
  var c = vec3f(.075, .068, .042) * (E * .35 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * 1.4) * (.5 + n * .8) + vec3f(.004, .003, .003);
  c = c * T + fg * (1. - T);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(12.)), al);
}
`;

// ---------------------------------------------------------------- small vector helpers (scratch, no allocations)
const _ov = new Float64Array(12), _on = new Float64Array(3);
const octLen = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
// signed distance of the collision field at a point (> 0 inside rock) and its outward normal in _on
function octN(x, y, z) {
  const e = 0.2, d = sdAt(x, y, z), gx = sdAt(x + e, y, z) - d, gy = sdAt(x, y + e, z) - d, gz = sdAt(x, y, z + e) - d, l = octLen(gx, gy, gz);
  if (l < 1e-4) { _on[0] = 0; _on[1] = 1; _on[2] = 0; } else { _on[0] = -gx / l; _on[1] = -gy / l; _on[2] = -gz / l; }
  return d;
}
const octSS = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
// the field saturates at +-1 m: further from a surface than that there is no gradient

// the substrate under the world: the highest rock in a column (collision bricks)
function octFloor(x, z) { const ix = floor((wrapT(x) - OX) / VS), iz = floor((wrapT(z) - OZ) / VS); for (let y = NY - 2; y > 0; y--) if (cv(ix, y, iz) > 0) return OY + (y + 0.5) * VS; return OY; }

// ---------------------------------------------------------------- state
const octO = [];
const octInk = { a0: new Float32Array(OCT_MAXINK), p: new Float32Array(OCT_MAXINK * 8), v: new Float32Array(OCT_MAXINK * 3), life: new Float32Array(OCT_MAXINK), s0: new Float32Array(OCT_MAXINK), n: 0 };
const octG = { ready: false, scanN: 0, cands: [], rs: 90210, gpu: null, ms: 0, drawn: 0 };
const octRn = () => { octG.rs = (Math.imul(octG.rs, 1664525) + 1013904223) >>> 0; return octG.rs / 4294967296; };
let OCT_DIRS_H;
const OCT_DIRS = (() => { const d = []; for (let i = 0; i < 14; i++) { const a = Math.acos(1 - 2 * (i + 0.5) / 14), ph = i * 2.399963; d.push([Math.sin(a) * Math.cos(ph), Math.cos(a), Math.sin(a) * Math.sin(ph)]); } return d; })();
OCT_DIRS_H = OCT_DIRS.slice().sort((a, b) => Math.abs(a[1] - 0.15) - Math.abs(b[1] - 0.15));

function octNew(i) {
  return {
    i, state: OS.REST, t: 0, hideT: 20, restT: 10, peekT: 0, seen: 0,
    P: new Float64Array(3), A: new Float64Array([0, 1, 0]), F: new Float64Array([0, 0, -1]), V: new Float64Array(3),
    den: new Float64Array(3), dout: new Float64Array(3), front: new Float64Array(3), perch: new Float64Array(3), perchN: new Float64Array([0, 1, 0]), wp: new Float64Array(3),
    tip: new Float64Array(24), ideal: new Float64Array(24), pl: new Uint8Array(8), stepT: new Float32Array(8).fill(-1), stepA: new Float64Array(24), stepB: new Float64Array(24),
    phi: new Float32Array(8), rho: new Float32Array(8), alen: new Float32Array(8), aph: new Float32Array(8),
    scale: 0.92 + 0.22 * octRn(), sand: 0.4, hue: octRn(),
    pale: 0, dark: 0.05, pap: 0.85, mot: 0.75, curl: 0.2, lean: 1, flat: 0, breath: 0, pulse: 0, open: 1, blinkT: 3 + octRn() * 4,
    jetT: 0, jetN: 0, fidget: 2, idT: 0, curious: false, curArm: 2, cx: 0, cy: 0, cz: 0, bph: 0, blink: 0, ox: 0, oz: 0, camD: 99, near: false, mx: 0, my: 0, mz: 0, lastDir: 0, inkT: 0, alarmT: 0, lastD: 99, vis: false, slot: 0, wigAmp: 0.012, home: false, pathI: 0, flick: 0,
  };
}

// ---------------------------------------------------------------- finding dens and perches in the collision field
function octScanStep(budget) {
  const G = octG;
  for (let k = 0; k < budget; k++) {
    G.scanN++;
    const near = octRn() < 0.4, x = near ? (octRn() - 0.5) * 140 : (octRn() - 0.5) * (NX * VS - 8), z = near ? (octRn() - 0.5) * 140 : (octRn() - 0.5) * (NZ * VS - 8), fl = octFloor(x, z);
    const y = octRn() < 0.5 ? fl + octRn() * 4 - 0.5 : OY + 2 + octRn() * (Math.max(fl, OY + 4) - OY - 2);
    const d = sdAt(x, y, z);
    if (d > -0.25 || d < -0.9) continue;
    let e = 0; for (let j = 0; j < 14; j++) { const v = OCT_DIRS[j]; if (sdAt(x + v[0] * 0.7, y + v[1] * 0.7, z + v[2] * 0.7) > 0) e++; }
    if (e >= 6) G.cands.push([x, y, z, d, e]);
  }
}
// a free line from the den to open water: the direction (unit) that stays free and the water point, or false
function octDenExit(c, out) {
  const x = c[0], y = c[1], z = c[2];
  for (let tries = 0; tries < 14; tries++) {
    const v = OCT_DIRS_H[tries]; if (sdAt(x + v[0] * 0.7, y + v[1] * 0.7, z + v[2] * 0.7) > -0.3) continue;
    let ok = true, dist = 0, free = false;
    for (let s = 0.25; s < 4; s += 0.2) { const px = x + v[0] * s, py = y + v[1] * s, pz = z + v[2] * s, d = sdAt(px, py, pz); if (d > -0.12 && s > 0.3) { ok = false; break; } if (d < -0.9) { free = true; dist = s + 0.4; break; } }
    if (!ok || !free) continue;
    out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; out[3] = x + v[0] * dist; out[4] = y + v[1] * dist; out[5] = z + v[2] * dist; return true;
  }
  return false;
}
// a resting place on up-facing rock close to the den entrance, in sight of it
function octFindPerch(O) {
  const fx = O.front[0], fy = O.front[1], fz = O.front[2];
  let best = -1e9, bx = 0, by = 0, bz = 0, bn = null;
  for (let tr = 0; tr < 40; tr++) {
    const a = octRn() * TAU, r = 1.4 + octRn() * 2.6, cx = fx + Math.cos(a) * r, cz = fz + Math.sin(a) * r;
    let y = fy + 1.5; if (sdAt(cx, y, cz) > -0.3) continue;
    let hit = false; for (let k = 0; k < 60; k++) { y -= 0.1; if (sdAt(cx, y, cz) >= -0.03) { hit = true; break; } }
    if (!hit) continue;
    const d = octN(cx, y, cz); if (_on[1] < 0.6) continue;
    const sx = cx + _on[0] * d, sy = y + _on[1] * d, sz = cz + _on[2] * d, nx = _on[0], ny = _on[1], nz = _on[2];
    // line of sight from just above the perch to the water point in front of the den
    const ox = sx + nx * 0.3, oy = sy + ny * 0.3, oz = sz + nz * 0.3, dx = fx - ox, dy = fy - oy, dz = fz - oz, dl = octLen(dx, dy, dz); let los = true;
    for (let s = 0.3; s < dl; s += 0.2) if (sdAt(ox + dx / dl * s, oy + dy / dl * s, oz + dz / dl * s) > -0.1) { los = false; break; }
    if (!los) continue;
    const score = -Math.abs(r - 2.2) + ny; if (score > best) { best = score; bx = sx; by = sy; bz = sz; bn = [nx, ny, nz]; }
  }
  if (!bn) return false;
  O.perch[0] = bx; O.perch[1] = by; O.perch[2] = bz; O.perchN[0] = bn[0]; O.perchN[1] = bn[1]; O.perchN[2] = bn[2];
  return true;
}
function octChoose() {
  const G = octG, c = G.cands, ex = new Float64Array(6), used = [];
  // closest to the start first (so one is easy to find), then the best enclosed ones spread over the world
  c.sort((a, b) => (b[4] - a[4]) || (a[3] - b[3]));
  const byStart = c.slice().sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]));
  const order = byStart.filter((q) => { const d = Math.hypot(q[0], q[2]); return d > 14 && d < 75; }).slice(0, 8).concat(c);
  for (const q of order) {
    if (octO.length >= OCT_N) break;
    let far = true; for (const u of used) if (Math.hypot(wrapD(q[0] - u[0]), wrapD(q[2] - u[2])) < (octO.length < 2 ? 22 : 32)) { far = false; break; }
    if (!far || !octDenExit(q, ex)) continue;
    const O = octNew(octO.length);
    O.den.set([q[0], q[1], q[2]]); O.dout.set([ex[0], ex[1], ex[2]]); O.front.set([ex[3], ex[4], ex[5]]);
    if (!octFindPerch(O)) continue;
    const ix = floor((wrapT(O.perch[0]) - OX) / VS), iz = floor((wrapT(O.perch[2]) - OZ) / VS);
    O.sand = clamp(MAP[(iz * NX + ix) * 4], 0, 1);
    used.push(q); octO.push(O);
  }
  for (const O of octO) octPlaceAtPerch(O);
  G.ready = true;
}
function octPlaceAtPerch(O) {
  O.state = OS.REST; O.t = 0; O.restT = 6 + octRn() * 14;
  O.P[0] = O.perch[0] + O.perchN[0] * 0.07; O.P[1] = O.perch[1] + O.perchN[1] * 0.07; O.P[2] = O.perch[2] + O.perchN[2] * 0.07;
  O.A.set(O.perchN); const a = octRn() * TAU; O.F[0] = Math.cos(a); O.F[1] = 0; O.F[2] = Math.sin(a); octOrtho(O);
  O.V.fill(0);
  for (let i = 0; i < 8; i++) { O.phi[i] = (i + 0.5) * Math.PI / 4 + (octRn() - 0.5) * 0.25; O.rho[i] = 0.5 + 0.16 * octRn(); O.alen[i] = 0.74 + 0.1 * octRn() + (i === 2 || i === 5 ? 0.05 : 0); O.aph[i] = octRn() * TAU; O.pl[i] = 0; }
  octIdeals(O, 0); for (let i = 0; i < 8; i++) { for (let k = 0; k < 3; k++) { O.tip[i * 3 + k] = O.ideal[i * 3 + k]; } O.pl[i] = 1; }
}

// ---------------------------------------------------------------- posture
function octOrtho(O) {
  const A = O.A, F = O.F; let l = octLen(A[0], A[1], A[2]) || 1; A[0] /= l; A[1] /= l; A[2] /= l;
  const d = F[0] * A[0] + F[1] * A[1] + F[2] * A[2]; F[0] -= A[0] * d; F[1] -= A[1] * d; F[2] -= A[2] * d;
  l = octLen(F[0], F[1], F[2]);
  if (l < 1e-4) { // pick any perpendicular
    if (Math.abs(A[1]) < 0.9) { F[0] = -A[2]; F[1] = 0; F[2] = A[0]; } else { F[0] = 1; F[1] = 0; F[2] = 0; } l = octLen(F[0], F[1], F[2]);
  }
  F[0] /= l; F[1] /= l; F[2] /= l;
}
// ideal planted points of the arms on the surface around the body (stored in plant[]); lead = how far ahead (m) along heading the body is going
function octIdeals(O, lead) {
  const A = O.A, F = O.F, P = O.P, sx = A[1] * F[2] - A[2] * F[1], sy = A[2] * F[0] - A[0] * F[2], sz = A[0] * F[1] - A[1] * F[0];
  for (let i = 0; i < 8; i++) {
    const c = Math.cos(O.phi[i]), s = Math.sin(O.phi[i]), front = Math.max(0, c);
    const r = O.rho[i] * O.scale + lead * (front - 0.3) * 1.4;
    let x = P[0] - A[0] * 0.07 + (F[0] * c + sx * s) * r, y = P[1] - A[1] * 0.07 + (F[1] * c + sy * s) * r, z = P[2] - A[2] * 0.07 + (F[2] * c + sz * s) * r;
    for (let k = 0; k < 3; k++) { const d = octN(x, y, z); if (d >= 0.99 || d <= -0.99) { if (k === 0) { /* nothing near: keep it */ } break; } x += _on[0] * d; y += _on[1] * d; z += _on[2] * d; }
    O.ideal[i * 3] = x; O.ideal[i * 3 + 1] = y; O.ideal[i * 3 + 2] = z;
  }
}

// ---------------------------------------------------------------- an arm: a curve of fixed length that reaches a goal point
// The first part is a circular arc from the base to the goal (its length chosen so the chord fits), the rest curls up in a
// spiral beyond the goal. The arc bulges towards a hint direction, a travelling wave wriggles it.
const octCh = new Float64Array(OCT_NS * 3);
const octArmR = (u) => 0.004 + 0.04 * Math.pow(1 - u, 1.05);
function octArmChain(O, bx, by, bz, gx, gy, gz, L, upx, upy, upz, upk, latk, sg, curl, wig, ph, t, twist) {
  const ch = octCh, NS = OCT_NS;
  let cx = gx - bx, cy = gy - by, cz = gz - bz; const cl0 = octLen(cx, cy, cz) || 1e-4; cx /= cl0; cy /= cl0; cz /= cl0;
  const Lr = L * (1 - (0.08 + 0.55 * curl)), cl = Math.min(cl0, Lr * 0.999), rho = cl / Lr;
  // bulge direction: up hint plus a sideways part, made perpendicular to the chord
  let lx = cy * upz - cz * upy, ly = cz * upx - cx * upz, lz = cx * upy - cy * upx; // chord x up
  let hx = upx * upk + lx * latk * sg, hy = upy * upk + ly * latk * sg, hz = upz * upk + lz * latk * sg;
  const hd = hx * cx + hy * cy + hz * cz; hx -= cx * hd; hy -= cy * hd; hz -= cz * hd; let hl = octLen(hx, hy, hz);
  if (hl < 1e-4) { hx = -cz; hy = 0; hz = cx; hl = octLen(hx, hy, hz) || 1; if (hl < 1e-4) { hx = 1; hl = 1; } }
  hx /= hl; hy /= hl; hz /= hl;
  const nx = cy * hz - cz * hy, ny = cz * hx - cx * hz, nz = cx * hy - cy * hx; // chord x w
  let x = 0; if (rho < 0.9995) { let lo = 1e-3, hi = 2.9; for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (Math.sin(m) / m > rho) lo = m; else hi = m; } x = (lo + hi) / 2; }
  const kap = x > 1e-3 ? 2 * x / Lr : 0, ds = L / (NS - 1);
  // state at the end of the arc, for the curl
  const th1 = x - kap * Lr, c1 = Math.cos(th1), s1 = Math.sin(th1);
  let px = 0, py = 0, pz = 0, tx = 0, ty = 0, tz = 0, qx = 0, qy = 0, qz = 0, sc = Lr, started = false;
  const kmax = 11 + 24 * curl, cs = Math.cos(twist), sn = Math.sin(twist);
  for (let k = 0; k < NS; k++) {
    const s = k * ds; let X, Y, Z = 0;
    if (s <= Lr + 1e-6) {
      if (kap > 1e-4) { X = (Math.sin(x) - Math.sin(x - kap * s)) / kap; Y = (Math.cos(x - kap * s) - Math.cos(x)) / kap; } else { X = s; Y = 0; }
      ch[k * 3] = bx + cx * X + hx * Y; ch[k * 3 + 1] = by + cy * X + hy * Y; ch[k * 3 + 2] = bz + cz * X + hz * Y;
    } else {
      if (!started) { // tangent and curl-plane normal at the end of the arc (the plane is turned by 'twist' about the tangent)
        started = true; const Xe = kap > 1e-4 ? (Math.sin(x) - Math.sin(th1)) / kap : Lr, Ye = kap > 1e-4 ? (Math.cos(th1) - Math.cos(x)) / kap : 0;
        px = bx + cx * Xe + hx * Ye; py = by + cy * Xe + hy * Ye; pz = bz + cz * Xe + hz * Ye;
        tx = cx * c1 + hx * s1; ty = cy * c1 + hy * s1; tz = cz * c1 + hz * s1;
        const ax = -cx * s1 + hx * c1, ay = -cy * s1 + hy * c1, az = -cz * s1 + hz * c1; // perpendicular to t in the (chord, w) plane
        qx = ax * cs + nx * sn; qy = ay * cs + ny * sn; qz = az * cs + nz * sn;
      }
      while (sc < s - 1e-6) {
        const st = Math.min(0.012, s - sc), kk = kmax * (sc + st / 2 - Lr) / (L - Lr);
        tx += qx * kk * st; ty += qy * kk * st; tz += qz * kk * st; const tl = octLen(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const d = qx * tx + qy * ty + qz * tz; qx -= tx * d; qy -= ty * d; qz -= tz * d; const ql = octLen(qx, qy, qz) || 1; qx /= ql; qy /= ql; qz /= ql;
        px += tx * st; py += ty * st; pz += tz * st; sc += st;
      }
      ch[k * 3] = px; ch[k * 3 + 1] = py; ch[k * 3 + 2] = pz;
    }
    // wriggle
    const u = s / L, am = wig * Math.pow(u, 1.2), w1 = am * Math.sin(ph + u * 6 - t * 2.1), w2 = am * 0.6 * Math.sin(ph * 1.7 + u * 4.4 - t * 1.6);
    ch[k * 3] += nx * w1 + hx * w2; ch[k * 3 + 1] += ny * w1 + hy * w2; ch[k * 3 + 2] += nz * w1 + hz * w2;
  }
}

// ---------------------------------------------------------------- vertex output
const octAB = new ArrayBuffer(OCT_VPO * 32), octF = new Float32Array(octAB), octI = new Int8Array(octAB), octU = new Uint8Array(octAB);
let octSk0 = 0, octSk1 = 0, octSk2 = 0, octSk3 = 0, octMi1 = 0, octMi2 = 0;
const q8 = (v) => Math.round(clamp(v, 0, 1) * 255);
function octPut(vi, x, y, z, nx, ny, nz, u, v, part, open) {
  const o = vi * 8, b = vi * 32; octF[o] = x; octF[o + 1] = y; octF[o + 2] = z;
  const l = octLen(nx, ny, nz) || 1; octI[b + 12] = Math.round(nx / l * 127); octI[b + 13] = Math.round(ny / l * 127); octI[b + 14] = Math.round(nz / l * 127); octI[b + 15] = 0;
  octF[o + 4] = u; octF[o + 5] = v;
  octU[b + 24] = octSk0; octU[b + 25] = octSk1; octU[b + 26] = octSk2; octU[b + 27] = octSk3; octU[b + 28] = part; octU[b + 29] = octMi1; octU[b + 30] = octMi2; octU[b + 31] = open;
}
function octStaticIdx() {
  const idx = []; const grid = (base, rows, cols) => { for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = base + r * cols + c, b = a + 1, c2 = a + cols, d = c2 + 1; idx.push(a, c2, b, b, c2, d); } };
  for (let i = 0; i < OCT_NA; i++) grid(i * OCT_NS * OCT_AR, OCT_NS, OCT_AR);
  grid(OCT_VA, OCT_NRB, OCT_BR);
  grid(OCT_VA + OCT_VB, OCT_ER, OCT_EC); grid(OCT_VA + OCT_VB + OCT_VE, OCT_ER, OCT_EC);
  return new Uint16Array(idx);
}
const OCT_PROF = [[0, 0], [0.05, 0.062], [0.1, 0.080], [0.16, 0.088], [0.25, 0.079], [0.36, 0.066], [0.48, 0.078], [0.66, 0.094], [0.84, 0.086], [0.95, 0.056], [1, 0]];
function octProf(u) { for (let k = 1; k < OCT_PROF.length; k++) if (u <= OCT_PROF[k][0]) { const a = OCT_PROF[k - 1], b = OCT_PROF[k], f = (u - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * f; } return 0; }
const octSp = new Float64Array(OCT_NRB * 12);   // per ring: centre(3) tangent(3) front(3) rS rF dr ds
function octBuild(O, ox, oy, oz) {
  octSk0 = q8(O.pale); octSk1 = q8(O.dark); octSk2 = q8(O.pap); octSk3 = q8(O.mot); octMi1 = q8(O.sand); octMi2 = q8(O.hue);
  const P = O.P, A = O.A, F = O.F, NRB = OCT_NRB, sc = O.scale, len = 0.30 * sc, step = len / (NRB - 1);
  const sx = A[1] * F[2] - A[2] * F[1], sy = A[2] * F[0] - A[0] * F[2], sz = A[0] * F[1] - A[1] * F[0];
  let cx = P[0], cy = P[1], cz = P[2];
  const mantle = 1 - 0.24 * O.pulse + 0.035 * O.breath, flat = O.flat;
  for (let k = 0; k < NRB; k++) {
    const u = k / (NRB - 1), th = O.lean * octSS(0.12, 1, u), ct = Math.cos(th), st = Math.sin(th), o = k * 12;
    const tx = A[0] * ct - F[0] * st, ty = A[1] * ct - F[1] * st, tz = A[2] * ct - F[2] * st;
    octSp[o] = cx + ox; octSp[o + 1] = cy + oy; octSp[o + 2] = cz + oz; octSp[o + 3] = tx; octSp[o + 4] = ty; octSp[o + 5] = tz;
    octSp[o + 6] = F[0] * ct + A[0] * st; octSp[o + 7] = F[1] * ct + A[1] * st; octSp[o + 8] = F[2] * ct + A[2] * st;
    const m = 1 + (mantle - 1) * octSS(0.3, 0.55, u), r = octProf(u) * sc * m;
    octSp[o + 9] = r * (1 + 0.3 * flat); octSp[o + 10] = r * (1 - 0.28 * flat);
    cx += tx * step * (1 + 0.1 * O.pulse * u); cy += ty * step * (1 + 0.1 * O.pulse * u); cz += tz * step * (1 + 0.1 * O.pulse * u);
  }
  for (let k = 0; k < NRB; k++) { const a = Math.max(k - 1, 0) * 12, b = Math.min(k + 1, NRB - 1) * 12; octSp[k * 12 + 11] = (octSp[b + 9] - octSp[a + 9]) / (step * (b - a) / 12); }
  let vi = OCT_VA;
  for (let k = 0; k < NRB; k++) {
    const o = k * 12, rS = octSp[o + 9], rF = octSp[o + 10], dr = octSp[o + 11], u = k / (NRB - 1);
    for (let j = 0; j < OCT_BR; j++) {
      const a = j / (OCT_BR - 1) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const fx = octSp[o + 6], fy = octSp[o + 7], fz = octSp[o + 8];
      const px = octSp[o] + (fx * ca * rF + sx * sa * rS), py = octSp[o + 1] + (fy * ca * rF + sy * sa * rS), pz = octSp[o + 2] + (fz * ca * rF + sz * sa * rS);
      const e1 = ca / Math.max(rF, 1e-3), e2 = sa / Math.max(rS, 1e-3);
      octPut(vi++, px, py, pz, fx * e1 + sx * e2 - octSp[o + 3] * dr * 0.9 / Math.max(Math.hypot(e1, e2), 1), fy * e1 + sy * e2 - octSp[o + 4] * dr * 0.9 / Math.max(Math.hypot(e1, e2), 1),
        fz * e1 + sz * e2 - octSp[o + 5] * dr * 0.9 / Math.max(Math.hypot(e1, e2), 1), u * len, a, 0, 255);
    }
  }
  // eyes: on the sides of the head, pupil slit kept level
  const ke = 3, oe = ke * 12, re = 0.03 * sc;
  for (let e = 0; e < 2; e++) {
    const sg = e ? 1 : -1, rS = octSp[oe + 9], rF = octSp[oe + 10];
    let ezx = sx * sg * 0.9 + octSp[oe + 6] * 0.55 + octSp[oe + 3] * 0.1, ezy = sy * sg * 0.9 + octSp[oe + 7] * 0.55 + octSp[oe + 4] * 0.1, ezz = sz * sg * 0.9 + octSp[oe + 8] * 0.55 + octSp[oe + 5] * 0.1;
    let l = octLen(ezx, ezy, ezz); ezx /= l; ezy /= l; ezz /= l;
    const ecx = octSp[oe] + sx * sg * rS * 0.92 + octSp[oe + 6] * rF * 0.25, ecy = octSp[oe + 1] + sy * sg * rS * 0.92 + octSp[oe + 7] * rF * 0.25, ecz = octSp[oe + 2] + sz * sg * rS * 0.92 + octSp[oe + 8] * rF * 0.25;
    let exx = ezz, exy = 0, exz = -ezx; l = octLen(exx, exy, exz); if (l < 1e-3) { exx = 1; exy = 0; exz = 0; l = 1; } exx /= l; exy /= l; exz /= l;   // horizontal
    const eyx = ezy * exz - ezz * exy, eyy = ezz * exx - ezx * exz, eyz = ezx * exy - ezy * exx;
    for (let r = 0; r < OCT_ER; r++) {
      const th = Math.PI * r / (OCT_ER - 1), ct = Math.cos(th), st = Math.sin(th);
      for (let c = 0; c < OCT_EC; c++) {
        const ph = TAU * c / (OCT_EC - 1), nx = st * Math.cos(ph), ny = st * Math.sin(ph), nz = ct;
        const wx = exx * nx + eyx * ny + ezx * nz, wy = exy * nx + eyy * ny + ezy * nz, wz = exz * nx + eyz * ny + ezz * nz, k = nz < 0.1 ? 3 : 1;
        octPut(vi++, ecx + wx * re, ecy + wy * re, ecz + wz * re, wx, wy, wz, nx * k * sg * -1, ny * k, 255, q8(O.open));
      }
    }
  }
  // arms
  const NS = OCT_NS, NA = OCT_NA; vi = 0;
  for (let i = 0; i < NA; i++) {
    const c = Math.cos(O.phi[i]), s = Math.sin(O.phi[i]), rb = 0.05 * sc;
    const dx = F[0] * c + sx * s, dy = F[1] * c + sy * s, dz = F[2] * c + sz * s;
    const bx = P[0] + dx * rb, by = P[1] + dy * rb, bz = P[2] + dz * rb;
    const L = O.alen[i] * sc;
    let gx, gy, gz;
    // the free tip (above the base) for arms in the air, the planted one on the rock
    gx = O.tip[i * 3]; gy = O.tip[i * 3 + 1]; gz = O.tip[i * 3 + 2];
    const planted = O.pl[i] === 1 && O.state <= OS.CRAWL;
    octArmChain(O, bx, by, bz, gx, gy, gz, L, A[0], A[1], A[2], planted ? 0.35 : 0.8, planted ? 0.9 : 0.3, (i & 1) ? 1 : -1, O.curl, O.wigAmp, O.aph[i], g_octT, planted ? 0.15 * Math.sin(O.aph[i] * 3) : 0.8 + 0.7 * Math.sin(O.aph[i] * 3));
    // keep the nodes out of the rock
    if (O.near) for (let k = 2; k < NS; k++) {
      const x = octCh[k * 3], y = octCh[k * 3 + 1], z = octCh[k * 3 + 2], r = octArmR(k / (NS - 1)), d = sdAt(x, y, z);
      if (d > -r && d < 0.98) { octN(x, y, z); const p = Math.min(d + r, 0.12); octCh[k * 3] += _on[0] * p; octCh[k * 3 + 1] += _on[1] * p; octCh[k * 3 + 2] += _on[2] * p; }
    }
    // rings by parallel transport, ref vector = the underside
    let rx = -A[0], ry = -A[1], rz = -A[2];
    for (let k = 0; k < NS; k++) {
      const a = Math.max(k - 1, 0) * 3, b = Math.min(k + 1, NS - 1) * 3;
      let tx = octCh[b] - octCh[a], ty = octCh[b + 1] - octCh[a + 1], tz = octCh[b + 2] - octCh[a + 2]; const tl = octLen(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let d = rx * tx + ry * ty + rz * tz; rx -= tx * d; ry -= ty * d; rz -= tz * d; let rl = octLen(rx, ry, rz);
      if (rl < 1e-4) { rx = ty; ry = -tx; rz = 0; rl = octLen(rx, ry, rz) || 1; if (rl < 1e-4) { rx = 1; rl = 1; } } rx /= rl; ry /= rl; rz /= rl;
      const wx = ty * rz - tz * ry, wy = tz * rx - tx * rz, wz = tx * ry - ty * rx;
      const u = k / (NS - 1); let rad = octArmR(u) * sc * (k < 3 ? 1.2 : 1);
      for (let j = 0; j < OCT_AR; j++) {
        const an = j / (OCT_AR - 1) * TAU, ca = Math.cos(an), sa = Math.sin(an), nx = rx * ca + wx * sa, ny = ry * ca + wy * sa, nz = rz * ca + wz * sa;
        octPut(vi++, octCh[k * 3] + nx * rad, octCh[k * 3 + 1] + ny * rad, octCh[k * 3 + 2] + nz * rad, nx + tx * 0.25, ny + ty * 0.25, nz + tz * 0.25, u * L, an, 128, 255);
      }
    }
  }
}
let g_octT = 0;

// ---------------------------------------------------------------- ink
function octInkAdd(x, y, z, vx, vy, vz, s0, life, a0) {
  const k = octInk; if (k.n >= OCT_MAXINK) return; const i = k.n++, o = i * 8;
  k.p[o] = x; k.p[o + 1] = y; k.p[o + 2] = z; k.p[o + 3] = s0; k.p[o + 4] = 0; k.p[o + 5] = a0; k.p[o + 6] = octRn(); k.p[o + 7] = 0;
  k.v[i * 3] = vx; k.v[i * 3 + 1] = vy; k.v[i * 3 + 2] = vz; k.life[i] = life; k.s0[i] = s0; k.a0[i] = a0;
}
// the ink of an escape: a dense blob (the decoy) at the animal's position, and a trail while it jets
function octInkBurst(O, dx, dy, dz) {
  for (let k = 0; k < 22; k++) {
    const a = octRn() * TAU, b = octRn() * 2 - 1, r = Math.sqrt(1 - b * b), ux = r * Math.cos(a), uy = b, uz = r * Math.sin(a), sp = 0.14 + 0.22 * octRn();
    octInkAdd(O.P[0] + O.A[0] * 0.22 + ux * 0.12 - dx * 0.1, O.P[1] + O.A[1] * 0.22 + uy * 0.1 - dy * 0.1, O.P[2] + O.A[2] * 0.22 + uz * 0.12 - dz * 0.1, ux * sp - dx * 0.15, uy * sp * 0.6 + 0.06, uz * sp - dz * 0.15, 0.24 + 0.16 * octRn(), 13 + 5 * octRn(), 0.55 + 0.25 * octRn());
  }
}
function octInkStep(dt) {
  const k = octInk, t = g_octT;
  for (let i = 0; i < k.n; i++) {
    const o = i * 8; k.p[o + 4] += dt / k.life[i]; const a = k.p[o + 4];
    if (a >= 1) { const s = --k.n; if (i < s) { for (let j = 0; j < 8; j++) k.p[o + j] = k.p[s * 8 + j]; for (let j = 0; j < 3; j++) k.v[i * 3 + j] = k.v[s * 3 + j]; k.life[i] = k.life[s]; k.s0[i] = k.s0[s]; k.a0[i] = k.a0[s]; } i--; continue; }
    const dm = Math.exp(-dt * 0.9), sd = k.p[o + 6] * 40, px = k.p[o], py = k.p[o + 1], pz = k.p[o + 2];
    k.v[i * 3] = k.v[i * 3] * dm + Math.sin(py * 2.3 + t * 0.6 + sd) * 0.05 * dt; k.v[i * 3 + 1] = k.v[i * 3 + 1] * dm + (Math.sin(px * 1.7 + pz * 1.3 + t * 0.5 + sd) * 0.03 + 0.01) * dt; k.v[i * 3 + 2] = k.v[i * 3 + 2] * dm + Math.cos(py * 2.1 - t * 0.55 + sd) * 0.05 * dt;
    k.p[o] += k.v[i * 3] * dt; k.p[o + 1] += k.v[i * 3 + 1] * dt; k.p[o + 2] += k.v[i * 3 + 2] * dt;
    k.p[o + 3] = k.s0[i] * (1 + 4.2 * Math.sqrt(a));
    // alpha: grows in over the first moments, thins out as the cloud spreads
    k.p[o + 5] = Math.min(1, a / 0.03) * Math.pow(1 - a, 1.3) * k.a0[i];
  }
}

// ---------------------------------------------------------------- behaviour
const octSkin = (O, dt, tp, td, tpap, tmot, rate, rf) => {
  const k = 1 - Math.exp(-rate * dt), kf = 1 - Math.exp(-(rf || rate) * dt);
  O.pale += (tp - O.pale) * kf; O.dark += (td - O.dark) * kf; O.pap += (tpap - O.pap) * k; O.mot += (tmot - O.mot) * k;
};
// turn the axes: up axis towards (ax, ay, az) and the facing direction towards (fx, fy, fz) (made perpendicular), at rate k per second
function octTurn(O, dt, ax, ay, az, fx, fy, fz, k) {
  const e = Math.min(1, dt * k), A = O.A, F = O.F;
  A[0] += (ax - A[0]) * e; A[1] += (ay - A[1]) * e; A[2] += (az - A[2]) * e;
  F[0] += (fx - F[0]) * e; F[1] += (fy - F[1]) * e; F[2] += (fz - F[2]) * e; octOrtho(O);
}
// on the surface: keep the body at height h above it, up axis along the normal
function octStick(O, dt, h) {
  const P = O.P, d = octN(P[0], P[1], P[2]);
  if (d > 0.97 || d < -0.97) return false;
  const e = Math.min(1, dt * 8), mv = (d + h) * e; P[0] += _on[0] * mv; P[1] += _on[1] * mv; P[2] += _on[2] * mv;
  O.perchN[0] = _on[0]; O.perchN[1] = _on[1]; O.perchN[2] = _on[2];
  return true;
}
// swim to a point; returns the distance left. margin: how close to rock the body may come
function octSwim(O, dt, tx, ty, tz, speed, margin) {
  const P = O.P, V = O.V; let dx = tx - P[0], dy = ty - P[1], dz = tz - P[2]; const dl = octLen(dx, dy, dz) || 1e-4;
  const sp = Math.min(speed, dl * 2.5 + 0.12); dx /= dl; dy /= dl; dz /= dl;
  let vx = dx, vy = dy, vz = dz;
  const d = octN(P[0] + dx * 0.3, P[1] + dy * 0.3, P[2] + dz * 0.3);
  if (d > -margin - 0.1 && d < 0.97) { const f = (d + margin + 0.1) * 2.5; vx += _on[0] * f; vy += _on[1] * f; vz += _on[2] * f; const l = octLen(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l; }
  const e = Math.min(1, dt * 6); V[0] += (vx * sp - V[0]) * e; V[1] += (vy * sp - V[1]) * e; V[2] += (vz * sp - V[2]) * e;
  P[0] += V[0] * dt; P[1] += V[1] * dt; P[2] += V[2] * dt;
  const d2 = octN(P[0], P[1], P[2]); if (d2 > -margin && d2 < 0.97) { const p = d2 + margin; P[0] += _on[0] * p; P[1] += _on[1] * p; P[2] += _on[2] * p; }
  return dl;
}
function octPickWp(O) {
  for (let tr = 0; tr < 12; tr++) {
    const a = octRn() * TAU, r = 0.6 + octRn() * 1.4, cx = O.P[0] + Math.cos(a) * r, cz = O.P[2] + Math.sin(a) * r;
    let y = O.P[1] + 0.9; if (sdAt(cx, y, cz) > -0.3) continue;
    let hit = false; for (let k = 0; k < 24; k++) { y -= 0.1; if (sdAt(cx, y, cz) >= -0.03) { hit = true; break; } }
    if (!hit) continue; const d = octN(cx, y, cz); if (_on[1] < 0.6) continue;
    if (Math.hypot(wrapD(cx - O.perch[0]), wrapD(cz - O.perch[2])) > 3.2) continue;
    O.wp[0] = cx + _on[0] * d; O.wp[1] = y + _on[1] * d; O.wp[2] = cz + _on[2] * d; return true;
  }
  return false;
}
function octState(O, s) { O.state = s; O.t = 0; O.pathI = 0; }
const _g = new Float64Array(3);
function octArms(O, dt, free, rate, mx, my, mz, spread, reach, rise) {
  // free arms: tips follow goal points around the body (m = direction the body goes / is heading, spread = ring radius, reach = distance ahead)
  const P = O.P, A = O.A, F = O.F, sx = A[1] * F[2] - A[2] * F[1], sy = A[2] * F[0] - A[0] * F[2], sz = A[0] * F[1] - A[1] * F[0], e = 1 - Math.exp(-rate * dt);
  for (let i = 0; i < 8; i++) {
    const c = Math.cos(O.phi[i]), s = Math.sin(O.phi[i]); O.pl[i] = 0; O.stepT[i] = -1;
    const wob = 0.03 * Math.sin(g_octT * 1.7 + O.aph[i]);
    const gx = P[0] + mx * (reach + wob) + (F[0] * c + sx * s) * spread + A[0] * rise, gy = P[1] + my * (reach + wob) + (F[1] * c + sy * s) * spread + A[1] * rise, gz = P[2] + mz * (reach + wob) + (F[2] * c + sz * s) * spread + A[2] * rise;
    O.tip[i * 3] += (gx - O.tip[i * 3]) * e; O.tip[i * 3 + 1] += (gy - O.tip[i * 3 + 1]) * e; O.tip[i * 3 + 2] += (gz - O.tip[i * 3 + 2]) * e;
  }
}
function octCrawlArms(O, dt, lead) {
  O.idT -= dt; if (lead > 0 || O.idT < 0) { octIdeals(O, lead); O.idT = 0.25; }   // at rest the ideal places hardly change
  const A = O.A; let busy = 0; for (let i = 0; i < 8; i++) if (O.stepT[i] >= 0) busy++;
  O.fidget -= dt;
  for (let i = 0; i < 8; i++) {
    const o = i * 3;
    if (O.curious && i === O.curArm) { // one arm lifted and reaching towards the intruder, tip curling
      const e = Math.min(1, dt * 3), dl = octLen(O.cx, O.cy, O.cz) || 1, L = 0.5 * O.scale;
      for (let k = 0; k < 3; k++) { const dir = k === 0 ? O.cx : k === 1 ? O.cy : O.cz; const g = O.P[k] - A[k] * 0.05 + dir / dl * L + A[k] * (0.12 + 0.05 * Math.sin(g_octT * 1.3)); O.tip[o + k] += (g - O.tip[o + k]) * e; }
      O.pl[i] = 0; O.stepT[i] = -1; continue;
    }
    if (O.stepT[i] >= 0) {
      O.stepT[i] += dt / (lead > 0 ? 0.42 : 0.7); const f = octSS(0, 1, O.stepT[i]), lift = Math.sin(Math.PI * Math.min(1, O.stepT[i])) * (lead > 0 ? 0.1 : 0.06);
      for (let k = 0; k < 3; k++) O.tip[o + k] = O.stepA[o + k] + (O.stepB[o + k] - O.stepA[o + k]) * f + A[k] * lift;
      if (O.stepT[i] >= 1) { O.stepT[i] = -1; O.pl[i] = 1; for (let k = 0; k < 3; k++) O.tip[o + k] = O.stepB[o + k]; busy--; }
    } else if (O.pl[i]) {
      const dx = O.tip[o] - O.ideal[o], dy = O.tip[o + 1] - O.ideal[o + 1], dz = O.tip[o + 2] - O.ideal[o + 2], dd = octLen(dx, dy, dz);
      let go = (lead > 0 ? dd > 0.2 : dd > 0.5) && busy < 3;
      if (!go && lead === 0 && O.fidget < 0 && busy < 1 && octRn() < 0.5) { O.fidget = 2.5 + octRn() * 4; go = true; }
      if (go) { busy++; O.stepT[i] = 0; O.pl[i] = 0; for (let k = 0; k < 3; k++) { O.stepA[o + k] = O.tip[o + k]; O.stepB[o + k] = O.ideal[o + k] + (lead > 0 ? 0 : (octRn() - 0.5) * 0.1); } }
    } else { // settling after a swim
      const e = Math.min(1, dt * 7); for (let k = 0; k < 3; k++) O.tip[o + k] += (O.ideal[o + k] - O.tip[o + k]) * e;
      if (Math.hypot(O.tip[o] - O.ideal[o], O.tip[o + 1] - O.ideal[o + 1], O.tip[o + 2] - O.ideal[o + 2]) < 0.05) O.pl[i] = 1;
    }
  }
}

function octStep(O, dt) {
  const P = O.P, A = O.A, F = O.F, V = O.V, lvp = lv.pos;
  O.t += dt;
  const dx = wrapD(lvp[0] - P[0]), dy = lvp[1] - P[1], dz = wrapD(lvp[2] - P[2]), dist = octLen(dx, dy, dz);
  const spd = octLen(lv.v[0], lv.v[1], lv.v[2]), alertD = 4.2 + 2.8 * clamp(spd / 1.6, 0, 1);
  O.lastD = dist;
  O.blinkT -= dt; if (O.blinkT < 0) { O.blinkT = 2.5 + octRn() * 5; O.blink = 0.2; }
  if (O.blink > 0) { O.blink -= dt; O.open = O.blink > 0 ? 1 - Math.sin(Math.PI * O.blink / 0.2) : 1; } else O.open = 1;
  O.bph += dt * (O.state === OS.JET ? 7 : 5.3); O.breath = Math.sin(O.bph);
  O.pulse *= Math.exp(-dt * 5);
  const s = O.state;
  if ((s === OS.REST || s === OS.CRAWL || s === OS.EXIT) && dist < alertD && !(window.__octo && window.__octo.noscare)) { octState(O, OS.ALARM); O.pl.fill(0); O.stepT.fill(-1); }
  else if (s === OS.PEEK && dist < 5) { octState(O, OS.HIDE); O.hideT = 12 + octRn() * 8; }
  const nearC = O.camD < 40; if (window.__octo && window.__octo.noscare && (s <= OS.CRAWL)) { /* test: ignore the vehicle */ }
  switch (O.state) {
    case OS.REST: case OS.CRAWL: {
      const crawl = O.state === OS.CRAWL; let h = 0.07 * O.scale;
      if (octStick(O, dt, h)) {
        let fx = F[0], fy = F[1], fz = F[2], lean = 1, ds = 0.15;
        if (crawl) {
          let mx = O.wp[0] - P[0], my = O.wp[1] - P[1], mz = O.wp[2] - P[2]; const nd = mx * A[0] + my * A[1] + mz * A[2]; mx -= A[0] * nd; my -= A[1] * nd; mz -= A[2] * nd;
          const ml = octLen(mx, my, mz);
          if (ml < 0.1 || O.t > 30) { octState(O, OS.REST); O.restT = 8 + octRn() * 18; O.pl.fill(0); }
          else { mx /= ml; my /= ml; mz /= ml; const sp = 0.13 * Math.min(1, O.t * 2); P[0] += mx * sp * dt; P[1] += my * sp * dt; P[2] += mz * sp * dt; fx = mx; fy = my; fz = mz; lean = 0.75; O.lastDir = 1; O.mx = mx; O.my = my; O.mz = mz; }
        } else if (dist < 14) { // watching the intruder, head up, one arm reaching out
          O.curious = dist > alertD + 1.5; O.cx = dx; O.cy = 0; O.cz = dz;
          const nd = dx * A[0] + dy * A[1] + dz * A[2]; fx = dx - A[0] * nd; fy = dy - A[1] * nd; fz = dz - A[2] * nd; lean = 0.55; ds = 0.2;
          if (O.restT < 8) O.restT = 8;
        }
        octTurn(O, dt, O.perchN[0], O.perchN[1], O.perchN[2], fx, fy, fz, crawl ? 3 : 1.5);
        O.lean += (lean - O.lean) * Math.min(1, dt * 2); O.flat += (0 - O.flat) * Math.min(1, dt * 3); O.curl += ((crawl ? 0.4 : 0.3) - O.curl) * Math.min(1, dt * 3);
        octSkin(O, dt, 0, crawl ? 0.08 : 0.05 + ds * 0.4 + 0.07 * Math.sin(g_octT * 0.3 + O.i), crawl ? 0.5 : dist < 14 ? 0.98 : 0.85, crawl ? 0.55 : dist < 14 ? 0.5 : 0.8, 1.6);
        O.wigAmp += ((crawl ? 0.05 : 0.035) - O.wigAmp) * Math.min(1, dt * 2);
        if (crawl || dist >= 14) O.curious = false;
        if (O.vis) octCrawlArms(O, dt, crawl ? 0.12 : 0);
        if (!crawl && O.t > O.restT && dist > 12 && octPickWp(O)) { octState(O, OS.CRAWL); }
      }
      break;
    }
    case OS.ALARM: {
      const t = O.t; octStick(O, dt, 0.13);
      octTurn(O, dt, O.perchN[0], O.perchN[1], O.perchN[2], dx, 0, dz, 6); 
      O.lean += (0.1 - O.lean) * Math.min(1, dt * 10); O.curl += (0.3 - O.curl) * Math.min(1, dt * 6); O.wigAmp = 0.03;
      if (t < 0.14) octSkin(O, dt, 1, 0, 1, 0.3, 4, 16);
      else if (t < 0.5) octSkin(O, dt, 0.0, 1, 1, 0.3, 4, 18);
      else octSkin(O, dt, 0.9, 0.0, 0.2, 0.3, 4, 16);
      octArms(O, dt, true, 12, 0, 0, 0, 0.34 * O.scale, 0, 0.26 * O.scale);
      if (t >= 0.55) {
        let ex = O.front[0] - P[0], ey = O.front[1] - P[1], ez = O.front[2] - P[2]; const el = octLen(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
        // not straight at the intruder: if the den is that way, break off to the side
        octState(O, OS.JET); O.jetT = 0; O.jetN = -1; O.inkT = 0; V[0] = ex * 0.6; V[1] = ey * 0.6 + 0.35; V[2] = ez * 0.6; octInkBurst(O, ex, ey, ez);
        if (O.sand > 0.2) for (let k = 0; k < 5; k++) lauvEmit(P[0] + O.ox + octRn() * 0.3 - 0.15, P[1] - 0.04, P[2] + O.oz + octRn() * 0.3 - 0.15, 0.2 + octRn() * 0.15, 1, -ex * 0.4 + octRn() * 0.2 - 0.1, 0.1 + octRn() * 0.15, -ez * 0.4 + octRn() * 0.2 - 0.1, 3.5, 1);
      }
      break;
    }
    case OS.JET: {
      O.jetT += dt; const per = 0.8, n = Math.floor(O.jetT / per);
      let vs = octLen(V[0], V[1], V[2]), vx = vs > 0.05 ? V[0] / vs : A[0], vy = vs > 0.05 ? V[1] / vs : A[1], vz = vs > 0.05 ? V[2] / vs : A[2];
      if (n > O.jetN) { O.jetN = n; vs = Math.min(vs + 1.8, 2.5); O.pulse = 1; }
      O.pulse = Math.max(O.pulse, 1 - (O.jetT % per) / per * 2.4);
      let ex = O.front[0] - P[0], ey = O.front[1] - P[1], ez = O.front[2] - P[2]; const el = octLen(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
      const k = Math.min(1, dt * 3); vx += (ex - vx) * k; vy += (ey - vy) * k; vz += (ez - vz) * k;
      const d = octN(P[0] + vx * 0.5, P[1] + vy * 0.5, P[2] + vz * 0.5);
      if (d > -0.25 && d < 0.97) { const f = (d + 0.25) * 3; vx += _on[0] * f; vy += _on[1] * f; vz += _on[2] * f; }
      const vl = octLen(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
      vs *= Math.exp(-dt * 2); V[0] = vx * vs; V[1] = vy * vs; V[2] = vz * vs;
      P[0] += V[0] * dt; P[1] += V[1] * dt; P[2] += V[2] * dt;
      const d2 = octN(P[0], P[1], P[2]); if (d2 > -0.12 && d2 < 0.97) { const p = d2 + 0.12; P[0] += _on[0] * p; P[1] += _on[1] * p; P[2] += _on[2] * p; }
      octTurn(O, dt, vx, vy, vz, 0, 1, 0, 8); O.lean += (0 - O.lean) * Math.min(1, dt * 6); O.flat += (0 - O.flat) * Math.min(1, dt * 6); O.curl += (0.05 - O.curl) * Math.min(1, dt * 4); O.wigAmp = 0.02;
      octSkin(O, dt, 0.78, 0.18 * (0.5 + 0.5 * Math.sin(O.jetT * 26)), 0.05, 0.3, 6);
      octArms(O, dt, true, 7, -vx, -vy, -vz, 0.05 * O.scale, 0.66 * O.alen[0] * O.scale, 0);
      O.inkT -= dt; if (O.inkT < 0 && O.jetT < 2.4) { O.inkT = 0.17; octInkAdd(P[0] - vx * 0.25 + octRn() * 0.1, P[1] - vy * 0.25 + octRn() * 0.1, P[2] - vz * 0.25 + octRn() * 0.1, -vx * 0.1, 0.02, -vz * 0.1, 0.09 + 0.05 * octRn(), 8 + 3 * octRn(), 0.7); }
      if (el < 0.7 || O.jetT > 9) { octState(O, OS.ENTER); }
      break;
    }
    case OS.ENTER: case OS.EXIT: {
      const enter = O.state === OS.ENTER; let tx, ty, tz, sp = enter ? 0.6 : 0.45, margin = 0.1;
      if (enter) { if (O.pathI === 0 && octLen(O.front[0] - P[0], O.front[1] - P[1], O.front[2] - P[2]) > 0.5) { tx = O.front[0]; ty = O.front[1]; tz = O.front[2]; margin = 0.2; } else { O.pathI = 1; tx = O.den[0]; ty = O.den[1]; tz = O.den[2]; margin = 0.05; } }
      else { if (O.pathI === 0) { tx = O.front[0]; ty = O.front[1]; tz = O.front[2]; margin = 0.05; } else { tx = O.perch[0] + O.perchN[0] * 0.3; ty = O.perch[1] + O.perchN[1] * 0.3; tz = O.perch[2] + O.perchN[2] * 0.3; margin = 0.2; } }
      const left = octSwim(O, dt, tx, ty, tz, sp, margin), vs = octLen(V[0], V[1], V[2]), vx = vs > 0.02 ? V[0] / vs : -A[0], vy = vs > 0.02 ? V[1] / vs : -A[1], vz = vs > 0.02 ? V[2] / vs : -A[2];
      octTurn(O, dt, -vx, -vy, -vz, 0, 1, 0, 3); O.lean += (0 - O.lean) * Math.min(1, dt * 4); O.flat += (0.35 - O.flat) * Math.min(1, dt * 3); O.curl += (0.7 - O.curl) * Math.min(1, dt * 3); O.wigAmp = 0.015;
      octSkin(O, dt, 0, 0.12, 0.7, 0.8, 2.5);
      octArms(O, dt, true, 8, vx, vy, vz, 0.07 * O.scale, 0.3 * O.scale, 0);
      if (enter) { if (O.pathI === 1 && left < 0.1) { octState(O, OS.HIDE); O.hideT = 16 + octRn() * 12; } }
      else {
        if (O.pathI === 0 && left < 0.25) O.pathI = 1;
        if (O.pathI === 1 && left < 0.45) { octState(O, OS.REST); O.restT = 10 + octRn() * 10; O.pl.fill(0); V.fill(0); }
      }
      break;
    }
    case OS.HIDE: case OS.PEEK: {
      const peek = O.state === OS.PEEK, k = peek ? 0.4 : 0.12;
      const tx = O.den[0] + O.dout[0] * k, ty = O.den[1] + O.dout[1] * k, tz = O.den[2] + O.dout[2] * k;
      octSwim(O, dt, tx, ty, tz, 0.25, 0.04);
      const up = Math.abs(O.dout[1]) < 0.9;
      octTurn(O, dt, -O.dout[0], -O.dout[1], -O.dout[2], up ? 0 : 1, up ? 1 : 0, 0, 3); O.lean += (0.2 - O.lean) * Math.min(1, dt * 4); O.flat += (0.38 - O.flat) * Math.min(1, dt * 3); O.curl += (0.9 - O.curl) * Math.min(1, dt * 3); O.wigAmp = 0.01;
      octSkin(O, dt, 0, 0.22, 0.9, 0.7, 1.5);
      octArms(O, dt, true, 6, -O.dout[0], -O.dout[1], -O.dout[2], (peek ? 0.12 : 0.09) * O.scale, 0.05, 0);
      if (!peek && O.t > O.hideT && dist > 7) octState(O, OS.PEEK);
      else if (peek && O.t > 9 && dist > 10) { octState(O, OS.EXIT); }
      break;
    }
  }
}

// ---------------------------------------------------------------- registration
FAUNA.push({
  name: 'octopus',
  async init() {
    const m = mod(W_OCTO);
    const vbl = { arrayStride: 32, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4'), A(2, 16, 'float32x2'), A(3, 24, 'unorm8x4'), A(4, 28, 'unorm8x4')] };
    const ibl = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
    const idx = octStaticIdx();
    octG.gpu = {
      pOct: scenePipe(m, 'vs', 'fs', [vbl]),
      pInk: scenePipe(m, 'vsInk', 'fsInk', [ibl], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }),
      vb: device.createBuffer({ size: OCT_N * OCT_VPO * 32, usage: BU.VERTEX | BU.COPY_DST }), ib: buf(idx, BU.INDEX), nIdx: idx.length,
      vbInk: device.createBuffer({ size: OCT_MAXINK * 32, usage: BU.VERTEX | BU.COPY_DST }),
    };
  },
  update(dt) {
    const G = octG; if (!G.gpu) return;
    if (!G.ready) { if (G.scanN < 120000) octScanStep(3000); else octChoose(); return; }
    const t0 = performance.now();
    g_octT += dt;
    if (G.follow) { const q = G.follow, O = octO[q.i], a = q.az + (q.abs ? 0 : Math.atan2(O.F[0], O.F[2])), c = Math.cos(q.el); lookAt(O.P[0] + Math.sin(a) * c * q.dist + O.ox, O.P[1] + Math.sin(q.el) * q.dist + (q.dy || 0.1), O.P[2] + Math.cos(a) * c * q.dist + O.oz, O.P[0] + O.ox, O.P[1] + (q.dy || 0.1), O.P[2] + O.oz); }
    else if (G.cam) lookAt(...G.cam);   // test: a fixed camera (set before the cameras of other pieces: update runs after lauvFrame)
    const cx = F[CX], cy = F[CY], cz = F[CZ];
    for (const O of octO) {
      const rx = wrapD(O.P[0] - cx), rz = wrapD(O.P[2] - cz);
      O.ox = cx + rx - O.P[0]; O.oz = cz + rz - O.P[2]; O.camD = octLen(rx, O.P[1] - cy, rz);
      O.vis = O.camD < OCT_SEE; O.near = O.camD < 30;
    }
    if (dt > 0) { const n = Math.ceil(dt / (1 / 40)), h = dt / n; for (let s = 0; s < n; s++) { for (const O of octO) octStep(O, h); octInkStep(h); } }
    let slot = 0;
    for (const O of octO) {
      if (!O.vis) continue;
      O.slot = slot++; octBuild(O, O.ox, 0, O.oz);
      Q.writeBuffer(G.gpu.vb, O.slot * OCT_VPO * 32, octAB, 0, OCT_VPO * 32);
    }
    G.drawn = slot;
    if (octInk.n) Q.writeBuffer(G.gpu.vbInk, 0, octInk.p.buffer, 0, octInk.n * 32);
    G.ms = performance.now() - t0;
  },
  late() {},
  draw(r) {
    const G = octG, g = G.gpu; if (!g || !G.ready) return;
    useTile(r, 4);
    if (G.drawn) { r.setPipeline(g.pOct); r.setVertexBuffer(0, g.vb); r.setIndexBuffer(g.ib, 'uint16'); for (let s = 0; s < G.drawn; s++) r.drawIndexed(g.nIdx, 1, 0, s * OCT_VPO); }
    if (octInk.n) { r.setPipeline(g.pInk); r.setVertexBuffer(0, g.vbInk); r.draw(4, octInk.n); }
  },
});
// test hooks: __octo.list(), __octo.scare(i), __octo.goto(i, state)
window.__octo = {
  get ready() { return octG.ready; },
  list: () => octO.map((O) => ({ i: O.i, state: O.state, t: +O.t.toFixed(2), P: Array.from(O.P), den: Array.from(O.den), front: Array.from(O.front), perch: Array.from(O.perch), dout: Array.from(O.dout), dist: +O.lastD.toFixed(1), sand: O.sand })),
  crawl(i) { const O = octO[i]; if (O && O.state === OS.REST && octPickWp(O)) octState(O, OS.CRAWL); return O.wp.join(); },
  state(i) { return octO[i].state; },
  scare(i) { const O = octO[i]; if (O && O.state <= OS.CRAWL) { octState(O, OS.ALARM); O.pl.fill(0); O.stepT.fill(-1); } },
  noscare: false,
  follow(i, dist, az, el, abs, dy) { octG.follow = i === undefined ? null : { i, dist, az, el, abs, dy }; },
  cam(x, y, z, tx, ty, tz) { octG.cam = x === undefined ? null : [x, y, z, tx, ty, tz]; },
  // dev: camera looking at octopus i from dist metres, az radians around it (0 = from the den side), el above the horizon
  view(i, dist, az, el, dy = 0.12) { const O = octO[i], a = az + Math.atan2(O.F[0], O.F[2]); const c = Math.cos(el); octG.cam = [O.P[0] + Math.sin(a) * c * dist, O.P[1] + Math.sin(el) * dist + dy, O.P[2] + Math.cos(a) * c * dist, O.P[0], O.P[1] + dy, O.P[2]]; },
  // advance only the octopuses and the ink by sec (clips skip the waiting in the den)
  warp(sec) { const n = Math.ceil(sec / (1 / 40)), h = sec / n; for (let s = 0; s < n; s++) { for (const O of octO) octStep(O, h); octInkStep(h); } g_octT += sec; },
  inkPos: () => Array.from(octInk.p.subarray(0, Math.min(octInk.n, 4) * 8)),
  ms: () => octG.ms, dbgBody() { const o = []; for (let k = 2; k < OCT_NRB - 2; k += 3) for (const j of [0, 4, 8, 12]) { const vi = OCT_VA + k * OCT_BR + j, b = vi * 32, c = k * 12; const px = octF[vi * 8] - octSp[c], py = octF[vi * 8 + 1] - octSp[c + 1], pz = octF[vi * 8 + 2] - octSp[c + 2]; o.push([k, j, +(px * octI[b + 12] + py * octI[b + 13] + pz * octI[b + 14]).toFixed(1), +Math.hypot(px, py, pz).toFixed(3)]); } return o; }, ink: () => octInk.n, o: octO,
  // dev: put the vehicle k metres from octopus i, on its perch side, looking at it
  approach(i, k, h) { const O = octO[i]; const a = Math.atan2(O.front[0] - O.P[0], -(O.front[2] - O.P[2])); const px = O.P[0] - Math.sin(a) * k, pz = O.P[2] + Math.cos(a) * k; lauvPlace(px, O.P[1] + (h || 1), pz, a, 0); },
};
