// ============================================================================
// fish schools and sardine bait balls (fauna piece "fish")
// ============================================================================
// Boids on the GPU: every fish is one 48-byte record (position, alarm, velocity, tail phase, school / length / bank). One compute
// pass per frame reads last frame's records (ping-pong) and writes the new ones: separation, alignment, cohesion over a sliding
// window of the fish's own school, a leash to the school's anchor (a slow CPU-steered point that swims round the reef), the ball
// shell and swirl for bait balls, avoidance of rock (the baked openness volume) and the surface, and a predator term for the LAUV:
// fish part round the hull, and the ones it comes at (fast or close) bolt with an alarm that spreads to their neighbours and makes
// them roll and flash. Everything lives on the torus (differences are wrapped). Drawn as instanced, per-species meshes with the
// tail beat in the vertex shader. Test hooks: window.__fish; URL ?fish=0 leaves the piece out.
const SC_ON = !/[?&]fish=0/.test(location.search);
const SC_KMAX = 96;            // neighbours looked at per fish and frame (a window that slides through the school)

// ---- species: len (m), half height / half width as a fraction of the length, where the body is deepest (0..1 from the nose), colours
const SC_SPECIES = [
  { name: 'sardine', len: 0.16, H: 0.085, W: 0.055, peak: 0.36, tail: [0.22, 0.20, 0.7], dorsal: [0.30, 0.52, 0.09], anal: [0.60, 0.74, 0.04], pect: 0, rings: 5, sides: 5,
    pat: 0, back: [0.07, 0.17, 0.26], belly: [0.82, 0.88, 0.90], metal: 0.9, accent: [0.05, 0.08, 0.12], fin: [0.40, 0.45, 0.48] },
  { name: 'chromis', len: 0.10, H: 0.17, W: 0.07, peak: 0.36, tail: [0.26, 0.24, 0.75], dorsal: [0.22, 0.72, 0.10], anal: [0.60, 0.80, 0.06], pect: 1, rings: 8, sides: 8,
    pat: 1, back: [0.10, 0.45, 0.62], belly: [0.42, 0.72, 0.72], metal: 0.25, accent: [0.05, 0.25, 0.40], fin: [0.18, 0.5, 0.6] },
  { name: 'anthias', len: 0.13, H: 0.15, W: 0.065, peak: 0.34, tail: [0.30, 0.26, 0.85], dorsal: [0.24, 0.78, 0.13], anal: [0.62, 0.82, 0.06], pect: 1, rings: 8, sides: 8,
    pat: 2, back: [0.95, 0.38, 0.22], belly: [0.88, 0.50, 0.62], metal: 0.15, accent: [0.80, 0.15, 0.55], fin: [0.92, 0.35, 0.35] },
  { name: 'blue tang', len: 0.26, H: 0.27, W: 0.06, peak: 0.42, tail: [0.22, 0.30, 0.5], dorsal: [0.28, 0.88, 0.10], anal: [0.55, 0.88, 0.10], pect: 1, rings: 9, sides: 8,
    pat: 3, back: [0.04, 0.12, 0.80], belly: [0.05, 0.22, 0.85], metal: 0.15, accent: [0.01, 0.01, 0.04], fin: [0.98, 0.82, 0.05] },
  { name: 'sergeant major', len: 0.19, H: 0.20, W: 0.07, peak: 0.40, tail: [0.24, 0.26, 0.7], dorsal: [0.22, 0.80, 0.10], anal: [0.60, 0.82, 0.07], pect: 1, rings: 8, sides: 8,
    pat: 4, back: [0.78, 0.72, 0.25], belly: [0.82, 0.86, 0.80], metal: 0.3, accent: [0.02, 0.03, 0.05], fin: [0.60, 0.62, 0.45] },
  { name: 'grunt', len: 0.30, H: 0.14, W: 0.065, peak: 0.38, tail: [0.24, 0.22, 0.7], dorsal: [0.26, 0.74, 0.10], anal: [0.62, 0.80, 0.06], pect: 1, rings: 8, sides: 8,
    pat: 5, back: [0.60, 0.66, 0.60], belly: [0.88, 0.90, 0.84], metal: 0.55, accent: [0.98, 0.78, 0.12], fin: [0.95, 0.80, 0.20] },
  { name: 'scad', len: 0.30, H: 0.11, W: 0.06, peak: 0.34, tail: [0.24, 0.24, 0.8], dorsal: [0.30, 0.55, 0.08], anal: [0.58, 0.72, 0.05], pect: 0, rings: 8, sides: 7,
    pat: 6, back: [0.07, 0.22, 0.38], belly: [0.82, 0.88, 0.88], metal: 0.85, accent: [0.04, 0.08, 0.10], fin: [0.85, 0.72, 0.12] },
  { name: 'yellow tang', len: 0.20, H: 0.22, W: 0.055, peak: 0.40, tail: [0.26, 0.26, 0.5], dorsal: [0.26, 0.90, 0.11], anal: [0.55, 0.88, 0.09], pect: 1, rings: 9, sides: 8,
    pat: 7, back: [0.98, 0.80, 0.03], belly: [0.98, 0.84, 0.10], metal: 0.1, accent: [0.95, 0.95, 0.9], fin: [0.98, 0.78, 0.05] },
  { name: 'glassfish', len: 0.10, H: 0.14, W: 0.045, peak: 0.40, tail: [0.26, 0.24, 0.6], dorsal: [0.30, 0.60, 0.07], anal: [0.55, 0.80, 0.08], pect: 0, rings: 7, sides: 6,
    pat: 8, back: [0.80, 0.52, 0.30], belly: [0.90, 0.80, 0.64], metal: 0.5, accent: [0.4, 0.25, 0.15], fin: [0.85, 0.68, 0.5] },
];
// ---- what is where: sp species, n fish per school, kind 0 travelling school / 1 bait ball / 2 hovering group at a rock, count schools
// R leash or ball radius (m), speed in body lengths per second (ball: m/s), fear = radius at which the vehicle is felt (m), y range, rock = needs an outcrop
const SC_PLAN = [
  { sp: 0, n: 14000, kind: 1, count: 1, R: 2.4, speed: 1.0, fear: 1.3, ymin: -17, ymax: -7, hole: 1 },
  { sp: 0, n: 5000, kind: 1, count: 1, R: 1.7, speed: 0.9, fear: 1.2, ymin: -17, ymax: -6, hole: 1 },
  { sp: 0, n: 512, kind: 0, count: 3, R: 3.0, speed: 5, fear: 2.4, ymin: -16, ymax: -5 },
  { sp: 6, n: 160, kind: 0, count: 3, R: 4.0, speed: 4.5, fear: 2.4, ymin: -16, ymax: -4 },
  { sp: 5, n: 96, kind: 0, count: 5, R: 2.6, speed: 2.5, fear: 2.0, ymin: -18, ymax: -6 },
  { sp: 2, n: 96, kind: 2, count: 4, R: 2.2, speed: 1.2, fear: 1.8, rock: 1, above: 2.6 },
  { sp: 4, n: 64, kind: 0, count: 4, R: 2.0, speed: 2.0, fear: 1.8, ymin: -18, ymax: -6 },
  { sp: 3, n: 40, kind: 0, count: 4, R: 2.2, speed: 1.6, fear: 1.8, ymin: -18, ymax: -6 },
  { sp: 7, n: 32, kind: 2, count: 3, R: 1.6, speed: 1.2, fear: 1.6, rock: 1, above: 1.4 },
  { sp: 8, n: 1400, kind: 0, count: 2, R: 3.2, speed: 4, fear: 2.4, ymin: -16, ymax: -5, near: [-6, -24] },
  { sp: 8, n: 480, kind: 2, count: 2, R: 3.0, speed: 1.0, fear: 2.2, rock: 1, above: 2.2 },
  { sp: 1, n: 48, kind: 2, count: 6, R: 1.1, speed: 1.4, fear: 1.5, rock: 1, above: 1.1 },
];
const SC_SCH = [], SC_RANGE = [];   // schools (JS side) and, per species, [first fish, fish count]
const scMode = { compute: true, draw: true }; // tests: switch the two halves of the piece off to time them
let scNF = 0, scReady = false, scCur = 0, scFloor = null;
const SC_CELL = 3, SC_GN = 128;

