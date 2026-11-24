// ============================================================================
// WGSL sources
// ============================================================================

const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- terrain density (compute)
// Everything here wraps every PER metres in x and z (the world is a torus): noise lattices hold a whole number of
// cells per tile, shapes are measured to their nearest image.
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> MP: array<vec4f>;
const PER = ${PER}.;
const GB = -19.;
fn wr(a: f32) -> f32 { return a - PER * round(a / PER); }
fn wr2(a: vec2f) -> vec2f { return a - PER * round(a / PER); }
fn mw(a: f32, per: f32) -> f32 { return a - per * floor(a / per); }
fn nper(f: f32) -> f32 { return max(round(PER * f), 1.); }
fn npos(p: vec3f, f: f32) -> vec3f { let n = nper(f) / PER; return vec3f(p.x * n, p.y * f, p.z * n); }
fn vnp(p: vec3f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  let x0 = mw(i.x, per); let x1 = mw(i.x + 1., per); let z0 = mw(i.z, per); let z1 = mw(i.z + 1., per);
  return mix(mix(mix(h31(vec3f(x0, i.y, z0)), h31(vec3f(x1, i.y, z0)), u.x), mix(h31(vec3f(x0, i.y + 1., z0)), h31(vec3f(x1, i.y + 1., z0)), u.x), u.y),
             mix(mix(h31(vec3f(x0, i.y, z1)), h31(vec3f(x1, i.y, z1)), u.x), mix(h31(vec3f(x0, i.y + 1., z1)), h31(vec3f(x1, i.y + 1., z1)), u.x), u.y), u.z);
}
// periodic fbm of the world position p at base frequency f (1/m), n octaves, y offset s
fn fbp(p: vec3f, f: f32, n: i32, s: f32) -> f32 {
  var q = npos(p, f); q.y += s; var per = nper(f); var a = .5; var t = 0.;
  for (var i = 0; i < n; i++) { t += a * vnp(q, per); q = q * 2. + vec3f(17.1, 31.7, 5.3); per *= 2.; a *= .5; }
  return t / (1. - 2. * a);
}
fn worp(p: vec3f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let c = i + o; let r = o + h33(vec3f(mw(c.x, per), c.y, mw(c.z, per))) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = wr2(p - a); let ba = wr2(b - a); let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 {
  let pa = vec3f(wr(p.x - a.x), p.y - a.y, wr(p.z - a.z)); let ba = vec3f(wr(b.x - a.x), b.y - a.y, wr(b.z - a.z));
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h);
}
fn warp(p: vec3f) -> vec3f { return vec3f(fbp(p, .04, 3, 11.), fbp(p, .04, 3, 47.), fbp(p, .04, 3, 83.)) - .5; }
// sea floor height under the warped position q
fn floorY(q: vec3f) -> f32 {
  // LOOK: + sand dunes (~11 m crests, a whole number of waves per tile) in fields that come and go
  let dph = TAUW * (28. * q.x + 19. * q.z) / PER + 5. * fbp(vec3f(q.x, 0., q.z), .02, 2, 31.);
  let dune = (sin(dph) + .35 * sin(2. * dph + 1.3)) * .42 * ss(.42, .62, fbp(vec3f(q.x, 0., q.z), .012, 2, 37.));
  return GB + 14. * (fbp(vec3f(q.x, 0., q.z), .009, 4, 3.) - .5) + 2.6 * (fbp(vec3f(q.x, 0., q.z), .035, 3, 9.) - .5) + dune;
}
const TAUW = 6.2831853;
// how sandy the ground is at q.xz: 1 on the flats, 0 where reef rock comes through
fn sandAmt(q: vec3f) -> f32 { return 1. - ss(.44, .58, fbp(vec3f(q.x, 0., q.z), .02, 3, 21.)); }
fn dens(p: vec3f) -> f32 {
  let w = warp(p);
  let q = p + w * vec3f(15., 6., 15.);
  let g0 = floorY(q);
  let tn = 3. * (fbp(vec3f(q.x, 0., q.z), .09, 3, 2.) - .5);
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u];
    clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x));
  }
  let n = fbp(vec3f(q.x, 0., q.z), .0125, 4, 1.7);
  let plat = ss(.56, .625, n) * (1. - clr);
  let th = g0 + plat * (10. + 8. * fbp(vec3f(q.x, 0., q.z), .03, 2, 5.));
  var d = smax(g0 + 4.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz; r.x = wr(r.x); r.z = wr(r.z);
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  let hg = p.y - g0;
  // sand flats stay smooth, reef rock craggy
  let rock = 1. - sandAmt(q) * ss(1., 6., de) * ss(3., .4, plat * 6.);
  let rk = mix(mix(.05, .25, rock), 1., ss(.5, 5., hg) * mix(.35, 1., rock));
  // LOOK: rock at several scales: big forms (~20 m), fewer same-size lumps, beds and thin ledges (strata), vertical cracks
  d += rk * ((.5 - worp(npos(p, .17) + w * 2., nper(.17))) * 1.9 + (.5 - worp(npos(p, .41) + 7., nper(.41))) * .8 + (fbp(p, .3, 3, 0.) - .5) * 1.8);
  d += rk * (fbp(p, .05, 2, 13.) - .5) * 4.;
  d += rk * 2.2 * (abs(fract(p.y * .21 + w.y * 2.2) - .5) - .25) * rock;
  d += rk * .9 * (abs(fract(p.y * .62 + w.y * 3.1 + fbp(p, .08, 2, 41.) * .8) - .5) - .25) * rock * ss(1., 3., hg);
  let ck = ss(.035, 0., abs(fbp(vec3f(p.x, p.y * .12, p.z), .045, 3, 21.) - .5));
  d -= rk * 1.7 * ck * rock * ss(1., 4., hg);
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  return min(d, 3. - p.y);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.y == u.n.y - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
// ground map: r sand, g floor height, b reef noise, a distance to the nearest reef rock
@compute @workgroup_size(8, 8) fn mapMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u.n.x || id.y >= u.n.z) { return; }
  let xz = vec2f(u.o.x + f32(id.x) * u.o.w, u.o.z + f32(id.y) * u.o.w);
  let p = vec3f(xz.x, GB, xz.y);
  let w = warp(p); let q = p + w * vec3f(15., 6., 15.);
  var de = 1e3;
  for (var i = 0u; i < u.c.x; i++) { let a = P[i * 2u]; let b = P[i * 2u + 1u]; de = min(de, seg2(q.xz, a.xy, a.zw) - b.x - 3.); }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) { let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u]; clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x)); }
  let n = fbp(vec3f(q.x, 0., q.z), .0125, 4, 1.7);
  let plat = ss(.56, .625, n) * (1. - clr);
  MP[id.x + u.n.x * id.y] = vec4f(sandAmt(q) * ss(2., 7., de) * (1. - ss(.2, .6, plat)), floorY(q), plat, de);
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// rock detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// animated water texture: r = caustic, ba = surface slope
const W_WATER = W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
fn caus(uv: vec2f, t: f32) -> f32 {
  let p = uv * 6.2831853;
  var i = p; var c = 0.;
  for (var n = 1; n <= 5; n++) {
    let tt = t * (1. - 3.5 / f32(n));
    i = p + vec2f(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    let s = sin(i.x + tt); let k = cos(i.y + tt);
    c += abs(s * k) / (1.25 * sqrt(s * s + k * k) + 1e-4);
  }
  c = 1.17 - pow(c / 5., 1.4);
  return pow(abs(c), 8.);
}
const WK = array<vec3f, 10>(vec3f(1., 2., 1.), vec3f(-2., 1., .9), vec3f(3., 1., .6), vec3f(1., -4., .5), vec3f(4., 3., .4),
  vec3f(-3., 5., .32), vec3f(6., -2., .28), vec3f(5., 7., .2), vec3f(-8., 3., .18), vec3f(2., 11., .14));
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / ${WATER}.; let t = tm.x;
  let c = caus(uv, t * .45 + 23.);
  let wu = uv + .02 * vec2f(sin(6.2831853 * (uv.y * 2. + .1 * t)), cos(6.2831853 * (uv.x * 3. - .07 * t)));
  var s = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let k = WK[i];
    s += k.xy * k.z * cos(dot(k.xy, wu) * 6.2831853 + t * (.5 + .35 * sqrt(length(k.xy))) * select(-1., 1., (i & 1) == 0) + f32(i) * 1.7);
  }
  return vec4f(c, c, s * .06);
}
`;

// ---------------------------------------------------------------- shared scene code
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f, va: vec4f, vb: vec4f };
const SIG = vec3f(.060, .030, .0225);
const KD = vec3f(.056, .0245, .0170);
const WCOL = vec3f(.08, .46, .90);
const KDZ = vec3f(.034, .023, .018);
const PCOL = vec3f(.58, .66, .98);
const SUNC = vec3f(2.5, 2.25, 1.9);
const TAU = 6.2831853;
const LOW = ${LV > 1};
const FASTSH = ${FASTSH};
const PER = ${PER}.;
// the world repeats every PER metres in x and z: nearest image of a difference, a position moved into the base tile,
// and a texture coordinate scaled so that a whole number of repeats fits in a tile (patterns then match across the seam)
fn wr(a: f32) -> f32 { return a - PER * round(a / PER); }
fn wd(v: vec3f) -> vec3f { return vec3f(wr(v.x), v.y, wr(v.z)); }
fn wt(p: vec3f) -> vec3f { return vec3f(wr(p.x), p.y, wr(p.z)); }
fn pu(q: vec2f, sc: f32) -> vec2f { return q * (round(PER / sc) / PER); }
fn pk(sc: f32) -> f32 { return round(PER * sc) / PER; }
// apparent position of what lies under the water when the camera is in the air (g.mis.w: 0 under water, 1 well above it):
// refraction makes it look about 1/1.33 as deep
fn proj(w: vec3f) -> vec4f {
  var q = w;
  if (q.y < 0.) { q.y *= 1. - .22 * g.mis.w; }
  return g.vp * vec4f(q, 1.);
}
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn kd(z: f32) -> vec3f { return mix(KD, KDZ, z); }
fn sg(z: f32) -> vec3f { return mix(SIG, vec3f(.034, .026, .022), z); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
const KDF = vec3f(.043, .045, .042);
// ---- LOOK: water column -------------------------------------------------------------------------------------
// Beam extinction per metre (red goes first, so things turn blue-green with distance), and the radiance of an
// infinitely long ray (the water colour) by direction: bright under the surface, mid blue level, dark below,
// with a forward-scattering glow round the sun; it dims with depth (WKD). Every ray (terrain, surface, background,
// sprites) is fogged with the same wFog, so the horizon has no seam.
const WEXT = vec3f(.066, .041, .034); // LOOK round 3: more falloff with distance
const WHOR = vec3f(.018, .115, .40);
const WUPC = vec3f(.26, .85, 2.2);
const WDNC = vec3f(.006, .045, .17);
const WKD = vec3f(.06, .03, .022);
fn wInf(y: f32, rd: vec3f, sun: vec3f) -> vec3f {
  let u = rd.y;
  var c = mix(WHOR, WDNC, ss(0., -.75, u));
  c = mix(c, WUPC, ss(-.02, .95, u) * ss(-.02, .95, u));
  let mu = max(dot(rd, sun), 0.);
  let m4 = mu * mu * mu * mu;
  c += vec3f(.55, .85, .80) * (m4 * m4 * .9 + m4 * .25);
  return c * exp(WKD * min(y, 0.));
}
// LOOK round 4: the first ~10 m of water stay clear, the fade builds beyond (effective distance d^2 / (d + 12))
fn wT(d: f32) -> vec3f { return exp(-WEXT * (d * d / (d + 12.))); }
// the depth the in-scattered light of a ray is taken at: a few attenuation lengths along it (continuous at the horizon)
fn wY(ro: vec3f, rd: vec3f, d: f32) -> f32 { return min(ro.y + rd.y * min(d, 22.) * .5, 0.); }
fn wFog(c: vec3f, ro: vec3f, rd: vec3f, d: f32, sun: vec3f) -> vec3f {
  let T = wT(d);
  return c * T + wInf(wY(ro, rd, d), rd, sun) * (1. - T);
}
// in-scattered light over d metres (what the base code's sprites add to their colour)
fn fogIn(ro: vec3f, rd: vec3f, d: f32, z: f32, sun: vec3f) -> vec3f { return wInf(wY(ro, rd, d), rd, sun) * (1. - wT(d)); }
// ---- end LOOK water column
`;