// ---- meshes: one per species, nose at +x (length 1: x = 0.5 .. -0.5, tail fin to about -0.75), up +y, side +z. 8 floats a vertex: xyz, 0 | normal xyz, part
// (0 body, 1 tail, 2 dorsal, 3 anal, 4 pectoral)
function scBuildMesh(sp) {
  const V = [], I = [];
  const add = (x, y, z, nx, ny, nz, part) => { const l = hypot(nx, ny, nz) || 1; V.push(x, y, z, 0, nx / l, ny / l, nz / l, part); return V.length / 8 - 1; };
  const prof = (t, m) => { // half extent at t (0 nose .. 1 tail base) for a body of max m
    const u = pow(t, Math.log(0.5) / Math.log(sp.peak)); return m * max(pow(max(sin(PI * min(u, 1)), 0), 0.7), 0.2 * sstep(0.72, 1, t), 0.03);
  };
  const R = sp.rings, S = sp.sides, ring = [];
  for (let i = 0; i < R; i++) {
    const t = i / (R - 1), x = 0.5 - t, h = prof(t, sp.H), w = prof(t, sp.W), dh = (prof(min(t + 0.03, 1), sp.H) - prof(max(t - 0.03, 0), sp.H)) / 0.06;
    const r = [];
    for (let k = 0; k < S; k++) { const a = k / S * TAU; r.push(add(x, sin(a) * h, cos(a) * w, dh * 0.8, sin(a) * w, cos(a) * h, 0)); }
    ring.push(r);
  }
  for (let i = 0; i < R - 1; i++) for (let k = 0; k < S; k++) { const k2 = (k + 1) % S; I.push(ring[i][k], ring[i + 1][k], ring[i + 1][k2], ring[i][k], ring[i + 1][k2], ring[i][k2]); }
  const hAt = (t) => prof(t, sp.H);
  // dorsal / anal fin: an arch standing on the body between t = a and b
  const fin = (a, b, h, up, part) => {
    const n = 6, base = [], top = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, t = a + (b - a) * s, hb = hAt(t) * 0.9 * up, arch = 1 - pow(abs(2 * s - 1), 1.6);
      base.push(add(0.5 - t, hb, 0, 0, 0, 1, part)); top.push(add(0.5 - t - 0.04 * s, hb + up * (hAt(t) * 0.1 + h * (0.15 + 0.85 * arch)), 0, 0, 0, 1, part));
    }
    for (let i = 0; i < n; i++) I.push(base[i], top[i], top[i + 1], base[i], top[i + 1], base[i + 1]);
  };
  fin(sp.dorsal[0], sp.dorsal[1], sp.dorsal[2], 1, 2); fin(sp.anal[0], sp.anal[1], sp.anal[2], -1, 3);
  // tail: base on the peduncle, two lobes, a notch of depth fork
  const [span, tl, fork] = sp.tail, xb = -0.5 + 0.01, hb = hAt(1) * 0.9;
  const tb = [add(xb, hb, 0, 0, 0, 1, 1), add(xb, -hb, 0, 0, 0, 1, 1)];
  const tt = add(xb - tl, span * 0.5, 0, 0, 0, 1, 1), tbm = add(xb - tl, -span * 0.5, 0, 0, 0, 1, 1), nt = add(xb - tl * (1 - fork), 0, 0, 0, 0, 1, 1), mid = add(xb - 0.02, 0, 0, 0, 0, 1, 1);
  I.push(tb[0], tt, nt, tb[0], nt, mid, tb[1], nt, tbm, tb[1], mid, nt);
  if (sp.pect) for (const s of [-1, 1]) {
    const w = prof(0.3, sp.W), h = prof(0.3, sp.H), a = add(0.2, -h * 0.35, s * w * 0.8, 0, 0.3, s, 4), b = add(0.1, -h * 0.25, s * w * 0.8, 0, 0.3, s, 4), c = add(0.06, -h * 0.75, s * (w + 0.07), 0, 0.3, s, 4);
    I.push(a, b, c);
  }
  return { v: new Float32Array(V), i: new Uint32Array(I) };
}

// ---- GPU: compute (boids) and render shaders
const SC_COMMON = /*wgsl*/`
struct Fish { pos: vec3f, alarm: f32, vel: vec3f, ph: f32, c: vec4f };
struct School { anc: vec4f, avel: vec4f, ids: vec4u, prm: vec4f, prm2: vec4f, prm3: vec4f };
`;

const SC_W_BOIDS = SC_COMMON + /*wgsl*/`
const PER = ${PER}.;
struct K { veh: vec4f, fwd: vec4f, vv: vec4f, t: vec4f, n: vec4u };
@group(0) @binding(0) var<uniform> k: K;
@group(0) @binding(1) var<storage, read> FI: array<Fish>;
@group(0) @binding(2) var<storage, read_write> FO: array<Fish>;
@group(0) @binding(3) var<storage, read> SC: array<School>;
@group(0) @binding(4) var tV: texture_3d<f32>;
@group(0) @binding(5) var sV: sampler;
const KMAX = ${SC_KMAX}u;
fn wr(a: f32) -> f32 { return a - PER * round(a / PER); }
fn wv(v: vec3f) -> vec3f { return vec3f(wr(v.x), v.y, wr(v.z)); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn hsh(n: u32) -> f32 { var x = n * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return f32(x) / 4294967295.; }
fn rdir(n: u32) -> vec3f { let a = hsh(n) * 6.2831853; let z = hsh(n + 7919u) * 2. - 1.; let r = sqrt(max(1. - z * z, 0.)); return vec3f(r * cos(a), z, r * sin(a)); }
// openness of the water (0.5 at the rock surface, 1 six metres out), from the baked volume
fn opn(p: vec3f) -> f32 { return textureSampleLevel(tV, sV, (p - vec3f(${OX}., ${OY}., ${OZ}.)) / vec3f(PER, ${NY * VS}., PER), 0.).r; }
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= k.n.x) { return; }
  let f = FI[i]; let sid = u32(f.c.x); let S = SC[sid];
  let dt = k.t.x; let tm = k.t.y; let fr = u32(k.t.z);
  var pos = f.pos; var v = f.vel; var al = f.alarm;
  let len = f.c.y; let kind = S.prm.w; let cruise = S.prm.x; let R0 = S.prm3.y;
  let h0 = hsh(i * 3u + 1u); let h1 = hsh(i * 3u + 2u);
  // neighbours: a window of the school that slides with the frame (the same for every fish of the school: the reads are shared)
  let cnt = S.ids.y; let first = S.ids.x; let K = min(cnt, KMAX);
  let base = u32(hsh(sid * 977u + fr * 13u) * f32(cnt));
  let rs = S.prm2.z; let ra = S.prm2.w; let rc = ra * 1.6;
  var sep = vec3f(0.); var av = vec3f(0.); var ce = vec3f(0.); var na = 0.; var nc = 0.; var aln = 0.;
  for (var j = 0u; j < K; j++) {
    let q = FI[first + (base + j) % cnt];
    let d = wv(q.pos - pos); let r2 = dot(d, d);
    if (r2 < 1e-6) { continue; }
    if (r2 < rs * rs) { sep -= d / (r2 + .02); }
    if (r2 < ra * ra) { av += q.vel; na += 1.; aln = max(aln, q.alarm); }
    if (r2 < rc * rc) { ce += d; nc += 1.; }
  }
  let fs = f32(K) / f32(cnt);
  let calm = 1. - .85 * al;
  var acc = sep * (.55 * min(1. / fs, 3.));
  let sl = length(acc); if (sl > 14.) { acc *= 14. / sl; }
  if (na > 0.) { acc += (av / na - v) * 1.8 * calm; }
  if (nc > 0.) { acc += ce / nc * .6 * calm; }
  // the school's anchor
  let rel = wv(S.anc.xyz - pos); let dist = max(length(rel), .01);
  if (kind < .5) {
    acc += rel / dist * max(dist - R0, 0.) * 1.6 + (S.avel.xyz - v) * .5 * calm;
  } else if (kind < 1.5) {
    // bait ball: a shell of random radii round the anchor, swirling about a tilted axis
    let rb = -rel; let r = max(dist, .05);
    let near = ss(10., 3., length(wv(S.anc.xyz - k.veh.xyz)));
    let rt = R0 * (1. - .3 * near) * (.15 + .85 * pow(h0, .3333)) * (1. + .14 * sin(tm * .6 + dot(rb / r, vec3f(1., 2.3, 3.1)) * 2.2));
    acc += rel / r * (r - rt) * 3.5;
    let tilt = S.prm3.w; let axis = vec3f(sin(tilt), cos(tilt), 0.);
    let tg = cross(axis, rb); let tl = length(tg);
    let vt = tg / max(tl, .1) * S.prm3.z * cruise * (1. + .7 * near) * ss(.1 * R0, .55 * R0, r);
    acc += (vt + S.avel.xyz - v) * 1.7 * calm;
  } else {
    acc += rel * 1.4 * ss(.3 * R0, 1.2 * R0, dist) + (S.avel.xyz - v) * .5 * calm;
  }
  // wander: a random direction that changes about once a second
  let tw = tm * .9 + h0 * 5.; let wa = rdir(i * 13u + u32(tw)); let wb = rdir(i * 13u + u32(tw) + 1u);
  acc += mix(wa, wb, ss(0., 1., fract(tw))) * .9 * cruise * calm * select(1., .4, kind > .5 && kind < 1.5);
  // depth range and the surface
  if (pos.y < S.prm2.x) { acc.y += (S.prm2.x - pos.y) * 1.2; }
  if (pos.y > S.prm2.y) { acc.y -= (pos.y - S.prm2.y) * 1.2; }
  if (pos.y > -1.6) { acc.y -= 12.; }
  // rock: steer along the gradient of the openness volume, looking a little ahead
  let la = pos + v * .8; let r0 = opn(la);
  if (r0 < .68) {
    let e = vec3f(.8, 0., 0.);
    let gr = vec3f(opn(la + e.xyy) - opn(la - e.xyy), opn(la + e.yxy) - opn(la - e.yxy), opn(la + e.yyx) - opn(la - e.yyx));
    let gl = length(gr);
    if (gl > 1e-4) { acc += gr / gl * (16. * ss(.68, .52, r0) + 30. * ss(.52, .46, r0)); }
  }
  // the vehicle: the nearest point of its hull, parting round it, bolting when it comes fast or close
  let ctr = k.veh.xyz; let fw = k.fwd.xyz; let spv = k.fwd.w;
  let dc = wv(pos - ctr); let tproj = clamp(dot(dc, fw), -k.veh.w, k.veh.w);
  let away = dc - fw * tproj; let dd = max(length(away), .02);
  let fearR = S.prm.y * (1. + S.avel.w * spv);
  if (dd < fearR) {
    let dir = away / dd; var lat = away - fw * dot(away, fw); let ll = length(lat);
    lat = select(rdir(i + 99u), lat / max(ll, .001), ll > .02);
    let pd = normalize(mix(dir, lat, .55));
    let ahead = 1. + .8 * spv * clamp(dot(dir, fw) + .3, 0., 1.);
    let w = ss(fearR, .25, dd);
    acc += pd * S.prm.z * w * w * ahead;
    let alarmR = (.55 + 1.05 * spv) * S.anc.w;
    if (dd < alarmR * (.75 + .5 * h1)) { al = max(al, 1.); }
  }
  al = max(al - dt * .65, max(aln * .8 - .35, 0.));
  // integrate: the speed eases to a target (faster when alarmed), the heading follows the steering
  v += acc * dt;
  let sp = max(length(v), 1e-3);
  let tgt = cruise * (.8 + .4 * h1) * (1. + S.prm3.x * al);
  let ns = mix(sp, tgt, 1. - exp(-dt * (.8 + 2.5 * al)));
  v = v / sp * ns;
  pos += v * dt;
  pos.x = wr(pos.x); pos.z = wr(pos.z);
  let dir = v / ns; let side = normalize(cross(dir, vec3f(0., 1., 0.)) + vec3f(1e-4, 0., 0.));
  let tb = clamp(dot(acc, side) * .45, -1.2, 1.2) + al * sin(tm * 11. + h0 * 40.) * 1.1;
  let bank = f.c.z + (tb - f.c.z) * min(dt * 9., 1.);
  let ph = fract(f.ph + dt * clamp(ns / len * .9, 2., 13.));
  FO[i] = Fish(pos, al, v, ph, vec4f(f.c.x, len, bank, 0.));
}
`;