const S_B = /*wgsl*/`diagnostic(off, derivative_uniformity);` + S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
// detail texture read with a negative LOD bias under TAA: the sub-pixel jitter averages samples, so the textures would otherwise come out blurrier than MSAA's
fn sD(uv: vec2f) -> vec4f { return textureSampleBias(tD, sR, uv, ${TAA ? -.7 : 0}); }
@group(1) @binding(0) var<uniform> tl: vec4f; // offset of the tile copy being drawn
fn shUV(pw: vec3f) -> vec3f { let s = g.sm * vec4f(wt(pw), 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow4(p: vec3f) -> f32 {
  let s = shUV(p); let e = 1.8 / ${SHADOW}.;
  return (textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, -e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, -e), s.z)
        + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(-e, e), s.z) + textureSampleCompareLevel(tSh, sS, s.xy + vec2f(e, e), s.z)) * .25;
}
fn shadow9(p: vec3f, d: f32) -> f32 {
  // 9 taps within 16 m, 4 to 70 m, one beyond: what the far taps would soften can't be seen there
  if (LOW || d > 70.) { return shadow1(p); }
  if (FASTSH || d > 16.) { return shadow4(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
// ---- LOOK: soft sun shadows (PCSS): a blocker search, then a rotated Poisson filter whose radius grows with the
// distance to the blocker (sunlight under waves is a wide, wobbling source): sharp at contact, soft far from it
const PD = array<vec2f, 12>(vec2f(-.326, -.406), vec2f(-.840, -.074), vec2f(-.696, .457), vec2f(-.203, .621), vec2f(.962, -.195), vec2f(.473, -.480),
  vec2f(.519, .767), vec2f(.185, -.893), vec2f(.507, .064), vec2f(.896, .412), vec2f(-.322, -.933), vec2f(-.792, -.598));
fn shadowS(p: vec3f, fc: vec2f, dd: f32) -> f32 {
  if (LOW || FASTSH || dd > 45.) { return shadow9(p, dd); }
  let s = shUV(p); let tx = 1. / ${SHADOW}.;
  let a = ign(fc) * TAU; let cs = vec2f(cos(a), sin(a));
  var bd = 0.; var bn = 0.;
  for (var k = 0; k < 6; k++) {
    let o = PD[k * 2]; let q = s.xy + vec2f(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x) * 9. * tx;
    let d = textureLoad(tSh, vec2i(clamp(q, vec2f(0.), vec2f(.9999)) * ${SHADOW}.), 0);
    if (d < s.z) { bd += d; bn += 1.; }
  }
  if (bn < .5) { return 1.; }
  let dz = max(s.z - bd / bn, 0.) * 300.;
  let rad = clamp(dz * .045 * ${SHADOW}. / 450., 1.2, 16.) * tx;
  var v = 0.;
  for (var k = 0; k < 12; k++) {
    let o = PD[k]; v += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x) * rad, s.z);
  }
  return v / 12.;
}
// ---- end LOOK soft shadows
// the LAUV's shadow on the terrain: its axis (va.xyz tail, vb.xyz nose, va.w radius) as a soft capsule along the sun direction
fn vehSh(p: vec3f) -> f32 {
  let L = g.sun.xyz; let a = wd(g.va.xyz - p); let b = wd(g.vb.xyz - p);
  let ta = dot(a, L); let tb = dot(b, L);
  if (max(ta, tb) < 0.) { return 1.; }
  let pa = a - L * ta; let pb = b - L * tb; let ba = pb - pa;
  let h = clamp(-dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
  let d = length(pa + ba * h); let t = max(mix(ta, tb, h), 0.);
  let r = g.va.w;
  return 1. - .8 * (1. - ss(r * .55, r * 1.1 + .012 * t, d)) * ss(14., 6., t);
}
fn cuv(p: vec3f) -> vec2f { return p.xz - g.sun.xz * (p.y / g.sun.y); }
fn caus(p: vec3f, d: f32) -> vec3f {
  if (d > 100.) { return vec3f(.33); } // the mix below is 100% flat from here: skip the 4 texture reads
  let q = cuv(p);
  let o = vec2f(.004, .0025);
  let q1 = pu(q, 2.6); // LOOK: caustic cells a few dm across, as in a few metres of water (3.3 m cells read as dark blobs)
  let a = vec3f(textureSample(tW, sR, q1 + o).r, textureSample(tW, sR, q1).r, textureSample(tW, sR, q1 - o).r);
  let b = textureSample(tW, sR, pu(q.yx, 6.9) + .37).r;
  // LOOK: only the line cores lit (the pattern is ~0.3 in the cells, ~0.9 median, ~2.5 on the brightest lines), less
  // large-scale modulation
  let c = smoothstep(vec3f(.9), vec3f(2.6), a) * 2.4 * (.75 + b * .5);
  return mix(c, vec3f(.3), ss(50., 140., d));
}
fn caus2(p: vec3f, d: f32) -> f32 {
  if (d > 100.) { return .33; }
  let q = cuv(p);
  let c = min(pow(textureSample(tW, sR, pu(q, 4.1)).r, 1.4) * 2.6 * (.45 + textureSample(tW, sR, pu(q.yx, 6.9) + .37).r * 1.3), 2.6);
  return mix(c, .33, ss(35., 100., d));
}
fn sunE(y: f32, z: f32) -> vec3f { return SUNC * exp(kd(z) * (min(y, 0.) / g.sun.y)) * (.5 + .5 * sat(-y / 30.)); }
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(${OX}., ${OY}., ${OZ}.)) / vec3f(PER, ${NY * VS}, PER), 0.); }
fn amb(p: vec3f, n: vec3f, sky: f32, z: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(vec3f(.24, .48, .54), vec3f(.34, .56, .82), z) * exp(kd(z) * min(p.y, 0.) * 1.2) * (.5 + .5 * sky) * (.32 + .68 * up * up) * (.55 + .45 * sat(-p.y / 30.)) + vec3f(.003, .010, .016);
}
fn zone(p: vec3f) -> f32 { return g.sun.w; }
fn side(p: vec3f, n: vec3f, open: f32, z: f32) -> vec3f { return mix(WCOL, PCOL, z) * exp(kd(z) * min(p.y, 0.)) * (.25 + .75 * open) * (1. - abs(n.y)) * .8; } // LOOK: more side fill (dark walls)
// skylight at most 150 m along the ray: past that, terrain and the background behind it (vsB) get the same haze
// LOOK: one water column for everything (wFog); in-scatter a little dimmer where the ray ends under overhangs
fn fog(c: vec3f, wp: vec3f, z: f32) -> vec3f {
  var ro = g.cam.xyz; let v = wp - ro; var d = length(v); let rd = v / d;
  if (ro.y > 0.) {   // the camera is in the air: the water starts where the ray crosses the surface (surface.js)
    if (wp.y >= 0.) { return c; }
    let t0 = min(ro.y / max(-rd.y, 1e-4), d); ro += rd * t0; d -= t0;
  }
  let T = wT(d) * ss(235., 190., d);
  return c * T + wInf(wY(ro, rd, d), rd, g.sun.xyz) * (1. - T) * (.78 + .22 * vol(ro + rd * min(d, 150.)).g);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- LOOK: scanned CC0 material textures (look.js loads them)
// tAlb: albedo (sRGB) and tNh: normal xy + height, 8 layers: 0 seaside rock, 1 rock face, 2 pitted mossy rock,
// 3 tiger rock, 4 cracked boulder, 5 sand, 6 coral ground (crust + turf), 7 coral gravel. LG: per-layer albedo gain
// that brings each scan to a plausible reflectance.
const S_PBR = /*wgsl*/`
@group(0) @binding(9) var tAlb: texture_2d_array<f32>;
@group(0) @binding(10) var tNh: texture_2d_array<f32>;
const GSH = ${TAA ? .62 : 1}; // with TAA the textures are sampled a little sharper (as sD does)
var<private> LG: array<f32, 8> = array<f32, 8>(1.7, .85, .42, 1.25, .45, 1.9, .95, 1.05);
struct PB { alb: vec3f, n: vec3f, h: f32 };
// triplanar (planes with ~no weight skipped), normals as world-axis perturbations (UDN blend)
fn tpl(p: vec3f, dx0: vec3f, dy0: vec3f, w: vec3f, s: f32, L: i32) -> PB {
  let dx = dx0 * GSH; let dy = dy0 * GSH;
  var o: PB; o.alb = vec3f(0.); o.n = vec3f(0.); o.h = 0.;
  if (w.x > .03) {
    let uv = p.zy * s; let a = textureSampleGrad(tAlb, sR, uv, L, dx.zy * s, dy.zy * s); let b = textureSampleGrad(tNh, sR, uv, L, dx.zy * s, dy.zy * s);
    let t = b.xy * 2. - 1.; o.alb += a.rgb * w.x; o.h += b.z * w.x; o.n += vec3f(0., -t.y, t.x) * w.x;
  }
  if (w.y > .03) {
    let uv = p.xz * s; let a = textureSampleGrad(tAlb, sR, uv, L, dx.xz * s, dy.xz * s); let b = textureSampleGrad(tNh, sR, uv, L, dx.xz * s, dy.xz * s);
    let t = b.xy * 2. - 1.; o.alb += a.rgb * w.y; o.h += b.z * w.y; o.n += vec3f(t.x, 0., -t.y) * w.y;
  }
  if (w.z > .03) {
    let uv = p.xy * s; let a = textureSampleGrad(tAlb, sR, uv, L, dx.xy * s, dy.xy * s); let b = textureSampleGrad(tNh, sR, uv, L, dx.xy * s, dy.xy * s);
    let t = b.xy * 2. - 1.; o.alb += a.rgb * w.z; o.h += b.z * w.z; o.n += vec3f(t.x, -t.y, 0.) * w.z;
  }
  let ws = 1. / (w.x * f32(w.x > .03) + w.y * f32(w.y > .03) + w.z * f32(w.z > .03));
  o.alb *= ws; o.h *= ws; o.n *= ws;
  return o;
}
`;

// ---------------------------------------------------------------- solid meshes (terrain, rocks, set pieces, sponges, coral)
const W_SOLID = S_B + S_PBR + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @invariant @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  let base = i.a.xyz + tl.xyz;
  if (i.c.x < 1.5 && i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(base, g.cam.xyz) / g.mis.z); }
  var w = base + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = proj(w); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = sD(p.zy * s); let y = sD(p.xz * s); let z = sD(p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let ts = select(1., i.m.z, mat >= 2);
  // texture scales are snapped so a whole number of repeats fits in a tile: the terrain's detail matches across the seam
  // the fine layers only where they show: C (1.9/m) fades out by 60 m and is neutral past 130 m, F (6.7/m) is for the last 10 m
  let A = tri(i.op, on, pk(.1) * ts); let B = tri(i.op, on, pk(.43) * ts);
  var C = TP(.5, .5, vec3f(0.)); if (dist < 130.) { C = tri(i.op, on, pk(1.9) * ts); }
  var F = TP(.5, .5, vec3f(0.)); let fk = ss(10., 1.5, dist) * f32(mat <= 1); if (fk > 0.) { F = tri(i.op, on, pk(6.7) * ts); }
  var Wd = vec4f(0.); if (mat == 3) { Wd = sD(vec2f(i.op.x * pk(.06), i.op.y * .7 + i.op.z * pk(.7))); }
  let big = sD(i.op.xz * pk(.013) + i.op.y * .021).a;
  let big2 = sD(i.op.zx * pk(.031) + i.op.y * .043 + .37).a;
  var sgro = 0.;
  var sk = vec4f(0.); var sk2 = vec4f(0.);
  if (mat == 2) { sk = sD(vec2f((i.op.x + i.op.z) * .33, i.op.y * .035)); sk2 = sD(vec2f((i.op.x - i.op.z) * 1.1, i.op.y * .11)); }
  let reg = sD(i.wp.xz * pk(.0035));
  let gm = textureSample(tM, sR, i.wp.xz / PER + .5);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  var bump = 1.7; var gloss = .1; var alb = vec3f(0.); var emi = vec3f(0.); var vao = 1.; var flu = 0.;
  let flt = ss(.72, .93, n0.y);
  var sK = 0.; var rdir = vec2f(0.);
  // LOOK: scanned-texture normals (object space) and how strongly they count; derivatives for textureSampleGrad
  let gdx = dpdx(i.op) * GSH; let gdy = dpdy(i.op) * GSH;
  var tw = pow(abs(on), vec3f(6.)); tw /= (tw.x + tw.y + tw.z);
  var tn = vec3f(0.); var tnk = 0.;
  let near = ss(70., 8., dist);
  if (mat <= 1) {
    // ---- LOOK: rock from scanned CC0 textures (textures/, Poly Haven): two rock types per rock (by seed) or per
    // region (terrain), blended by their height maps; under-water tint; reef growth (encrusting coralline crust and
    // algae turf) on up-facing parts that settles into the hollows first
    // LOOK: on flat sand the rock layers are not sampled at all (sand covers them)
    let sK0 = select(0., ss(.55, .82, n0.y), mat == 0);
    var th = .5;
    if (sK0 < .99) {
      let rs = select(fract(reg.a * 2.3 + reg.b * .7), hs(sd * 17.31), mat == 1);
      let la = select(i32(rs * 4.99), 1, mat == 0);
      let lb = select((la + 1 + i32(hs(sd * 3.7) * 2.99)) % 5, 0, mat == 0);
      let s1 = pk(.52) * ts * mix(.8, 1.25, hs(sd * 5.1)); let s2 = pk(.37) * ts;
      // (a layer whose weight is ~0 is not sampled: most rock is one type or the other)
      let m0 = (big - .5) * 1.5 + (big2 - .5) * .8;
      var ra = PB(vec3f(.5), vec3f(0.), .5); var rb = PB(vec3f(.5), vec3f(0.), .5);
      if (m0 < .47) { ra = tpl(i.op, gdx, gdy, tw, s1, la); }
      if (m0 > -.47) { rb = tpl(i.op.zxy + 13.7, gdx.zxy, gdy.zxy, tw.zxy, s2, lb); }
      let mab = ss(-.12, .12, m0 + (rb.h - ra.h) * .7 * ss(.47, .25, abs(m0))); // continuous where a layer is skipped
      alb = mix(ra.alb * LG[la], rb.alb * LG[lb], mab);
      th = mix(ra.h, rb.h, mab);
      tn = mix(ra.n, rb.n.yzx, mab); tnk = 1.15;
      // per rock / per region: brightness and hue drift, then the grey-olive of rock under water
      let vh = hs(sd * 9.13 + floor(reg.b * 4.));
      alb *= mix(.75, 1.25, vh) * (.8 + .4 * big);
      let gl = dot(alb, vec3f(.3, .59, .11));
      alb = mix(vec3f(gl), alb, .5) * mix(vec3f(1.), vec3f(.86, .97, .84), big2);
      // LOOK: colour bands with height (strata): warm ochre, grey and dark beds
      let bnd = hs(floor(i.wp.y * .45 + big * 2.5) + sd * 3.);
      alb *= mix(mix(vec3f(1.12, .98, .80), vec3f(.86, .9, .95), ss(.3, .45, bnd)), vec3f(.62, .62, .64), ss(.82, .9, bnd));
      // reef growth on top
      let upf = ss(.05, .8, n0.y);
      if (upf > .01) {
        let cg = tpl(i.op + 5.1, gdx, gdy, tw, pk(.7) * ts, 6);
        // (broken up: bare rock in large patches, more growth in hollows than on ridges)
      let gw = ss(.05, .3, upf * (.5 + .9 * big2) - th * .5 + cg.h * .35 - .25) * ss(.3, .55, big2 * .7 + reg.b * .5 + (1. - hgt) * .3);
        alb = mix(alb, cg.alb * LG[6] * vec3f(.85, .95, .78), gw);
        tn = mix(tn, cg.n, gw);
      }
      // a little pink coralline on the sides and green film on the tops (the base's masks, much subtler)
      alb = mix(alb, vec3f(.40, .20, .24) * (.6 + .8 * th), ss(.62, .72, big2 * .6 + C.c * .5) * (1. - ss(.2, .6, n0.y)) * .35);
      alb = mix(alb, vec3f(.10, .17, .07) * (.6 + .8 * th), ss(.35, .65, big * .6 + B.c * .5) * upf * .35);
    }
    vao *= .6 + .4 * ss(.0, .45, th);
    bump = .9; gloss = .08;
    if (mat == 0) {
      // ---- LOOK: sand on the flats: scanned sand at two scales (no visible tiling), coral rubble in patches,
      // ripples across the current, grit and an algae film
      sK = ss(.55, .82, n0.y); // LOOK: the vertex AO (blob-shaped on the flats) no longer mixes dark rock into the sand
      if (sK > .01) {
        let sp = i.op.xz;
        let su1 = sp * pk(.55); let su2 = sp.yx * pk(.17) + .31;
        let sa1 = textureSampleGrad(tAlb, sR, su1, 5, gdx.xz * pk(.55), gdy.xz * pk(.55));
        let sa2 = textureSampleGrad(tAlb, sR, su2, 5, gdx.zx * pk(.17), gdy.zx * pk(.17));
        let sn1 = textureSampleGrad(tNh, sR, su1, 5, gdx.xz * pk(.55), gdy.xz * pk(.55));
        let rub = ss(.52, .64, big2 * .7 + reg.b * .3 + gm.a * .2);
        let ru = sp * pk(.6) + .7;
        let ga = textureSampleGrad(tAlb, sR, ru, 7, gdx.xz * pk(.6), gdy.xz * pk(.6));
        let gn = textureSampleGrad(tNh, sR, ru, 7, gdx.xz * pk(.6), gdy.xz * pk(.6));
        var sand = (sa1.rgb * .6 + sa2.rgb * .4) * LG[5] * vec3f(1.3, 1.12, .86); // LOOK: warm pale sand
        let rw = sat(rub * 1.4 - (1. - gn.z) * .6);
        sand = mix(sand, ga.rgb * LG[7], rw);
        let ph = TAU * (190. * i.wp.x + 140. * i.wp.z) / PER + 3.2 * (big - .5) + 1.4 * (C.c - .5);
        let fade = ss(34., 8., dist);
        let rp = sin(ph) * fade;
        sand *= (1. + .10 * rp * (1. - rw)) * mix(.85, 1.1, big);
        let grit = hs(dot(floor(i.wp * 55.), vec3f(1., 57., 113.))); sand *= 1. + (grit - .5) * .12 * ss(5., 1., dist);
        sand = mix(sand, vec3f(.20, .22, .11), gm.a * .3 * ss(.2, .8, A.c));
        sand *= mix(vec3f(1.), vec3f(1.08, 1.0, .85), ss(.35, .65, big2));
        // LOOK: large-scale cover: silty grey-green patches and clean pale sand (tens of metres)
        let lp = sD(i.wp.xz * pk(.011)).a; let lp2 = sD(i.wp.zx * pk(.023) + .5).a;
        sand = mix(sand, sand * vec3f(.74, .80, .70), ss(.48, .66, lp) * .8);
        sand = mix(sand, sand * vec3f(1.12, 1.1, 1.05), ss(.55, .7, lp2) * .6);
        alb = mix(alb, sand, sK);
        let s1n = sn1.xy * 2. - 1.; let g1n = gn.xy * 2. - 1.;
        tn = mix(tn, vec3f(mix(s1n.x, g1n.x, rw), 0., mix(s1n.y, g1n.y, rw)), sK);
        rdir = vec2f(190., 140.) / 236.;
        rdir *= cos(ph) * fade * .28 * (1. - rw); // LOOK: was .8 (dark dashes on the slopes facing away from the sun)
      }
      gloss = mix(gloss, .05, sK); bump = mix(bump, .5, sK);
    }
  } else if (mat == 3) {
    alb = mix(vec3f(.13, .085, .05), vec3f(.36, .25, .14), Wd.b) * (.6 + .5 * B.h);
    let pk_ = fract(atan2(i.op.z, 2. - i.op.y) * 7.);
    alb *= .35 + .65 * ss(0., .12, min(pk_, 1. - pk_));
    alb = mix(alb, vec3f(.08, .22, .16), ss(.5, .7, A.c) * .6);
    gloss = .2; bump = .7;
  } else if (mat == 4) {
    // sponges: brown, tan, rust and a muted violet
    let hue = fract(sd * 7.31);
    alb = mix(vec3f(.46, .26, .12), vec3f(.60, .44, .24), fract(hue * 3.));
    if (hue > .72) { alb = vec3f(.24, .15, .20); } // LOOK: duller violet
    if (hue < .2) { alb = vec3f(.62, .22, .10); }
    if (hue > .3 && hue < .38) { alb = vec3f(.70, .54, .14); }
    alb *= (.45 + .75 * B.h) * (.7 + .3 * C.h);
    vao = i.ao * i.ao; gloss = .15; bump = 1.4; flu = .12;
    { // LOOK: pores and crust from the coral-ground scan
      let sx = tpl(i.op + sd * 7., gdx, gdy, tw, pk(1.6) * ts, 6);
      alb *= .5 + 1.1 * dot(sx.alb, vec3f(.3, .59, .11)) * LG[6]; tn = sx.n; tnk = .9; vao *= .65 + .35 * sx.h;
    }
  } else {
    // corals: tan, olive, cream, now and then pink, orange or lilac
    let hue = fract(sd * 5.73);
    alb = mix(vec3f(.52, .40, .22), vec3f(.36, .40, .16), fract(hue * 4.));
    if (hue > .55) { alb = vec3f(.50, .45, .32); }
    if (hue > .8) { alb = vec3f(.62, .27, .32); } // LOOK: less pastel
    if (hue > .9) { alb = vec3f(.78, .40, .15); }
    if (hue > .96) { alb = vec3f(.32, .22, .48); }
    alb *= (.4 + .8 * B.h) * (.5 + .9 * i.ao * i.ao);
    if (mat == 6) {
      let hh = fract(sd * 3.77);
      alb = mix(mix(vec3f(.85, .30, .10), vec3f(.85, .12, .35), ss(.25, .35, hh)), mix(vec3f(.90, .70, .12), vec3f(.35, .25, .75), ss(.75, .85, hh)), ss(.5, .6, hh)) * (.55 + .7 * B.h) * (.6 + .6 * i.ao);
      // LOOK round 4: the colours of a real reef: orange and purple soft coral, yellow, red encrusting sponge, pink, tan
      let pi = i32(hh * 6.99);
      var hc = vec3f(.80, .34, .10);
      if (pi == 1) { hc = vec3f(.34, .16, .36); } if (pi == 2) { hc = vec3f(.78, .64, .14); } if (pi == 3) { hc = vec3f(.58, .12, .08); }
      if (pi == 4) { hc = vec3f(.72, .28, .42); } if (pi == 5) { hc = vec3f(.55, .44, .26); } if (pi == 6) { hc = vec3f(.38, .44, .16); }
      alb = hc * .85 * (.6 + .6 * B.h) * (.55 + .6 * i.ao);
      gloss = .3;
    }
    flu = .1; gloss = .2; bump = 1.5;
    { // LOOK: polyp texture and grime from the coral-gravel scan; the hollows darker
      let sx = tpl(i.op + sd * 5., gdx, gdy, tw, pk(2.2) * ts, 7);
      alb *= .45 + 1.2 * dot(sx.alb, vec3f(.3, .59, .11)) * LG[7]; tn = sx.n; tnk = .8; vao *= .6 + .4 * sx.h;
    }
  }
  let rip = 0.;
  if (mat == 0) { alb *= 1. - .15 * gm.g; vao *= 1. - .25 * gm.g; } // LOOK: the baked contact map made dark blobs; SSAO does contact shadows now

  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) * (1. - tnk * .6)) * bump + tn * tnk * near + vec3f(rdir.x, sgro, rdir.y)))); // LOOK: + scanned normals
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  // LOOK: the procedural cavity term (hgt) only darkens rock a little now, and never sand: it made dark blotches
  let ao = (.3 + .7 * (sat((v1.r - .5) * 8.) * .55 + sat((v2.r - .5) * 2.7) * .45)) * vao * mix(mix(.6, 1., ss(.12, .6, hgt)), 1., sK); // LOOK: never fully black under overhangs
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * shadowS(i.wp + n0 * .25, i.cp.xy, dist) * vehSh(i.wp); // LOOK: soft shadows (PCSS near, cheaper far)
  let ndl = sat(dot(N, L));
  // LOOK: + light bounced up from the sunlit sand onto faces that look down (rock detail stays readable in shadow)
  // LOOK round 3: + the glow of the surrounding water itself (light scattered in from every side), so faces in shadow
  // and under overhangs keep their detail instead of going black
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z) + sunE(i.wp.y, z) * vec3f(.16, .15, .11) * sat(-N.y * .8 + .25)) * ao
    + wInf(i.wp.y, normalize(vec3f(N.x, N.y * .5 + .2, N.z)), g.sun.xyz) * vec3f(1.6, 1.2, 1.0) * (.35 + .65 * ao) * .3;
  // LOOK: caustics as bright lines over an even base (no dark blotches between them)
  // LOOK: caustics as thin bright lines over an even base: the dark cells between them read as blotches when strong
  let dl = E * ndl * (2.1 + mix(vec3f(.4), ca, ss(.05, .35, dot(n0, L))) * .85);
  var c = alb * (dl + am) + emi + alb * flu * dot(dl + am, vec3f(.1, .5, .5));
  let H = normalize(V + L);
  c += E * (.25 + ca) * pow(sat(dot(N, H)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  c += (amb(i.wp, reflect(-V, N), v1.g, z) + side(i.wp, reflect(-V, N), sat((v2.r - .5) * 2.7), z)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- leaves (kelp, grasses, ground cover)
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 7.;
override FAR: f32 = 150.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f,
  @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f };
fn sway(p: vec2f, h: f32, t: f32) -> vec2f {
  let ph = dot(p, vec2f(.031, .017));
  let a = .024 * pow(max(h, 0.), 1.25);
  return a * (vec2f(sin(t * .5 + ph + h * .09), cos(t * .37 + ph * 1.3 + h * .07)) + .35 * vec2f(sin(t * 1.3 + ph * 3. + h * .3), cos(t * 1.1 + ph * 2. + h * .23)));
}
fn shape2(v: f32) -> f32 { return sin(3.14159 * sat(v)); }
fn pal(h: f32) -> vec3f {
  if (h < .3) { return vec3f(1., .62, .08); }
  if (h < .6) { return vec3f(.12, 1., .22); }
  if (h < .8) { return vec3f(.2, .85, 1.); }
  return vec3f(1., .3, .8);
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = sin(f32(vi >> 1u) / (ROWS - 1.) * 1.5708);
  let ty = i32(i.c.x * 255. + .5); let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w;
  let len = i.a.w; let hA = i.b.w; let base = i.a.xyz + tl.xyz;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  // per type: x sparkle prob, y translucency, z iridescence, w emissive
  var col = vec3f(0.); var pr = vec4f(0.); var spc = vec3f(0.); var shp = vec2f(.75, .7); var wav = 1.; var fls = 1.;
  let hsel = hs(s1 * 13.7 + s2 * 71.3);
  switch ty {
    case 0 { col = mix(vec3f(.12, .13, .03), vec3f(.05, .11, .04), s1); col = mix(col, vec3f(.17, .12, .03), step(.8, s2) * .6); pr = vec4f(0., .9, 0., 0.); shp = vec2f(.5, .32); wav = 1.9; }
    case 1 { col = vec3f(.10, .11, .035); pr = vec4f(0., .2, 0., 0.); shp = vec2f(.05, .1); wav = .3; fls = .3; }
    case 2 { col = mix(vec3f(.16, .30, .05), vec3f(.30, .40, .08), s1); col = mix(col, vec3f(.38, .34, .08), step(.8, s2)); pr = vec4f(0., .8, 0., 0.); shp = vec2f(.45, .35); wav = 1.4; fls = .6; }
    case 3 { col = mix(vec3f(.15, .11, .03), vec3f(.22, .16, .05), s1); col = mix(col, vec3f(.10, .13, .04), step(.8, s2)); pr = vec4f(0., .85, 0., 0.); shp = vec2f(.7, .6); wav = 2.2; }
    case 4 { col = mix(vec3f(.30, .15, .02), vec3f(.42, .25, .04), s1); pr = vec4f(0., 1., 0., 0.); shp = vec2f(.5, .4); wav = 1.8; }
    case 5 { col = mix(vec3f(.26, .30, .08), vec3f(.34, .36, .12), s1); pr = vec4f(0., .8, 0., 0.); shp = vec2f(.6, .6); fls = 1.4; }
    case 6 { col = mix(vec3f(.46, .11, .10), vec3f(.60, .20, .20), s1); pr = vec4f(0., 1., 0., 0.); shp = vec2f(.4, .3); wav = 2.; }
    default { col = mix(vec3f(.14, .24, .09), vec3f(.22, .30, .12), s1); pr = vec4f(0., .9, 0., 0.); shp = vec2f(.6, .5); }
  }
  pr.x = step(hs(s1 * 91.7 + s2 * 37.1 + i.b.x), pr.x);
  let k = (i.c.w - .3) * 2.0 + sin(t * (.8 + s1) * fls + s2 * 40. + hA * .25) * .10 * fls;
  let wph = v * (3. + 5. * s2) + s1 * 30. + t * 1.1;
  let wv = sin(wph) * .12 * wav;
  let kq = k * 1.7; let ka = select(kq, .06, abs(kq) < .06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = base + len * (d * (sK / ka) + pe * ((1. - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * .10 * wav * v * (3. + 5. * s2);
  let N = normalize(pe * cK - d * sl); let T0 = normalize(d * cK + pe * sl);
  let tw = (s1 - .5) * 2.4 * v + sin(t * .9 + s2 * 20.) * .25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.), shp.y);
  let shp_ = g.res.x == 0.;
  let cd = distance(base, g.cam.xyz); let far = FAR * g.mis.z;
  let nearK = select(1. - ss(26., 40., cd), 0., shp_);
  let farK = select((1. - ss(far * .8, far, cd)) * ss(.6, 2.2, distance(c, g.cam.xyz)) * ss(len * 1.1 + .5, len * 2.2 + 1.2, distance(base + d * (len * .5), g.cam.xyz)), 1., shp_);
  let ruf = sin(v * 10. + s2 * 30. + t * .6) * i.b.z * .36 * u * shape2(v) * nearK;
  var p = c + S * (u * farK * select(i.b.z * .5 * shape, select(max(i.b.z * .5, .09) * shape, 0., ty == 1), shp_));
  p += N2 * ruf;
  let sw = sway(i.a.xz, hA + (p.y - i.a.y), t);
  p.x += sw.x; p.z += sw.y;
  o.cp = proj(p); o.wp = p; o.n = normalize(N2 + S * u * .55 - T0 * cos(v * 10. + s2 * 30. + t * .6) * u * .7 * nearK); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc;
  return o;
}
struct GO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsGl(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> GO {
  var o: GO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  var p = a.xyz; let sw = sway(a.xz, a.w, t); p.x += sw.x; p.z += sw.y;
  p += .1 * vec3f(sin(t * .7 + b.x * 50.), sin(t * .9 + b.x * 70.), cos(t * .8 + b.x * 90.));
  let d = length(p - g.cam.xyz);
  if (d > 120. || dot(p - g.cam.xyz, g.fwd.xyz) < -1.) { o.cp = vec4f(0., 0., 2., 1.); return o; }
  let tw = pow(.5 + .5 * sin(t * (.35 + .9 * hs(b.x)) + b.x * 100.), 4.);
  let sz = min(max(b.z, d * .0026), d * .0045);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = proj(w); o.uv = q;
  let z = zone(p);
  let lit = .3 + 1.8 * shadow1(p) * sunE(p.y, z).g;
  let e = b.z / sz;
  o.col = pal(b.y) * (.12 + tw * 1.7) * lit * e * e * exp(-SIG.g * d) * ss(.4, 1.5, d) * 17.;
  return o;
}
@fragment fn fsGl(i: GO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv);
  return vec4f(min(i.col * exp(-r * 7.) * (1. - ss(.7, 1., r)), vec3f(10.)), 0.);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus2(i.wp, dist);
  var n = normalize(i.n); if (!ff) { n = -n; }
  let V = normalize(g.cam.xyz - i.wp); let L = g.sun.xyz;
  let z = zone(i.wp);
  let lt = sD(vec2f(i.uv.x * .13 + i.sd.x * 3.7, i.uv.y * .8 + i.sd.y * 5.3));
  // LOOK: ragged, torn margins instead of a clean polygon edge (TAA smooths the outline)
  let rag = lt.a * .55 + .45 * fract(sin(floor(i.uv.y * 23. + i.sd.y * 50.) * 91.7) * 4375.5);
  if (abs(i.uv.x) > 1. - .32 * rag * ss(26., 4., dist) * ss(.02, .15, i.uv.y)) { discard; }
  let vv = vol(i.wp + vec3f(0., .8, 0.));
  let E = sunE(i.wp.y, z) * shadow1(i.wp + L * .3);
  let ndl = dot(n, L);
  // LOOK: duller, olive-brown kelp (less yellow), with a midrib and cell texture so blades are not flat
  let lum0 = dot(i.col, vec3f(.3, .59, .11));
  let col = mix(vec3f(lum0), i.col, .62) * vec3f(.95, 1., .78) * (.85 - .25 * ss(.2, .9, i.uv.y));
  let rib = (1. - .3 * ss(.07, .0, abs(i.uv.x)) * ss(.05, .2, i.uv.y)) * (.9 + .1 * sin(abs(i.uv.x) * 30. + i.sd.x * 9.)); // + fine veins
  var alb = col * rib * (.72 + .28 * ss(0., .25, abs(i.uv.x))) * mix(.5, 1.12, i.uv.y) * (1. - .45 * ss(30., 8., dist) * ss(.6, 1., sin(i.uv.y * 40. - abs(i.uv.x) * 7. + i.sd.x * 40.))) * (.58 + .42 * ss(0., .13, abs(i.uv.x))) * (.5 + 1.0 * lt.b) * (.65 + .7 * lt.a);
  let ndv = sat(dot(n, V));
  alb *= mix(.55, 1., ss(.0, .5, 1. - abs(i.uv.x))); // darker, softer margins instead of a hard edge
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + i.sd.x * .22 + i.uv.y * .5 + .55));
  alb = mix(alb, alb * .5 + ir * vec3f(.15, .13, .30), i.pr.z * (1. - ndv) * .8);
  let tr = (max(-ndl, 0.) * 1.4 + .12) * i.pr.y;
  let trc = alb * mix(vec3f(1.), vec3f(1.35, 1.3, .7), sat(i.pr.y) * (1. - i.pr.z)); // LOOK: transmitted light olive-gold, not lime
  let aov = sat((vv.r - .5) * 6.) * mix(.4, 1., i.uv.y);
  let am = (amb(i.wp, n, vv.g, z) + amb(i.wp, -n, vv.g, z) * i.pr.y * .55 * vec3f(1.1, 1.15, .7) + side(i.wp, n, sat((vv.r - .5) * 4.), z) * .6) * (.3 + .7 * aov);
  var c = E * (.06 + ca * 1.5) * (alb * max(ndl, 0.) + trc * tr) + alb * am;
  let H = normalize(V + L);
  c += E * (pow(sat(dot(n, H)), 40.) * (.45 + ir * i.pr.z * 2.) + pow(sat(dot(n, H)), 9.) * .07) + am * ir * i.pr.z * pow(1. - ndv, 3.) * 1.5;
  c += E * trc * i.pr.y * (pow(sat(dot(-V, L)), 2.) * 3.2 + .25 * lt.b) * (.5 + 1.2 * ss(0., .4, abs(i.uv.x) * -1. + .5));
  c += alb * i.pr.w * (.5 + 3. * dot(am + E * .3, vec3f(.1, .5, .5)));
  // LOOK: translucency: where the sun lights the far side of the blade, the side we see glows through
  c += E * trc * i.pr.y * sat(-dot(n, L)) * sat(dot(n, V) * 4.) * 1.1 * (.6 + .6 * lt.b);
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- fish + mantas
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32 };
@vertex fn vsFish(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let R = i.a.w; let t = g.cam.w;
  let ta = t * i.b.y + i.b.w * 6.3 + (h.x - .5) * (26. / R);
  let ph = i.b.w * 17.;
  let P0 = i.a.xyz + vec3f(R * cos(ta), 2.2 * sin(3. * ta + ph), R * .6 * sin(ta));
  let P = g.cam.xyz + wd(P0 - g.cam.xyz); // the torus: the nearest copy of this fish
  let T = normalize(vec3f(-R * sin(ta), 6.6 * cos(3. * ta + ph), R * .6 * cos(ta))) * sign(i.b.y);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  let off = S * ((h.y - .5) * 5. + sin(t * .6 + s * 40.) * .5) + Up * ((h.z - .5) * 3.2 + cos(t * .5 + s * 31.) * .4);
  var l = i.p * i.b.z * (.75 + .5 * h.z);
  l.z += sin(t * 9. + s * 50. + l.x * 5.) * .22 * (.25 * i.b.z - l.x);
  let w = P + off + T * l.x + Up * l.y + S * l.z;
  o.cp = proj(w); o.wp = w; o.n = T * i.n.x + Up * i.n.y + S * i.n.z; o.op = i.p; o.sd = s;
  o.lt = shadow1(w);
  return o;
}
@fragment fn fsFish(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  var alb = mix(vec3f(.50, .68, .80), vec3f(.10, .22, .40), ss(-.05, .2, i.op.y));
  alb = mix(alb, vec3f(.95, .8, .3), step(.86, fract(i.sd * 7.7)) * .6);
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  c += E * pow(sat(dot(n, normalize(V + L))), 24.) * 1.6 + vec3f(.3, .6, .7) * pow(1. - sat(dot(n, V)), 3.) * .25 * vv.g;
  return fin(fog(c, i.wp, z));
}
@vertex fn vsManta(i: VI) -> VO {
  var o: VO;
  let t = g.cam.w; let R = i.a.w; let sz = i.b.z;
  let ta = t * i.b.y + i.b.x;
  let P0 = i.a.xyz + vec3f(R * cos(ta), 2.5 * sin(2. * ta + i.b.w), R * .75 * sin(ta));
  let P = g.cam.xyz + wd(P0 - g.cam.xyz);
  let T = normalize(vec3f(-R * sin(ta), 5. * cos(2. * ta + i.b.w) * 1., R * .75 * cos(ta))) * sign(i.b.y);
  var S = normalize(cross(vec3f(0., 1., 0.), T)); var Up = cross(T, S);
  let bank = -.28 * sign(i.b.y);
  let S2 = S * cos(bank) + Up * sin(bank); Up = Up * cos(bank) - S * sin(bank); S = S2;
  let u = i.n.w; let au = abs(u);
  let fp = t * 1.25 + i.b.w * 5. - au * 1.2;
  let amp = .36 * pow(au, 1.6);
  var l = i.p;
  l.y += amp * sin(fp) - .1 * sin(t * 1.25 + i.b.w * 5.);
  let tail = ss(-.5, -1.9, l.z) * step(au, .001);
  l.x += tail * sin(t * .8 + l.z * 2.) * .12;
  let sl = (.576 * pow(au, .6) * sin(fp) - .43 * pow(au, 1.6) * cos(fp)) * sign(u);
  let ln = normalize(vec3f(i.n.x - sl * i.n.y, i.n.y + sl * i.n.x, i.n.z));
  let w = P + (S * l.x + Up * l.y + T * l.z) * sz;
  o.cp = proj(w); o.wp = w; o.n = S * ln.x + Up * ln.y + T * ln.z; o.op = i.p; o.sd = i.b.w;
  o.lt = 1.;
  return o;
}
@fragment fn fsManta(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let ca = caus(i.wp, dist);
  let tx = sD(i.op.xz * .9 + i.sd);
  let n = normalize(i.n + (vec3f(tx.r, 0., tx.g) - vec3f(.5, 0., .5)) * .5); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let top = ss(-.2, .25, normalize(i.n).y);
  let au = abs(i.op.x);
  let gill = ss(.25, .0, abs(au - .13) * 8.) * ss(.04, .12, i.op.z) * ss(.34, .26, i.op.z) * ss(.2, .8, sin(i.op.z * 110.));
  var belly = vec3f(.13, .17, .21) * (.6 + .6 * tx.b) * (1. - .7 * gill);
  belly = mix(belly, vec3f(.05, .08, .11), sat(ss(.45, .9, au + tx.a * .35) + ss(-.1, -.4, i.op.z + tx.b * .2) * .7));
  var back = vec3f(.04, .065, .10) + vec3f(.10, .16, .2) * ss(.5, .75, tx.a);
  back = mix(back, vec3f(.36, .46, .52), ss(.25, .0, abs(au - .26) * 3.5 + abs(i.op.z - .12) * 5.) * .8);
  var alb = mix(belly, back, top);
  let E = sunE(i.wp.y, z) * shadow4(i.wp + n * .3);
  let ndv = sat(dot(n, V));
  let ir = .5 + .5 * cos(TAU * (vec3f(0., .33, .67) + ndv * 1.1 + tx.a * 1.5 + .55));
  let fillN = vec3f(n.x, abs(n.y) * .55 + .25, n.z);
  var c = alb * (E * sat(dot(n, L)) * (.3 + ca) + amb(i.wp, fillN, vv.g, z) * 1.1 + side(i.wp, n, 1., z) * .8);
  c += ir * vec3f(.35, .16, .6) * (.07 + .22 * tx.b) * (.4 + E.g * .2 * ca.g) * (1. - top * .3);
  c += E * pow(sat(dot(n, normalize(V + L))), 30.) * .5 * (.3 + ca);
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += alb * sky * ca * .45 * (1. - top) + sky * pow(1. - ndv, 3.) * .35;
  return fin(fog(c, i.wp, z));
}
`;

// ---------------------------------------------------------------- water surface seen from below
const W_SURF = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = vec3f(g.cam.x + p.x * 900., 0., g.cam.z + p.y * 900.);
  o.cp = g.vp * vec4f(o.wp, 1.);
  return o;
}
// ---- LOOK: the surface seen from below: Snell's window (sky, clouds, sun) inside 48.6 deg, total internal
// reflection of the water outside it, wave normals that calm with distance, bright crest lines; fogged like the rest
fn surfBelow(wp: vec3f) -> vec3f {
  let v = wp - g.cam.xyz; let d = length(v); let V = v / d; let t = g.cam.w;
  let fl = ss(140., 4., d);
  let s = (textureSample(tW, sR, pu(wp.xz, 13.)).ba + textureSample(tW, sR, pu(wp.zx, 4.7) + .2).ba * .9 + textureSample(tW, sR, pu(wp.xz, 37.) + .6).ba * .35 + textureSample(tW, sR, pu(wp.xz, 1.9) + .3).ba * .6 * ss(40., 3., d)) * fl;
  let n = normalize(vec3f(-s.x * .5, -1., -s.y * .5));
  let ci = sat(dot(V, -n));
  let k = 1. - 1.769 * (1. - ci * ci);
  let rr = refract(V, n, 1.33);
  let up = max(rr.y, 0.);
  var sky = mix(vec3f(1.5, 2.1, 2.5), vec3f(.75, 1.55, 3.0), sqrt(up));
  let cuv = rr.xz / max(rr.y, .1) * .05 + vec2f(t * .0015, t * .0007);
  let cl = ss(.42, .75, textureSample(tD, sR, cuv).a * .7 + textureSample(tD, sR, cuv * 3.1 + .3).a * .3);
  sky = mix(sky, vec3f(3.2, 3.3, 3.4), cl * .85 * ss(.05, .3, up));
  let sd = max(dot(rr, g.sun.xyz), 0.);
  sky += vec3f(1., .93, .8) * (pow(sd, 900.) * 40. + pow(sd, 40.) * 2. + pow(sd, 5.) * .4);
  let fr = pow(1. - sqrt(max(k, 0.)), 5.);
  let win = ss(0., .1, k);
  let R = reflect(V, n);
  // the water below, seen at a flatter angle: close to the haze at the horizon, so the surface fades into it
  let refl = wInf(0., normalize(vec3f(R.x, R.y * .3, R.z)), g.sun.xyz) * 1.2 + vec3f(.02, .07, .12);
  var c = mix(refl, sky * (1. - fr) + refl * fr, win);
  // LOOK: at grazing angles the far surface takes the colour of the haze (no flat lid at the horizon)
  c = mix(wInf(-2., normalize(vec3f(V.x, .02, V.z)), g.sun.xyz), c, ss(.03, .32, V.y));
  // crest lines: the caustic pattern on the underside, brightest near the window
  let cr = textureSample(tW, sR, pu(wp.xz, 9.) + s * .02).r;
  c += vec3f(.7, .9, 1.) * min(cr, 3.) * .35 * fl * (.25 + .75 * win);
  return c;
}
// ---- end LOOK surface
@fragment fn fs(i: VO) -> @location(0) vec4f {
  if (g.cam.y < 0.) { return fin(fog(surfBelow(i.wp), i.wp, zone(i.wp))); }   // LOOK: below the surface
  let v = i.wp - g.cam.xyz; let d = length(v); let V = v / d;
  let fl = ss(80., 8., d);
  let s = (textureSample(tW, sR, pu(i.wp.xz, 13.)).ba + textureSample(tW, sR, pu(i.wp.zx, 4.7) + .2).ba * .9 + textureSample(tW, sR, pu(i.wp.xz, 37.) + .6).ba * .35 + textureSample(tW, sR, pu(i.wp.xz, 1.9) + .3).ba * .5 * ss(60., 5., d)) * fl;
  let n = normalize(vec3f(-s.x * .42, -1., -s.y * .42));
  let ci = sat(dot(V, -n));
  let k = 1. - 1.769 * (1. - ci * ci);
  let win = ss(0., .22, k);
  let rr = refract(V, n, 1.33);
  let sd = max(dot(rr, g.sun.xyz), 0.);
  let fr = pow(1. - sqrt(max(k, 0.)), 5.);
  let glow = pow(max(dot(V, g.sun.xyz * vec3f(1., -1., 1.) * -1.), 0.), 8.);
  let sky = (vec3f(.30, .78, 1.) * 1.5 * clamp(1. + 1.0 * (s.x * .6 - s.y * .8), .7, 1.5) + vec3f(1., .93, .78) * (pow(sd, 120.) * .5 + pow(sd, 1500.) * 14. + pow(sd, 6.) * .12)) * (1. - fr);
  let z = zone(i.wp);
  let R = reflect(V, n);
  let refl = fogIn(i.wp, R, 300., z, g.sun.xyz) * 1.15;
  let c = mix(refl, sky, win);
  return fin(fog(c, i.wp, z));
}
// behind everything: where no terrain is drawn (it stops at ~240 m) the water looks as it does at that distance
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let p = g.cam.xyz + normalize(i.wp - g.cam.xyz) * 240.;
  return fin(fog(vec3f(0.), p, zone(p)));
}
`;

// ---------------------------------------------------------------- sprites: bubbles (alpha) and drifting particles (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f };
fn quad(i: u32) -> vec2f { return vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.; }
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let life = fract(t * b.y / b.z + b.x);
  let h = life * b.z;
  var p = a.xyz + vec3f(0., h, 0.);
  let wob = b.w * (.3 + h * .035);
  p.x += sin(t * 1.7 + b.x * 50. + h * .6) * wob + sin(h * .13 + b.x * 9.) * b.w * 2.;
  p.z += cos(t * 1.3 + b.x * 33. + h * .5) * wob + cos(h * .11 + b.x * 7.) * b.w * 2.;
  p = g.cam.xyz + wd(p - g.cam.xyz);
  let sz = a.w * (.55 + .7 * life) * ss(0., .03, life) * ss(0., -1.2, p.y);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = proj(w); o.uv = q; o.wp = p;
  o.pr = vec4f(b.x, sz, shadow1(p), 0.);
  return o;
}
@fragment fn fsBub(i: VO) -> @location(0) vec4f {
  let t = g.cam.w;
  let an = atan2(i.uv.y, i.uv.x + 1e-4);
  let big = ss(.04, .22, i.pr.y);
  let r = length(i.uv) / (.9 + big * .05 * sin(an * 3. + t * 5. + i.pr.x * 40.) + big * .02 * sin(an * 5. - t * 7.));
  let aa = fwidth(r) * 1.5;
  let disc = 1. - ss(1. - aa, 1., r);
  let rim = ss(.55, .98, r);
  let hl = ss(.34, .0, length(i.uv - vec2f(-.36, .42))) + .5 * ss(.2, .0, length(i.uv - vec2f(.4, -.42)));
  let z = zone(i.wp);
  let E = sunE(i.wp.y, z) * (.25 + .75 * i.pr.z);
  let hi = fogIn(i.wp, vec3f(0., 1., 0.), 80., z, g.sun.xyz) * 1.5;
  let lo = fogIn(i.wp, vec3f(0., -1., 0.), 80., z, g.sun.xyz);
  var c = mix(lo, hi, ss(-.5, .8, i.uv.y + rim * .4)) * (.5 + 1.2 * rim) + E * hl * 1.6;
  var al = disc * sat(.03 + rim * rim * rim * .9 + hl);
  let v = i.wp - g.cam.xyz; let d = length(v);
  let T = exp(-SIG.g * d) * ss(1.2, 3., d);
  c = c * T + fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz) * (1. - T);
  al *= mix(.35, 1., T);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(20.)), al);
}
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = quad(vi); let t = g.cam.w;
  let B = 44.;
  var p = a.xyz * B + vec3f(t * .22, t * .05, t * .13) + .5 * vec3f(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = (.012 + .045 * a.w * a.w * a.w);
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0011);
  o.cp = proj(w); o.uv = q; o.wp = p;
  let fade = ss(B * .5, B * .32, d) * ss(.6, 2.5, d) * min(1., sz / (d * .0011)) * ss(-.3, -1.5, p.y);
  let tw = .6 + .4 * sin(t * (1. + a.w * 2.) + a.x * 100.);
  o.pr = vec4f(fade * tw, shadow1(p), a.w, d);
  return o;
}
@fragment fn fsSnow(i: VO) -> @location(0) vec4f {
  let r = length(i.uv);
  let m = ss(1., .2, r);
  let z = zone(i.wp);
  let c = (sunE(i.wp.y, z) * i.pr.y * .8 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .3) * mix(vec3f(1.), vec3f(.7, 1., .9), i.pr.z);
  return vec4f(min(max(c * m * m * i.pr.x * exp(-SIG.g * i.pr.w), vec3f(0.)), vec3f(8.)), 0.);
}
`;

// ---------------------------------------------------------------- volumetric light shafts (half res)
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  // LOOK: march at most 55 m of water (past that the water column, wFog, carries the light). Under water, a ray that
  // meets the surface goes on as its mirror image (total internal reflection), so the shafts don't stop at the
  // waterline and there is no seam at the horizon; from the air the shafts start where the ray enters the water
  var tm = min(zl * rl, 55.); var t0 = 0.;
  if (g.cam.y > 0.) {
    if (rd.y >= 0.) { return vec4f(0., 0., 0., zl); }
    t0 = -g.cam.y / rd.y; tm = min(zl * rl, t0 + 55.); tm = max(tm, t0);
  } else if (rd.y > 1e-4 && zl * rl > -g.cam.y / rd.y - .5) { tm = 55.; }
  let ro = g.cam.xyz; let sx = g.sun.xyz; let k = kd(g.sun.w); let sgz = WEXT.g; // LOOK: water column extinction
  let dt = (tm - t0) / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = vec3f(0.);
  for (var n = 0; n < ${RAYN}; n++) {
    let t = t0 + (f32(n) + j) * dt;
    var p = ro + rd * t; p.y = -abs(p.y);
    let s = g.sm * vec4f(wt(p), 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    let q = p.xz - sx.xz * (p.y / sx.y);
    let pat = ss(.3, .7, textureSampleLevel(tW, sR, pu(q, 27.), 2.5).r) * ss(.15, .6, textureSampleLevel(tW, sR, pu(q.yx, 11.) + .3, 2.).r);
    let o = textureSampleLevel(tV, sC, (p - vec3f(${OX}., ${OY}., ${OZ}.)) / vec3f(PER, ${NY * VS}, PER), 0.).r;
    let mist = sat(1. - (o - .5) * 3.4);
    // LOOK: the shadow of rock in the water is lighter (light scattered in from the sides): no black volumes
    acc += exp(-sgz * (t - t0) + k * (p.y / sx.y)) * ((.4 + .6 * vis) * .012 + vis * pat * 11.) * (1. + 1.2 * mist * mist);
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = mix(.2 + 2.0 * mu * mu * mu, .8, g.sun.w);
  let wc = mix(WCOL + vec3f(.04, .07, .05), PCOL + vec3f(.28, .16, .12), g.sun.w);
  return vec4f(min(acc * dt * sgz * wc * SUNC * ph * g.mis.y * (1. - .55 * g.sun.w) * .95, vec3f(20.)), zl); // LOOK: shafts
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- LOOK: contact shadows (screen-space ambient occlusion, half res)
// 8 samples on a rotated spiral within ~0.7 m of each pixel (world space, from the depth buffer); rg = ao, linear depth
const W_AO = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
fn zAt(p: vec2i) -> f32 { let m = vec2i(textureDimensions(tDp)) - 1; return g.fwd.w / max(textureLoad(tDp, clamp(p, vec2i(0), m), 0), 1e-6); }
fn posAt(p: vec2i) -> vec3f {
  let uv = (vec2f(p) + .5) * g.res.zw; let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  return (g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w)) * zAt(p);
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy) * 2;
  let P = posAt(p); let z = dot(P, g.fwd.xyz);
  if (z > 60.) { return vec4f(1., z, 0., 0.); }
  // normal from the nearer neighbours (no smearing across silhouettes)
  let px = posAt(p + vec2i(2, 0)); let nx = posAt(p - vec2i(2, 0)); let py = posAt(p + vec2i(0, 2)); let ny = posAt(p - vec2i(0, 2));
  let dx = select(P - nx, px - P, abs(dot(px - P, g.fwd.xyz)) < abs(dot(P - nx, g.fwd.xyz)));
  let dy = select(P - ny, py - P, abs(dot(py - P, g.fwd.xyz)) < abs(dot(P - ny, g.fwd.xyz)));
  var n = normalize(cross(dy, dx)); if (dot(n, P) > 0.) { n = -n; }
  let R = .7; let rpx = R / (z * 2. * g.up.w) / g.res.w; // radius in pixels
  let a0 = ign(fc.xy) * TAU;
  var ao = 0.;
  for (var k = 0; k < 8; k++) {
    let f = (f32(k) + .5) / 8.; let an = a0 + f32(k) * 2.4;
    let o = vec2f(cos(an), sin(an)) * rpx * f;
    let S = posAt(p + vec2i(o)) - P;
    let l2 = dot(S, S);
    ao += max(dot(S, n) - .02 * z * .05, 0.) / (l2 + .02) * ss(R * R * 4., R * R, l2);
  }
  return vec4f(sat(1. - ao * .9 / 8.), z, 0., 0.);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tAO: texture_2d<f32>; // LOOK: contact shadows
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  // depth-aware upsample of the half-res shafts
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var sc = textureLoad(tS, px, 0).rgb;
  if (${TAA}) {
    // contrast-adaptive sharpening (CAS): the temporal filter softens a little; sharpen where there is room, per channel, on compressed colours
    let fm = vec2i(textureDimensions(tS)) - 1;
    let e0 = sc; let k0 = 1. / (1. + dot(e0, vec3f(.25, .5, .25)));
    let nb = textureLoad(tS, clamp(px + vec2i(0, -1), vec2i(0), fm), 0).rgb; let nd = textureLoad(tS, clamp(px - vec2i(1, 0), vec2i(0), fm), 0).rgb;
    let nf = textureLoad(tS, clamp(px + vec2i(1, 0), vec2i(0), fm), 0).rgb; let nh = textureLoad(tS, clamp(px + vec2i(0, 1), vec2i(0), fm), 0).rgb;
    let e = e0 * k0; let bb = nb / (1. + dot(nb, vec3f(.25, .5, .25))); let dd = nd / (1. + dot(nd, vec3f(.25, .5, .25)));
    let ff = nf / (1. + dot(nf, vec3f(.25, .5, .25))); let hh = nh / (1. + dot(nh, vec3f(.25, .5, .25)));
    let mn = min(e, min(min(bb, dd), min(ff, hh))); let mx = max(e, max(max(bb, dd), max(ff, hh)));
    let amp = sqrt(clamp(min(mn, vec3f(1.) - mx) / max(mx, vec3f(1e-4)), vec3f(0.), vec3f(1.)));
    let wc = -amp * .2;
    let sh = clamp((e + wc * (bb + dd + ff + hh)) / (1. + 4. * wc), vec3f(0.), vec3f(.999));
    sc = sh / max(vec3f(1.) - vec3f(dot(sh, vec3f(.25, .5, .25))), vec3f(1e-3));
  }
  var c = sc;
  { // LOOK: contact shadows: depth-aware 3x3 of the half-res AO, on what the water still lets through
    let mo = vec2i(textureDimensions(tAO)) - 1; let hp = vec2i(fc.xy * .5);
    var ao = 0.; var aw = 0.;
    for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
      let a = textureLoad(tAO, clamp(hp + vec2i(x, y), vec2i(0), mo), 0);
      let w = 1. / (.02 + abs(a.g - zf) / zf); ao += a.r * w; aw += w;
    } }
    ao /= aw;
    c *= 1. - (1. - ao) * exp(-WEXT.g * zf) * .85;
  }
  c += acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .06) + bl * .03;
  c *= g.mis.x * 1.25; // LOOK: exposure (the darker water column and even caustics need a little more)
  let q = uv - .5;
  c *= 1. - dot(q, q) * .55;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .78); // LOOK: gentler S-curve and saturation (no bleached highlights)
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.6, 1., l) * .15);
  c = mix(vec3f(l), c, 1.3) + vec3f(.004, .002, 0.);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;

// ---------------------------------------------------------------- temporal anti-aliasing (replaces MSAA)
// The scene is drawn once per pixel with the projection shifted by a sub-pixel jitter (8-sample Halton). Here every
// pixel finds where it was in the last frame (from its depth and the last view-projection), samples that history
// with a Catmull-Rom filter, clamps it to the colours of the pixel's 3x3 neighbourhood (so what moved or changed
// drops its old colour at once) and blends 12% of the new frame in. Colours are compressed by 1/(1+luma) first so the
// bright sparkles and glints of the HDR scene don't smear.
const W_TAA = W_FS + /*wgsl*/`
struct T { pvp: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, res: vec4f, k: vec4f };
@group(0) @binding(0) var<uniform> t: T;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tCur: texture_2d<f32>;
@group(0) @binding(3) var tHis: texture_2d<f32>;
@group(0) @binding(4) var tDp: texture_depth_2d;
fn cmp(c: vec3f) -> vec3f { return c / (1. + dot(c, vec3f(.25, .5, .25))); }
fn unc(c: vec3f) -> vec3f { return c / (1. - dot(c, vec3f(.25, .5, .25))); }
fn his(uv: vec2f) -> vec3f {
  // Catmull-Rom through 5 bilinear taps
  let sz = t.res.xy; let p = uv * sz; let c = floor(p - .5) + .5; let f = p - c;
  let w0 = f * (-.5 + f * (1. - .5 * f)); let w1 = 1. + f * f * (-2.5 + 1.5 * f); let w2 = f * (.5 + f * (2. - 1.5 * f)); let w3 = f * f * (-.5 + .5 * f);
  let s = w1 + w2; let o = w2 / s;
  let t0 = (c - 1.) * t.res.zw; let t12 = (c + o) * t.res.zw; let t3 = (c + 2.) * t.res.zw;
  var r = textureSampleLevel(tHis, sC, vec2f(t12.x, t0.y), 0.).rgb * (s.x * w0.y) + textureSampleLevel(tHis, sC, vec2f(t0.x, t12.y), 0.).rgb * (w0.x * s.y)
    + textureSampleLevel(tHis, sC, t12, 0.).rgb * (s.x * s.y) + textureSampleLevel(tHis, sC, vec2f(t3.x, t12.y), 0.).rgb * (w3.x * s.y)
    + textureSampleLevel(tHis, sC, vec2f(t12.x, t3.y), 0.).rgb * (s.x * w3.y);
  return max(r, vec3f(0.));
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy); let mx = vec2i(t.res.xy) - 1;
  var m1 = vec3f(0.); var m2 = vec3f(0.); var cur = vec3f(0.);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = cmp(min(textureLoad(tCur, clamp(px + vec2i(x, y), vec2i(0), mx), 0).rgb, vec3f(60.)));
    if (x == 0 && y == 0) { cur = c; }
    m1 += c; m2 += c * c;
  } }
  m1 /= 9.; let sd = sqrt(max(m2 / 9. - m1 * m1, vec3f(0.))) * 1.0;
  let zl = t.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  let nd = fc.xy * t.res.zw * 2. - 1.;
  let rv = t.fwd.xyz + t.right.xyz * (nd.x * t.right.w) - t.up.xyz * (nd.y * t.up.w);
  let pc = t.pvp * vec4f(t.cam.xyz + rv * zl, 1.);
  let uv = vec2f(pc.x / pc.w * .5 + .5, .5 - pc.y / pc.w * .5);
  var a = t.k.x;
  if (t.k.y > 0. || pc.w <= 0. || any(uv < vec2f(0.)) || any(uv > vec2f(1.))) { return vec4f(unc(cur), 1.); }
  let h = clamp(cmp(his(uv)), m1 - sd, m1 + sd);
  return vec4f(unc(mix(h, cur, a)), 1.);
}
`;