const SC_W_DRAW = S_B + SC_COMMON + /*wgsl*/`
@group(2) @binding(0) var<storage, read> FS: array<Fish>;
@group(2) @binding(1) var<storage, read> SC: array<School>;
@group(2) @binding(2) var<storage, read> SPT: array<vec4f>;
struct VI { @location(0) p: vec4f, @location(1) n: vec4f, @builtin(instance_index) ii: u32 };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sp: u32, @location(4) @interpolate(flat) sd: f32,
  @location(5) lt: f32, @location(6) @interpolate(flat) al: f32, @location(7) @interpolate(flat) prt: f32, @location(8) @interpolate(flat) cr: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  o.cp = vec4f(2., 2., 2., 1.); o.wp = vec3f(0.); o.n = vec3f(0., 1., 0.); o.op = vec3f(0.); o.sp = 0u; o.sd = 0.; o.lt = 1.; o.al = 0.; o.prt = 0.; o.cr = 2.;
  let F = FS[i.ii]; let S = SC[u32(F.c.x)]; let sp = S.ids.z;
  let L = F.c.y;
  let P = g.cam.xyz + wd(F.pos - g.cam.xyz);
  let dc = P - g.cam.xyz;
  if (dot(dc, dc) > 130. * 130.) { return o; }
  let spd = length(F.vel);
  let dir = select(vec3f(1., 0., 0.), F.vel / spd, spd > 1e-3);
  var side = cross(dir, vec3f(0., 1., 0.)); let sl = length(side);
  side = select(vec3f(0., 0., 1.), side / sl, sl > 1e-3);
  var up = cross(side, dir);
  let cb = cos(F.c.z); let sb = sin(F.c.z);
  let up2 = up * cb + side * sb; side = side * cb - up * sb; up = up2;
  var l = i.p.xyz; var nl = i.n.xyz; let part = i.n.w;
  // tail beat: a travelling wave that grows towards the tail
  let tt = .5 - l.x; let wave = F.ph * TAU - tt * 4.2;
  let amp = .055 * (.55 + .9 * sat(spd / (L * 5.)));
  let env = min(tt * tt, 1.6);
  l.z += amp * env * sin(wave) - .22 * amp * sin(F.ph * TAU) * (1. - tt);
  let slope = amp * (-2. * tt * sin(wave) + env * 4.2 * cos(wave));
  nl.x -= slope * nl.z;
  if (part > 3.5) { l.z += sign(l.z) * .03 * (1. + sin(F.ph * TAU * .7)); }
  let w = P + (dir * l.x + up * l.y + side * l.z) * L;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = normalize(dir * nl.x + up * nl.y + side * nl.z); o.op = l;
  o.cr = select(2., length(wd(F.pos - S.anc.xyz)) / S.prm3.y, S.prm.w > .5 && S.prm.w < 1.5);
  o.sp = sp; o.sd = hs(f32(i.ii) * .37); o.al = F.alarm; o.prt = part;
  o.lt = select(shadow1(w), 1., sp == 0u);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  var n = normalize(i.n); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let c0 = SPT[i.sp * 4u]; let c1 = SPT[i.sp * 4u + 1u]; let c2 = SPT[i.sp * 4u + 2u]; let c3 = SPT[i.sp * 4u + 3u];
  let isfin = i.prt > .5;
  if (isfin && dot(n, V) < 0.) { n = -n; }
  let tt = .5 - i.op.x; let vy = i.op.y / c3.w; let pat = u32(c0.w + .5);
  let vr = (i.sd - .5) * .18;
  var alb = mix(c1.rgb, c0.rgb, select(ss(-.35, .45, vy), ss(.1, .65, vy), c1.w > .5));
  var metal = c1.w;
  if (pat == 3u) { // blue tang: the black palette
    let band = abs(vy - (.42 - .85 * (tt - .12))); alb = mix(alb, c2.rgb, ss(.30, .16, band) * ss(.1, .2, tt) * ss(.95, .8, tt));
  } else if (pat == 4u) { // sergeant major: black bars
    let b = abs(fract((tt - .2) / .14) - .5); alb = mix(alb, c2.rgb, ss(.2, .1, b) * step(.2, tt) * step(tt, .74));
  } else if (pat == 5u) { // grunt: yellow stripes along the flanks
    let b = abs(fract(vy * 2.6 + .1) - .5); alb = mix(alb, c2.rgb, ss(.14, .07, b) * ss(.18, .3, tt) * step(abs(vy), .9));
  } else if (pat == 2u) { // anthias: a magenta streak through the eye
    alb = mix(alb, c2.rgb, ss(.1, .0, abs(vy - .15 + tt * .45)) * ss(.45, .2, tt) * .8);
  } else if (pat == 6u) { // scad: dark gill spot
    alb = mix(alb, c2.rgb, ss(.05, .0, length(vec2f(tt - .26, vy - .1))) * .8);
  } else if (pat == 0u) { // sardine: a row of dark spots on the flank
    let sp_ = ss(.35, .12, length(vec2f(fract(tt * 14.) - .5, (vy - .25) * 3.))) * step(.22, tt) * step(tt, .7); alb = mix(alb, c2.rgb, sp_ * .6);
  }
  let eye = length(vec2f(tt - .13, (vy - .12) * .7)); alb = mix(alb, vec3f(.01), ss(.035, .02, eye) * step(.0, abs(i.op.z) - .02));
  if (isfin) { alb = c3.rgb; metal = 0.; if (i.prt > 1.5 && i.prt < 3.5) { alb = mix(alb, c0.rgb, .35); } }
  alb *= 1. + vr;
  let E = sunE(i.wp.y, z) * i.lt;
  var c = alb * (E * (.25 + .75 * sat(dot(n, L))) + amb(i.wp, n, vv.g, z) * 1.3);
  // mirror flanks: they pick up the water / sky they reflect, and flash the sun when they roll through it
  let Rf = reflect(-V, n);
  let envc = mix(vec3f(.03, .10, .16), vec3f(.55, .80, .95), sat(Rf.y * .6 + .5)) * exp(kd(z) * min(i.wp.y, 0.)) * (.4 + .6 * vv.g);
  let fl = pow(sat(dot(Rf, L)), 14.);
  c = mix(c, c * .5 + (envc * 3.6 + vec3f(.05, .09, .11)) * alb + E * fl * 3.2 * alb, metal * .85);
  c += E * fl * (.5 + 3. * i.al) * metal * vec3f(1., .98, .92);
  c += E * pow(sat(dot(n, normalize(V + L))), 24.) * .5 * (1. - metal) + vec3f(.3, .6, .7) * pow(1. - sat(dot(n, V)), 3.) * .15 * vv.g;
  c *= mix(.04, 1., ss(.5, 1.1, i.cr)) * (1. + .6 * ss(.85, 1.15, i.cr));
  return fin(fog(c, i.wp, z));
}
`;

// ---- JS side ----------------------------------------------------------------------------------------------------------
const scBuf = { A: null, B: null, sch: null, k: null, spt: null, vb: null, ib: null }, scMeshes = [];
let scQS = null, scQB, scQR, scQBusy = false, scMs = 0; // timestamps round the compute pass
let scBoids, scBGC = [], scBGR = [], scPipe, scFrame = 0, scT = 0;
const scSchData = new ArrayBuffer(96 * 64), scSchF = new Float32Array(scSchData), scSchU = new Uint32Array(scSchData);
const scK = new ArrayBuffer(80), scKF = new Float32Array(scK), scKU = new Uint32Array(scK);
const scCell = (i) => ((i % SC_GN) + SC_GN) % SC_GN;
function scFloorAt(x, z) { // y of the highest rock or sand under (x, z)
  const ix = floor((wrapT(x) - OX) / VS), iz = floor((wrapT(z) - OZ) / VS);
  for (let y = NY - 2; y > 0; y--) if (cv(ix, y, iz) > 0) return OY + (y + 0.5) * VS;
  return OY;
}
function scBuildFloor() {
  scFloor = new Float32Array(SC_GN * SC_GN);
  for (let gz = 0; gz < SC_GN; gz++) for (let gx = 0; gx < SC_GN; gx++) {
    const x = -HPER + gx * SC_CELL, z = -HPER + gz * SC_CELL; let h = -99;
    for (let k = 0; k < 4; k++) h = max(h, scFloorAt(x + 0.75 + (k & 1) * 1.5, z + 0.75 + (k >> 1) * 1.5));
    scFloor[gx + SC_GN * gz] = h;
  }
}
// highest floor within r metres (cells, so a little generous) of (x, z)
function scFloorMax(x, z, r) {
  const g0x = floor((wrapT(x) + HPER - r) / SC_CELL), g1x = floor((wrapT(x) + HPER + r) / SC_CELL), g0z = floor((wrapT(z) + HPER - r) / SC_CELL), g1z = floor((wrapT(z) + HPER + r) / SC_CELL);
  let h = -99;
  for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) h = max(h, scFloor[scCell(gx) + SC_GN * scCell(gz)]);
  return h;
}
const scWrapA = (a) => atan2(sin(a), cos(a));

function scMakeWorld() {
  scBuildFloor();
  rseed(77);
  const list = [];
  for (const pl of SC_PLAN) for (let c = 0; c < pl.count; c++) {
    const sp = SC_SPECIES[pl.sp], s = { sp: pl.sp, n: pl.n, kind: pl.kind, R0: pl.R, fear: pl.fear, ymin: pl.ymin, ymax: pl.ymax, len: sp.len, ph: rnd() * 6.28, hd: rnd() * TAU, hole: pl.hole || 0,
      cruise: pl.kind === 1 ? pl.speed : pl.speed * sp.len, flee: pl.kind === 1 ? 26 : 16, swirl: rnd() < 0.5 ? 1 : -1, vx: 0, vy: 0, vz: 0, ybase: 0, hx: 0, hy: 0, hz: 0, px: 0, py: 0, pz: 0 };
    let ok = false;
    for (let tr = 0; tr < 600 && !ok; tr++) {
      let x = rr(-HPER, HPER), z = rr(-HPER, HPER);
      if (pl.kind === 1 && c === 0 && pl.n > 4000 && tr < 150) { x = rr(-14, 14); z = 28 + rr(-10, 10); }
      if (pl.near && c === 0 && tr < 150) { x = pl.near[0] + rr(-6, 6); z = pl.near[1] + rr(-6, 6); } // the big ball is near where you start
      if (pl.rock) {
        const h = scFloorAt(x, z); let m = 0; for (let k = 0; k < 8; k++) m += scFloorAt(x + 6 * cos(k * TAU / 8), z + 6 * sin(k * TAU / 8)) / 8;
        if (h - m < 1.0 || h > -5 || h < -24) continue;
        s.hx = x; s.hz = z; s.hy = h + pl.above; s.ymin = s.hy - 1.5; s.ymax = s.hy + 2.5; ok = true;
      } else {
        const fl = scFloorMax(x, z, s.R0 + 3), y0 = fl + s.R0 + 2.2 + rr(0, 3.5);
        if (y0 > s.ymax) continue;
        s.hx = x; s.hz = z; s.hy = max(y0, s.ymin); ok = true;
      }
    }
    if (!ok) { s.hx = rr(-HPER, HPER); s.hz = rr(-HPER, HPER); s.hy = s.ymax || -8; }
    s.ybase = s.hy; s.px = s.hx; s.py = s.hy; s.pz = s.hz;
    list.push(s);
  }
  list.sort((a, b) => a.sp - b.sp);
  let first = 0;
  for (const s of list) { s.first = first; first += s.n; if (!SC_RANGE[s.sp]) SC_RANGE[s.sp] = [s.first, 0]; SC_RANGE[s.sp][1] += s.n; }
  scNF = first; SC_SCH.length = 0; SC_SCH.push(...list);
  // the fish
  const FD = new Float32Array(scNF * 12);
  list.forEach((s, si) => {
    for (let j = 0; j < s.n; j++) {
      const o = (s.first + j) * 12; let dx, dy, dz;
      if (s.kind === 1) { const a = rnd() * TAU, zz = rnd() * 2 - 1, r = sqrt(1 - zz * zz), q = s.R0 * pow(rnd(), 1 / 3); dx = r * cos(a) * q; dy = zz * q; dz = r * sin(a) * q; }
      else { dx = rr(-1, 1) * s.R0 * 0.6; dy = rr(-1, 1) * s.R0 * 0.3; dz = rr(-1, 1) * s.R0 * 0.6; }
      const a = rnd() * TAU, sp = s.cruise * (0.8 + 0.4 * rnd());
      FD[o] = wrapT(s.px + dx); FD[o + 1] = s.py + dy; FD[o + 2] = wrapT(s.pz + dz); FD[o + 3] = 0;
      FD[o + 4] = (s.kind === 1 ? -dz : sin(s.hd)) / (s.kind === 1 ? max(hypot(dx, dz), 0.1) : 1) * sp; FD[o + 5] = rr(-0.2, 0.2) * sp; FD[o + 6] = (s.kind === 1 ? dx / max(hypot(dx, dz), 0.1) : -cos(s.hd)) * sp; FD[o + 7] = rnd();
      FD[o + 8] = si; FD[o + 9] = s.len * (0.85 + 0.3 * rnd()); FD[o + 10] = 0; FD[o + 11] = 0;
    }
  });
  Q.writeBuffer(scBuf.A, 0, FD); Q.writeBuffer(scBuf.B, 0, FD);
}

// anchors: slow points the schools stay with. Travelling schools wander, keep clear of the floor, and turn away from the LAUV;
// hovering groups circle a spot over their rock; bait balls drift.
function scMoveAnchors(dt) {
  const t = scT, vp = lv.pos;
  for (let si = 0; si < SC_SCH.length; si++) {
    const s = SC_SCH[si], ox = s.px, oy = s.py, oz = s.pz;
    if (s.kind === 2) {
      const r = s.R0 * 0.5; s.px = wrapT(s.hx + r * sin(t * 0.21 + s.ph)); s.pz = wrapT(s.hz + r * cos(t * 0.17 + s.ph * 2)); s.py = s.hy + 0.35 * sin(t * 0.3 + s.ph);
    } else {
      s.hd += (sin(t * 0.13 + s.ph * 7) * 0.25 + sin(t * 0.31 + s.ph * 3) * 0.15) * dt;
      const sp = s.cruise * (s.kind === 1 ? 0.3 : 0.45);
      let need = -99, hl = -99, hr = -99;
      for (let d = 3; d <= 11; d += 4) for (let k = -1; k <= 1; k++) { const a = s.hd + k * 0.45; need = max(need, scFloorMax(s.px + sin(a) * d, s.pz - cos(a) * d, s.R0 + 1.2)); }
      hl = scFloorMax(s.px + sin(s.hd - 0.9) * 8, s.pz - cos(s.hd - 0.9) * 8, s.R0 + 1.2); hr = scFloorMax(s.px + sin(s.hd + 0.9) * 8, s.pz - cos(s.hd + 0.9) * 8, s.R0 + 1.2);
      const want = need + s.R0 + 1.6;
      if (want > s.ymax) s.hd += (hl < hr ? -1 : 1) * 1.1 * dt;
      s.py += clamp((min(max(want, s.ybase), s.ymax) - s.py) * 0.5, -0.5, 0.5) * dt;
      const dx = wrapD(s.px - vp[0]), dz = wrapD(s.pz - vp[2]), d = hypot(dx, dz, s.py - vp[1]);
      if (d < 10 && !s.hole) s.hd += clamp(scWrapA(atan2(dx, -dz) - s.hd), -1, 1) * dt * ss01(10, 3, d);
      s.px = wrapT(s.px + sin(s.hd) * sp * dt); s.pz = wrapT(s.pz - cos(s.hd) * sp * dt);
    }
    s.vx = wrapD(s.px - ox) / dt; s.vy = (s.py - oy) / dt; s.vz = wrapD(s.pz - oz) / dt;
  }
}
function ss01(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }

function scWriteSchools() {
  for (let si = 0; si < SC_SCH.length; si++) {
    const s = SC_SCH[si], o = si * 24, sp = SC_SPECIES[s.sp];
    scSchF[o] = s.px; scSchF[o + 1] = s.py; scSchF[o + 2] = s.pz; scSchF[o + 3] = s.kind === 1 ? 0.55 : 1;
    scSchF[o + 4] = s.vx; scSchF[o + 5] = s.vy; scSchF[o + 6] = s.vz; scSchF[o + 7] = s.kind === 1 ? 0.22 : 0.45;
    scSchU[o + 8] = s.first; scSchU[o + 9] = s.n; scSchU[o + 10] = s.sp; scSchU[o + 11] = 0;
    scSchF[o + 12] = s.cruise; scSchF[o + 13] = s.fear; scSchF[o + 14] = s.flee; scSchF[o + 15] = s.kind;
    scSchF[o + 16] = s.ymin; scSchF[o + 17] = s.ymax; scSchF[o + 18] = max(0.25, s.len * (s.kind === 1 ? 3 : 3.2)); scSchF[o + 19] = s.kind === 1 ? 1.3 : 2.2 + s.len * 3;
    scSchF[o + 20] = s.kind === 1 ? 0.8 : 1.8; scSchF[o + 21] = s.R0; scSchF[o + 22] = s.swirl; scSchF[o + 23] = 0.45 + 0.25 * sin(scT * 0.05 + s.ph);
  }
  Q.writeBuffer(scBuf.sch, 0, scSchData, 0, SC_SCH.length * 96);
}

function scStep(dt) {
  const R = lv.R, P = lv.pos, u = lv.v;
  scKF[0] = P[0]; scKF[1] = P[1]; scKF[2] = P[2]; scKF[3] = 0.8;
  scKF[4] = R[0]; scKF[5] = R[1]; scKF[6] = R[2];
  const vx = R[0] * u[0] + R[3] * u[1] + R[6] * u[2], vy = R[1] * u[0] + R[4] * u[1] + R[7] * u[2], vz = R[2] * u[0] + R[5] * u[1] + R[8] * u[2];
  scKF[7] = hypot(vx, vy, vz); scKF[8] = vx; scKF[9] = vy; scKF[10] = vz;
  scKF[12] = dt; scKF[13] = scT; scKF[14] = scFrame++; scKU[16] = scNF;
  Q.writeBuffer(scBuf.k, 0, scK);
  const e = device.createCommandEncoder(), ts = scQS && !scQBusy;
  const c = e.beginComputePass(ts ? { timestampWrites: { querySet: scQS, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
  c.setPipeline(scBoids); c.setBindGroup(0, scBGC[scCur]); c.dispatchWorkgroups(Math.ceil(scNF / 64)); c.end();
  if (ts) { e.resolveQuerySet(scQS, 0, 2, scQB, 0); e.copyBufferToBuffer(scQB, 0, scQR, 0, 16); }
  Q.submit([e.finish()]);
  if (ts) { scQBusy = true; scQR.mapAsync(GPUMapMode.READ).then(() => { const t = new BigUint64Array(scQR.getMappedRange().slice(0)); scMs = Number(t[1] - t[0]) / 1e6; scQR.unmap(); scQBusy = false; }); }
  scCur ^= 1;
}

FAUNA.push({
  name: 'schools',
  async init() {
    if (!SC_ON) return;
    const GA = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    // meshes
    const vs = [], is = []; let v0 = 0;
    SC_SPECIES.forEach((sp) => { const m = scBuildMesh(sp); scMeshes.push({ v0, i0: is.length, ni: m.i.length }); vs.push(m.v); is.push(...m.i); v0 += m.v.length / 8; });
    const vAll = new Float32Array(vs.reduce((a, b) => a + b.length, 0)); let o = 0; for (const v of vs) { vAll.set(v, o); o += v.length; }
    scBuf.vb = buf(vAll, GPUBufferUsage.VERTEX); scBuf.ib = buf(new Uint32Array(is), GPUBufferUsage.INDEX);
    const spt = new Float32Array(SC_SPECIES.length * 16);
    SC_SPECIES.forEach((s, i) => { spt.set([...s.back, s.pat, ...s.belly, s.metal, ...s.accent, 0, ...s.fin, s.H], i * 16); });
    scBuf.spt = buf(spt, GPUBufferUsage.STORAGE);
    const maxFish = 40000;
    scBuf.A = device.createBuffer({ size: maxFish * 48, usage: GA }); scBuf.B = device.createBuffer({ size: maxFish * 48, usage: GA });
    scBuf.sch = device.createBuffer({ size: 96 * 64, usage: GA });
    scBuf.k = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    if (hasTS) { scQS = device.createQuerySet({ type: 'timestamp', count: 2 }); scQB = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }); scQR = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); }
    // compute
    const mc = mod(SC_W_BOIDS);
    scBoids = device.createComputePipeline({ layout: 'auto', compute: { module: mc, entryPoint: 'main' } });
    const bl = scBoids.getBindGroupLayout(0), b = [scBuf.A, scBuf.B];
    for (let i = 0; i < 2; i++) scBGC.push(device.createBindGroup({ layout: bl, entries: [{ binding: 0, resource: { buffer: scBuf.k } }, { binding: 1, resource: { buffer: b[i] } }, { binding: 2, resource: { buffer: b[i ^ 1] } },
      { binding: 3, resource: { buffer: scBuf.sch } }, { binding: 4, resource: tVol.createView() }, { binding: 5, resource: sVol }] }));
    // render
    const bgl = device.createBindGroupLayout({ entries: [0, 1, 2].map((i) => ({ binding: i, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: 'read-only-storage' } })) });
    for (let i = 0; i < 2; i++) scBGR.push(device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: b[i] } }, { binding: 1, resource: { buffer: scBuf.sch } }, { binding: 2, resource: { buffer: scBuf.spt } }] }));
    const md = mod(SC_W_DRAW);
    scPipe = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl0, bglTile, bgl] }),
      vertex: { module: md, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] }] },
      fragment: { module: md, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
    window.__fish = {
      ready: () => scReady, count: () => scNF, mode: scMode, computeMs: () => scMs,
      schools: () => SC_SCH.map((s, i) => ({ i, species: SC_SPECIES[s.sp].name, n: s.n, kind: s.kind, x: s.px, y: s.py, z: s.pz, R: s.R0, hd: s.hd })),
      // put the LAUV d metres from school i, looking at it (from the side given by yaw offset), speed u
      face(i, d = 8, u = 0, off = 0) { const s = SC_SCH[i], a = off, px = s.px - sin(a) * d, pz = s.pz + cos(a) * d; lauvPlace(px, s.py, pz, a, 0); lv.setSpeed(u); },
      species: SC_SPECIES.map((s) => s.name),
      // read the fish records back (tests): school index -> { n, meanSpeed, meanAlarm, radial histogram (ball: of r / R in 10 bins) }
      // number of fish of school i within r metres of the vehicle's centre
      async near(i, r) {
        const rb = device.createBuffer({ size: scNF * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), e = device.createCommandEncoder();
        e.copyBufferToBuffer(scCur ? scBuf.B : scBuf.A, 0, rb, 0, scNF * 48); Q.submit([e.finish()]);
        await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
        const s = SC_SCH[i], P = lv.pos; let c = 0, al = 0;
        for (let j = 0; j < s.n; j++) { const o = (s.first + j) * 12; if (hypot(wrapD(a[o] - P[0]), a[o + 1] - P[1], wrapD(a[o + 2] - P[2])) < r) c++; al += a[o + 3] > 0.3 ? 1 : 0; }
        return { near: c, alarmed: al, speed: hypot(...lv.v) };
      },
      async stats(i) {
        const rb = device.createBuffer({ size: scNF * 48, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), e = device.createCommandEncoder();
        e.copyBufferToBuffer(i === undefined || true ? (scCur ? scBuf.B : scBuf.A) : scBuf.A, 0, rb, 0, scNF * 48); Q.submit([e.finish()]);
        await rb.mapAsync(GPUMapMode.READ); const f = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
        const s = SC_SCH[i], h = new Array(12).fill(0); let sp = 0, al = 0, out = 0;
        for (let j = 0; j < s.n; j++) {
          const o = (s.first + j) * 12, dx = wrapD(f[o] - s.px), dy = f[o + 1] - s.py, dz = wrapD(f[o + 2] - s.pz), r = hypot(dx, dy, dz);
          h[min(11, floor(r / s.R0 * 5))]++; sp += hypot(f[o + 4], f[o + 5], f[o + 6]); al += f[o + 3];
        }
        return { n: s.n, meanSpeed: sp / s.n, meanAlarm: al / s.n, hist: h, anchor: [s.px, s.py, s.pz], R: s.R0 };
      },
    };
  },
  update(dt) {
    if (!SC_ON || !scBoids) return;
    if (!scReady) { if (!window.__app) return; scMakeWorld(); scReady = true; }
    if (dt <= 0 || !scMode.compute) return;
    scT += dt; scMoveAnchors(dt); scWriteSchools();
    const n = dt > 0.05 ? 2 : 1; for (let i = 0; i < n; i++) scStep(dt / n);
  },
  draw(r) {
    if (!scReady || !scMode.draw) return;
    curTile = -1; r.setBindGroup(0, bg0); useTile(r, 4);
    r.setPipeline(scPipe); r.setBindGroup(2, scBGR[scCur]); r.setVertexBuffer(0, scBuf.vb); r.setIndexBuffer(scBuf.ib, 'uint32');
    for (let s = 0; s < SC_SPECIES.length; s++) { const rg = SC_RANGE[s], m = scMeshes[s]; if (rg) r.drawIndexed(m.ni, rg[1], m.i0, m.v0, rg[0]); }
  },
});
