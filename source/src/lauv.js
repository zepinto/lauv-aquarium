// ============================================================================
// the LAUV in the scene: glTF loader, PBR WGSL, particles, kelp fouling, contact, chase camera, HUD, hooks
// ============================================================================
// Physics and control live in lauvphys.js (plain JS). Everything here that touches the GPU or the world is called
// from main.js: lauvInit (pipelines, model), lauvKelp (kelp positions for fouling), lauvFrame (step + camera),
// lauvUpdate/lauvDraw (uniforms and draw calls in the scene pass).

// ---------------------------------------------------------------- model finishes (after LauvModel.js)
// [colour sRGB hex, roughness, metal, clear coat weight, 1 = decal lifted above the hull]
const LAUV_PARTS = {
  0: [0xf08712, 0.30, 0, 1], 30: [0x5a5e63, 0.36, 0, 0.9], 63: [0x70747a, 0.36, 0, 0.9], 60: [0x666a70, 0.36, 0, 0.9], 48: [0x5f6267, 0.36, 0, 0.9],
  36: [0x2a2a2a, 0.45, 0, 0.35], 33: [0x1b1b1b, 0.42, 0, 0.35], 3: [0x2c2c2c, 0.45, 0, 0.35], 21: [0x2a2a2a, 0.58, 0, 0.15], 9: [0xb83248, 0.5, 0, 0.3],
  24: [0x101010, 0.58, 0, 0.15], 54: [0x1f1f1f, 0.58, 0, 0.15], 57: [0x2a2a2a, 0.58, 0, 0.15], 51: [0xe0ddc8, 0.5, 0, 0.15], 15: [0x3f3f3f, 0.36, 0, 0.9],
  27: [0x4d4d4d, 0.36, 0, 0.9], 12: [0xc4c4c0, 0.3, 1, 0.3], 18: [0xd0d0cc, 0.3, 1, 0.3], 6: [0xc8b070, 0.32, 1, 0.3], 42: [0x3c7f80, 0.36, 0, 0.9],
  45: [0xc4a01c, 0.35, 0, 1], 72: [0x353535, 0.32, 0, 0.9, 1], 69: [0x2074bb, 0.32, 0, 0.9, 1], 66: [0x0080ff, 0.32, 0, 0.9, 1],
};
const LAUV_PROP_X = 0.024;

function lauvParseGlb(ab) {
  const dv = new DataView(ab), jl = dv.getUint32(12, true);
  const js = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jl))), bin = 20 + jl + 8;
  const acc = (i, comps) => {
    const a = js.accessors[i], bv = js.bufferViews[a.bufferView], off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0), n = a.count * comps;
    return a.componentType === 5126 ? new Float32Array(ab.slice(off, off + n * 4)) : a.componentType === 5123 ? new Uint16Array(ab.slice(off, off + n * 2)) : new Uint32Array(ab.slice(off, off + n * 4));
  };
  const prims = [];
  for (const p of js.meshes[0].primitives) {
    const mat = js.materials[p.material], idx = +(/Color_(\d+)/.exec(mat.name) || [0, -1])[1];
    prims.push({ idx, pos: acc(p.attributes.POSITION, 3), nrm: acc(p.attributes.NORMAL, 3), ind: acc(p.indices, 1), col: mat.pbrMetallicRoughness.baseColorFactor });
  }
  return prims;
}

// merges the primitives into one 24-byte vertex buffer: position, normal (snorm8), colour + roughness (unorm8), part / metal / clear coat / flags (u8)
// parts: 0 hull, 1 propeller, 2 bottom fin, 3 port fin, 4 starboard fin, 5 top fin, 6 propeller blur disc, 7 strand
function lauvBuildMesh(prims) {
  let nv = 0, ni = 0; for (const p of prims) { nv += p.pos.length / 3; ni += p.ind.length; }
  nv += 2 * 48; ni += 48 * 6;                           // blur disc
  const vb = new ArrayBuffer(nv * 24), f32 = new Float32Array(vb), i8 = new Int8Array(vb), u8 = new Uint8Array(vb), ib = new Uint32Array(ni);
  let vo = 0, io = 0;
  const put = (x, y, z, nx, ny, nz, col, rough, part, metal, cc, flag) => {
    const o = vo * 24; f32[vo * 6] = x; f32[vo * 6 + 1] = y; f32[vo * 6 + 2] = z;
    i8[o + 12] = round(nx * 127); i8[o + 13] = round(ny * 127); i8[o + 14] = round(nz * 127); i8[o + 15] = 0;
    u8[o + 16] = col[0]; u8[o + 17] = col[1]; u8[o + 18] = col[2]; u8[o + 19] = round(rough * 255);
    u8[o + 20] = part; u8[o + 21] = round(metal * 255); u8[o + 22] = round(cc * 255); u8[o + 23] = flag; vo++;
  };
  for (const pr of prims) {
    const sp = LAUV_PARTS[pr.idx] || [0x808080, 0.45, 0, 0.8], hex = sp[0], col = [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    const n = pr.pos.length / 3, P = pr.pos, N = pr.nrm, ind = pr.ind;
    // face normals grouped by welded position: crease-limited smoothing (the OBJ normals are faceted)
    const key = (i) => round(P[i * 3] * 4000) * 73856093 ^ round(P[i * 3 + 1] * 4000) * 19349663 ^ round(P[i * 3 + 2] * 4000) * 83492791;
    const groups = new Map(), fn = new Float32Array(ind.length);
    for (let t = 0; t < ind.length; t += 3) {
      const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      fn[t] = uy * vz - uz * vy; fn[t + 1] = uz * vx - ux * vz; fn[t + 2] = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) { const kk = key(ind[t + k]); let g = groups.get(kk); if (!g) groups.set(kk, g = []); g.push(t); }
    }
    const soft = pr.idx === 33 || pr.idx === 36 || pr.idx === 3 ? 0.5 : 0.82;      // cos of the crease angle
    const partOf = (x, y, z) => {
      if (pr.idx === 6) return 1;
      if (pr.idx === 21) return abs(z) > abs(y) ? (z < 0 ? 3 : 4) : 2;
      if (pr.idx === 9 && x < 0.32) return 5;
      return 0;
    };
    const base = vo;
    for (let i = 0; i < n; i++) {
      let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const part = partOf(x, y, z), g = groups.get(key(i)) || [];
      let sx = 0, sy = 0, sz = 0;
      for (const t of g) { const l = hypot(fn[t], fn[t + 1], fn[t + 2]) || 1; if ((fn[t] * nx + fn[t + 1] * ny + fn[t + 2] * nz) / l > soft) { sx += fn[t] / l; sy += fn[t + 1] / l; sz += fn[t + 2] / l; } }
      const sl = hypot(sx, sy, sz); if (sl > 1e-6) { nx = sx / sl; ny = sy / sl; nz = sz / sl; }
      // the hull is a 17-sided prism in the file: its corners lie on the 74 mm cylinder, so give them the cylinder's normal
      const r = hypot(y, z);
      if (part === 0 && r > 0.0725 && r < 0.0745 && abs(nx) < 0.35 && pr.idx !== 45) { nx = 0; ny = y / r; nz = z / r; }
      if (sp[4] && r > 0.07 && r < 0.0755) { const k = (r + 0.0006) / r; y *= k; z *= k; }
      const nl = hypot(nx, ny, nz) || 1;
      put(x, y, z, nx / nl, ny / nl, nz / nl, col, sp[1], part, sp[2], sp[3], sp[4] ? 1 : 0);
    }
    for (let k = 0; k < ind.length; k++) ib[io++] = base + ind[k];
  }
  // propeller blur disc: a flat ring at the propeller, faded in by the shader with rpm
  { const base = vo, c = [200, 176, 112];
    for (let k = 0; k < 48; k++) { const a = k / 48 * TAU, s = sin(a), co = cos(a);
      put(LAUV_PROP_X, 0.012 * co, 0.012 * s, -1, 0, 0, c, 0.4, 6, 1, 0.2, 2); put(LAUV_PROP_X, 0.0615 * co, 0.0615 * s, -1, 0, 0, c, 0.4, 6, 1, 0.2, 2); }
    for (let k = 0; k < 48; k++) { const a = base + k * 2, b = base + (k + 1) % 48 * 2; ib[io++] = a; ib[io++] = a + 1; ib[io++] = b; ib[io++] = b; ib[io++] = a + 1; ib[io++] = b + 1; } }
  return { vb: new Uint8Array(vb), ib: ib.subarray(0, io), nv: vo };
}

const W_LAUV = S_B + /*wgsl*/`
struct VU { r0: vec4f, r1: vec4f, r2: vec4f, fins: vec4f, misc: vec4f };
@group(1) @binding(0) var<uniform> vu: VU;
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) c: vec4f, @location(3) m: vec4u };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) c: vec4f, @location(3) @interpolate(flat) m: vec4u };
fn rotY(p: vec3f, a: f32, h: f32) -> vec3f { let d = p.x - h; let c = cos(a); let s = sin(a); return vec3f(h + d * c + p.z * s, p.y, -d * s + p.z * c); }
fn rotZ(p: vec3f, a: f32, h: f32) -> vec3f { let d = p.x - h; let c = cos(a); let s = sin(a); return vec3f(h + d * c - p.y * s, d * s + p.y * c, p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
@vertex fn vs(i: VI) -> VO {
  var o: VO; var p = i.p; var n = i.n.xyz; let part = i.m.x;
  if (part == 1u || part == 6u) { let a = vu.misc.x; p = rotX(p, a); n = rotX(n, a); }
  else if (part == 2u) { p = rotY(p, vu.fins.x, .245); n = rotY(n, vu.fins.x, 0.); }
  else if (part == 3u) { p = rotZ(p, -vu.fins.y, .245); n = rotZ(n, -vu.fins.y, 0.); }
  else if (part == 4u) { p = rotZ(p, -vu.fins.z, .245); n = rotZ(n, -vu.fins.z, 0.); }
  else if (part == 5u) { p = rotY(p, vu.fins.w, .245); n = rotY(n, vu.fins.w, 0.); }
  let w = vec3f(dot(vu.r0.xyz, p) + vu.r0.w, dot(vu.r1.xyz, p) + vu.r1.w, dot(vu.r2.xyz, p) + vu.r2.w);
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = vec3f(dot(vu.r0.xyz, n), dot(vu.r1.xyz, n), dot(vu.r2.xyz, n)); o.c = i.c; o.m = i.m;
  return o;
}
// the kelp strand dragged by the propeller: vertices are already in the world
@vertex fn vsW(i: VI) -> VO {
  var o: VO; o.cp = g.vp * vec4f(i.p, 1.); o.wp = i.p; o.n = i.n.xyz; o.c = i.c; o.m = i.m; return o;
}
fn ggx(nh: f32, a: f32) -> f32 { let a2 = a * a; let d = nh * nh * (a2 - 1.) + 1.; return a2 / (3.14159 * d * d); }
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let part = i.m.x; let blur = vu.misc.y;
  var N = normalize(i.n); if (!ff) { N = -N; }
  let alb = pow(i.c.rgb, vec3f(2.2)); let rough = max(i.c.a, .06);
  let metal = f32(i.m.y) / 255.; let cc = f32(i.m.z) / 255.;
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let dist = length(i.wp - g.cam.xyz);
  let v1 = vol(i.wp + N * .25); let v2 = vol(i.wp + N * .9);
  let ao = mix(.4, 1., sat((v1.r - .5) * 6.)) * mix(.75, 1., sat((v2.r - .5) * 3.));
  let sh = shadow9(i.wp + N * .02);
  let E = sunE(i.wp.y, z) * sh;
  let ndl = sat(dot(N, L)); let ndv = max(dot(N, V), .03);
  let ca = caus(i.wp, dist);
  let am = (amb(i.wp, N, v1.g, z) + side(i.wp, N, sat((v2.r - .5) * 2.7), z)) * ao;
  let diff = alb * (1. - metal) * (E * ndl * (.12 + mix(vec3f(.33), ca, ss(.1, .5, ndl)) * 2.3) + am * 2.3);
  let H = normalize(V + L); let nh = sat(dot(N, H)); let vh = sat(dot(V, H));
  let f0 = mix(vec3f(.04), alb, metal);
  let fr = f0 + (1. - f0) * pow(1. - vh, 5.);
  let a1 = rough * rough;
  var sp = E * ndl * (.25 + ca * .9) * ggx(nh, a1) * fr / (4. * vh * vh + .0001);
  // clear coat (water film): a sharper second lobe
  sp += E * ndl * (.25 + ca * .9) * ggx(nh, .06 + rough * rough * .1) * (.04 + .96 * pow(1. - vh, 5.)) / (4. * vh * vh + .0001) * cc * .5;
  let R = reflect(-V, N);
  let env = (amb(i.wp, R, v1.g, z) + side(i.wp, R, sat((v2.r - .5) * 2.7), z)) * ao;
  let fe = (f0 + (1. - f0) * pow(1. - ndv, 5.)) * (1. - rough * .55);
  var c = diff + sp + env * (fe * (1. + cc * .6)) * 1.3;
  // the vehicle's own lamp light and a warm fill keep the paint readable at depth, where the sun has lost its red
  c += alb * (1. - metal) * vec3f(1., .82, .62) * (.16 + .3 * sat(dot(N, V))) * (.6 + .4 * ss(0., 25., -i.wp.y));
  if ((part == 1u && ign(i.cp.xy) < blur * .85) || (part == 6u && ign(i.cp.xy + 7.) > blur * .4)) { discard; }
  return fin(fog(c, i.wp, z));
}
`;

// bubbles and sediment: billboards, one instance = 8 floats (x, y, z, size | age 0-1, kind 0 bubble 1 sediment, seed, alpha)
const W_LPART = S_B + /*wgsl*/`
struct PO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) b: vec4f, @location(2) wp: vec3f, @location(3) @interpolate(flat) sh: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f, @location(1) b: vec4f) -> PO {
  var o: PO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let w = a.xyz + (g.right.xyz * q.x + g.up.xyz * q.y) * a.w;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q; o.b = b; o.wp = a.xyz; o.sh = shadow1(a.xyz);
  return o;
}
@fragment fn fs(i: PO) -> @location(0) vec4f {
  let z = zone(i.wp); let v = i.wp - g.cam.xyz; let d = length(v);
  let T = exp(-SIG.g * d) * ss(.15, .8, d);
  let fg = fogIn(g.cam.xyz, v / d, d, z, g.sun.xyz); let fw = fwidth(length(i.uv));
  if (i.b.y < .5) {
    let an = atan2(i.uv.y, i.uv.x + 1e-4);
    let r = length(i.uv) / (.92 + .04 * sin(an * 3. + i.b.z * 40.));
    let aa = fw * 1.5; let disc = 1. - ss(1. - aa, 1., r);
    let rim = ss(.55, .98, r);
    let hl = ss(.34, .0, length(i.uv - vec2f(-.36, .42))) + .5 * ss(.2, .0, length(i.uv - vec2f(.4, -.42)));
    let E = sunE(i.wp.y, z) * (.25 + .75 * i.sh);
    let hi = fogIn(i.wp, vec3f(0., 1., 0.), 80., z, g.sun.xyz) * 1.5; let lo = fogIn(i.wp, vec3f(0., -1., 0.), 80., z, g.sun.xyz);
    var c = mix(lo, hi, ss(-.5, .8, i.uv.y + rim * .4)) * (.5 + 1.2 * rim) + E * hl * 1.6;
    var al = disc * sat(.03 + rim * rim * rim * .9 + hl) * i.b.w;
    c = c * T + fg * (1. - T); al *= mix(.35, 1., T);
    return vec4f(min(max(c * al, vec3f(0.)), vec3f(20.)), al);
  }
  let r2 = dot(i.uv, i.uv);
  let n = .6 + .4 * sin(i.uv.x * 5. + i.b.z * 30. + i.b.x * 4.) * sin(i.uv.y * 4.3 + i.b.z * 17. - i.b.x * 3.);
  let al = pow(max(1. - r2, 0.), 2.) * n * i.b.w;
  let E = sunE(i.wp.y, z) * (.3 + .7 * i.sh);
  var c = vec3f(.34, .29, .22) * (E * .55 + amb(i.wp, vec3f(0., 1., 0.), 1., z) * .9);
  c = c * T + fg * (1. - T);
  return vec4f(min(max(c * al, vec3f(0.)), vec3f(12.)), al * mix(.5, 1., T));
}
`;

// ---------------------------------------------------------------- state
const LAUV_DT = 1 / 120, LAUV_MAXP = 192, LAUV_NS = 14;
const lv = new LauvVehicle();
const lauvKeys = { left: 0, right: 0, up: 0, down: 0, thrustUp: 0, thrustDown: 0 };
const lauvAud = { rpm: 0, scrape: 0, thud: 0, foul: 0, bub: 0 };
const lauvColliders = [];            // hook for other pieces: fn(x, y, z) -> signed distance in metres (> 0 inside the obstacle)
// the world edge (the endless-world piece replaces it)
let lauvConstrain = (v) => { const r = hypot(v.pos[0], v.pos[2]); if (r > 148) { const k = 148 / r; v.pos[0] *= k; v.pos[2] *= k; } };
const lauvS = { acc: 0, scratches: 0, sinceContact: 9, inContact: false, slideAcc: 0, paused: false, hint: 1, hintT: 0, scratchFlash: 0, snap: 1,
  puffAcc: 0, bubAcc: 0, flCool: 0, revT: 0, kelpT: 0, thrUpT: 0, thrDnT: 0, fps: 60, gpUp: 0, gpDn: 0,
  camMode: 'chase', camAz: 0, camEl: 0, camDist: 3.6, camYaw: 0, camIdle: 9, cpx: 0, cpy: 0, cpz: 0, tx: 0, ty: 0, tz: 0 };
const lauvP = new Float32Array(LAUV_MAXP * 8), lauvPV = new Float32Array(LAUV_MAXP * 3), lauvPL = new Float32Array(LAUV_MAXP * 2);
let lauvPN = 0;
// strand dragged by the propeller (verlet rope)
const lauvRope = new Float64Array(LAUV_NS * 6), lauvRopeVB = new ArrayBuffer(LAUV_NS * 2 * 24), lauvRopeF = new Float32Array(lauvRopeVB), lauvRopeU = new Uint8Array(lauvRopeVB), lauvRopeI = new Int8Array(lauvRopeVB);
let lauvRopeLen = 1, lauvRopeOn = 0;
const lauvTmp = new Float64Array(3);
let LV_GPU = null;

// ---------------------------------------------------------------- signed distance for contact and camera: terrain SDF plus hooks
function lauvSdf(x, y, z) {
  let s = sdAt(x, y, z);
  for (let i = 0; i < lauvColliders.length; i++) { const c = lauvColliders[i](x, y, z); if (c > s) s = c; }
  return s;
}
// outward normal (pointing into free water) from the gradient of lauvSdf; false where the field is flat
const lauvN = new Float64Array(3);
function lauvGrad(x, y, z) {
  const e = 0.25;
  const gx = lauvSdf(x + e, y, z) - lauvSdf(x - e, y, z), gy = lauvSdf(x, y + e, z) - lauvSdf(x, y - e, z), gz = lauvSdf(x, y, z + e) - lauvSdf(x, y, z - e), l = hypot(gx, gy, gz);
  if (l < 0.04) return false;
  lauvN[0] = -gx / l; lauvN[1] = -gy / l; lauvN[2] = -gz / l; return true;
}

// ---------------------------------------------------------------- contact: spheres along the hull against the world
const lauvHit = { n: 0, impact: 0, slide: 0, x: 0, y: 0, z: 0, ny: 0 };
function lauvCollide() {
  const R = lv.R, P = lv.pos; let hit = 0;
  for (let k = 0; k < LAUV_SPHERES.length; k++) {
    const sp = LAUV_SPHERES[k], bx = sp[0] - LAUV_CGX, by = sp[1] - LAUV_CGY, bz = sp[2];
    const cx = P[0] + R[0] * bx + R[3] * by + R[6] * bz, cy = P[1] + R[1] * bx + R[4] * by + R[7] * bz, cz = P[2] + R[2] * bx + R[5] * by + R[8] * bz;
    const pen = lauvSdf(cx, cy, cz) + sp[3];
    if (pen <= 0) continue;
    if (!lauvGrad(cx, cy, cz)) continue;
    const nx = lauvN[0], ny = lauvN[1], nz = lauvN[2], push = pen > 0.15 ? 0.15 : pen;
    P[0] += nx * push; P[1] += ny * push; P[2] += nz * push;
    const j = lv.impulse(nx, ny, nz, bx, by, bz, 0.2, 0.35);
    // world velocity of the vehicle, split in normal and sliding parts
    const vx = R[0] * lv.v[0] + R[3] * lv.v[1] + R[6] * lv.v[2], vy = R[1] * lv.v[0] + R[4] * lv.v[1] + R[7] * lv.v[2], vz = R[2] * lv.v[0] + R[5] * lv.v[1] + R[8] * lv.v[2];
    const vn = vx * nx + vy * ny + vz * nz, sl = hypot(vx - vn * nx, vy - vn * ny, vz - vn * nz);
    hit++; const imp = j / lv.my;
    if (imp > lauvHit.impact) lauvHit.impact = imp;
    if (sl > lauvHit.slide) { lauvHit.slide = sl; lauvHit.x = cx - nx * sp[3]; lauvHit.y = cy - ny * sp[3]; lauvHit.z = cz - nz * sp[3]; lauvHit.ny = ny; }
  }
  lauvHit.n += hit;
}

// ---------------------------------------------------------------- kelp: leaves as segments in a grid, for propeller fouling
const LK_N = 128, LK_C = 3, LK_O = -192;
let lkStart = null, lkSeg = null;
function lauvKelp(big) {
  const f = new Float32Array(big.buf), n = big.n, cell = new Uint32Array(LK_N * LK_N + 1);
  const keep = [];
  for (let i = 0; i < n; i++) { if (f[i * 9 + 3] >= 0.5) keep.push(i); }
  const seg = new Float32Array(keep.length * 7), cid = new Uint32Array(keep.length);
  keep.forEach((i, k) => {
    const x = f[i * 9], y = f[i * 9 + 1], z = f[i * 9 + 2], len = f[i * 9 + 3] * 0.85, yaw = f[i * 9 + 4], tilt = f[i * 9 + 5];
    const st = sin(tilt), dx = st * cos(yaw), dy = cos(tilt), dz = st * sin(yaw);
    seg.set([x, y, z, len, dx, dy, dz], k * 7);
    const cx = clamp(floor((x - LK_O) / LK_C), 0, LK_N - 1), cz = clamp(floor((z - LK_O) / LK_C), 0, LK_N - 1); cid[k] = cx + LK_N * cz; cell[cid[k] + 1]++;
  });
  for (let i = 0; i < LK_N * LK_N; i++) cell[i + 1] += cell[i];
  const fill = cell.slice(0, LK_N * LK_N), order = new Uint32Array(keep.length);
  for (let k = 0; k < keep.length; k++) order[fill[cid[k]]++] = k;
  const sorted = new Float32Array(keep.length * 7);
  for (let k = 0; k < keep.length; k++) for (let j = 0; j < 7; j++) sorted[k * 7 + j] = seg[order[k] * 7 + j];
  lkStart = cell; lkSeg = sorted;
}
// length of a kelp leaf within r of the point (0: none)
function lauvKelpNear(x, y, z, r) {
  if (!lkSeg) return 0;
  const cx = floor((x - LK_O) / LK_C), cz = floor((z - LK_O) / LK_C);
  for (let gz = cz - 1; gz <= cz + 1; gz++) for (let gx = cx - 1; gx <= cx + 1; gx++) {
    if (gx < 0 || gz < 0 || gx >= LK_N || gz >= LK_N) continue;
    const c = gx + LK_N * gz;
    for (let k = lkStart[c]; k < lkStart[c + 1]; k++) {
      const o = k * 7, px = x - lkSeg[o], py = y - lkSeg[o + 1], pz = z - lkSeg[o + 2], len = lkSeg[o + 3];
      const t = clamp(px * lkSeg[o + 4] + py * lkSeg[o + 5] + pz * lkSeg[o + 6], 0, len);
      const dx = px - lkSeg[o + 4] * t, dy = py - lkSeg[o + 5] * t, dz = pz - lkSeg[o + 6] * t;
      if (dx * dx + dy * dy + dz * dz < r * r) return len;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- particles
function lauvEmit(x, y, z, size, kind, vx, vy, vz, life, alpha) {
  if (lauvPN >= LAUV_MAXP) return;
  const i = lauvPN++, o = i * 8;
  lauvP[o] = x; lauvP[o + 1] = y; lauvP[o + 2] = z; lauvP[o + 3] = size; lauvP[o + 4] = 0; lauvP[o + 5] = kind; lauvP[o + 6] = rnd() * 100; lauvP[o + 7] = alpha;
  lauvPV[i * 3] = vx; lauvPV[i * 3 + 1] = vy; lauvPV[i * 3 + 2] = vz; lauvPL[i * 2] = life; lauvPL[i * 2 + 1] = size;
}
function lauvParticles(dt) {
  for (let i = 0; i < lauvPN; i++) {
    const o = i * 8, life = lauvPL[i * 2]; lauvP[o + 4] += dt / life;
    const a = lauvP[o + 4], kind = lauvP[o + 5];
    if (a >= 1) { // remove: move the last one here
      lauvPN--; if (i < lauvPN) { const s = lauvPN; for (let j = 0; j < 8; j++) lauvP[o + j] = lauvP[s * 8 + j]; for (let j = 0; j < 3; j++) lauvPV[i * 3 + j] = lauvPV[s * 3 + j]; lauvPL[i * 2] = lauvPL[s * 2]; lauvPL[i * 2 + 1] = lauvPL[s * 2 + 1]; } i--; continue;
    }
    if (kind < 0.5) { lauvPV[i * 3 + 1] += (0.25 - lauvPV[i * 3 + 1]) * min(dt * 2, 1); }
    else { const damp = exp(-dt * 1.6); lauvPV[i * 3] *= damp; lauvPV[i * 3 + 1] = lauvPV[i * 3 + 1] * damp + 0.02 * dt; lauvPV[i * 3 + 2] *= damp; }
    lauvP[o] += lauvPV[i * 3] * dt; lauvP[o + 1] += lauvPV[i * 3 + 1] * dt; lauvP[o + 2] += lauvPV[i * 3 + 2] * dt;
    const s0 = lauvPL[i * 2 + 1];
    if (kind < 0.5) { lauvP[o + 3] = s0 * (0.8 + 0.4 * a); lauvP[o + 7] = a > 0.8 ? (1 - a) / 0.2 : 1; if (lauvP[o + 1] > -0.05) lauvP[o + 7] = 0; }
    else { lauvP[o + 3] = s0 * (1 + 2.2 * sqrt(a)); lauvP[o + 7] = 0.55 * (a < 0.1 ? a / 0.1 : 1) * (1 - a) * (1 - a); }
  }
}

// ---------------------------------------------------------------- strand
function lauvRopeStart(len) {
  lauvRopeLen = clamp(len, 0.7, 2.4); lauvRopeOn = 1;
  lv.toWorld(LAUV_PROP_X, 0, 0, lauvTmp);
  for (let i = 0; i < LAUV_NS; i++) { const k = i / (LAUV_NS - 1) * lauvRopeLen; for (let j = 0; j < 3; j++) { lauvRope[i * 6 + j] = lauvTmp[j] - lv.R[j] * k; lauvRope[i * 6 + 3 + j] = lauvRope[i * 6 + j]; } }
}
function lauvRopeStep(dt) {
  if (!lauvRopeOn) return;
  const seg = lauvRopeLen / (LAUV_NS - 1);
  lv.toWorld(LAUV_PROP_X - 0.01, 0, 0, lauvTmp);
  lauvRope[0] = lauvTmp[0]; lauvRope[1] = lauvTmp[1]; lauvRope[2] = lauvTmp[2];
  for (let i = 1; i < LAUV_NS; i++) {
    const o = i * 6;
    for (let j = 0; j < 3; j++) { const p = lauvRope[o + j], v = (p - lauvRope[o + 3 + j]) * 0.85; lauvRope[o + 3 + j] = p; lauvRope[o + j] = p + v; }
    lauvRope[o + 1] += 0.05 * dt;       // a little buoyancy
    lauvRope[o] += sin(lv.t * 3 + i) * 0.0006; lauvRope[o + 2] += cos(lv.t * 2.7 + i * 1.3) * 0.0006;
  }
  for (let it = 0; it < 4; it++) for (let i = 1; i < LAUV_NS; i++) {
    const a = (i - 1) * 6, b = i * 6, dx = lauvRope[b] - lauvRope[a], dy = lauvRope[b + 1] - lauvRope[a + 1], dz = lauvRope[b + 2] - lauvRope[a + 2], l = hypot(dx, dy, dz) || 1e-6, d = (l - seg) / l;
    const wa = i === 1 ? 0 : 0.5, wb = i === 1 ? 1 : 0.5;
    lauvRope[a] += dx * d * wa; lauvRope[a + 1] += dy * d * wa; lauvRope[a + 2] += dz * d * wa;
    lauvRope[b] -= dx * d * wb; lauvRope[b + 1] -= dy * d * wb; lauvRope[b + 2] -= dz * d * wb;
  }
}
function lauvRopeBuild() {
  // ribbon facing the camera
  for (let i = 0; i < LAUV_NS; i++) {
    const o = i * 6, pv = max(i - 1, 0) * 6, nx = min(i + 1, LAUV_NS - 1) * 6;
    let tx = lauvRope[nx] - lauvRope[pv], ty = lauvRope[nx + 1] - lauvRope[pv + 1], tz = lauvRope[nx + 2] - lauvRope[pv + 2];
    const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const vx = lauvRope[o] - F[CX], vy = lauvRope[o + 1] - F[CY], vz = lauvRope[o + 2] - F[CZ];
    let ax = ty * vz - tz * vy, ay = tz * vx - tx * vz, az = tx * vy - ty * vx; const al = hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const w = 0.035 * (1 - 0.55 * i / (LAUV_NS - 1)) * (1 + 0.4 * sin(i * 1.7));
    const vl = hypot(vx, vy, vz) || 1;
    for (let s = 0; s < 2; s++) {
      const q = (i * 2 + s) * 6, sg = s ? 1 : -1;
      lauvRopeF[q] = lauvRope[o] + ax * w * sg; lauvRopeF[q + 1] = lauvRope[o + 1] + ay * w * sg; lauvRopeF[q + 2] = lauvRope[o + 2] + az * w * sg;
      const b = (i * 2 + s) * 24;
      lauvRopeI[b + 12] = round(-vx / vl * 127); lauvRopeI[b + 13] = round(-vy / vl * 127); lauvRopeI[b + 14] = round(-vz / vl * 127); lauvRopeI[b + 15] = 0;
      const t = i / (LAUV_NS - 1); lauvRopeU[b + 16] = 70 + 30 * t; lauvRopeU[b + 17] = 85 + 20 * t; lauvRopeU[b + 18] = 26; lauvRopeU[b + 19] = 130; lauvRopeU[b + 20] = 7; lauvRopeU[b + 21] = 0; lauvRopeU[b + 22] = 40; lauvRopeU[b + 23] = 0;
    }
  }
}

// ---------------------------------------------------------------- GPU resources
async function lauvInit() {
  let ab; for (const u of ['lauv-omst.glb', 'source/lauv-omst.glb']) { try { const r = await fetch(u); if (r.ok) { ab = await r.arrayBuffer(); break; } } catch {} }
  if (!ab) fail('Could not load lauv-omst.glb');
  const mesh = lauvBuildMesh(lauvParseGlb(ab));
  const vb = buf(mesh.vb, BU.VERTEX), ib = buf(mesh.ib, BU.INDEX), vbRope = device.createBuffer({ size: LAUV_NS * 2 * 24, usage: BU.VERTEX | BU.COPY_DST });
  const vbP = device.createBuffer({ size: LAUV_MAXP * 32, usage: BU.VERTEX | BU.COPY_DST });
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: {} }] });
  const u = device.createBuffer({ size: 80, usage: BU.UNIFORM | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: u } }] });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl] });
  const m = mod(W_LAUV), mp = mod(W_LPART);
  const vbl = { arrayStride: 24, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4'), A(2, 16, 'unorm8x4'), A(3, 20, 'uint8x4')] };
  const pipe = (vs, strip) => device.createRenderPipeline({ layout: pl, vertex: { module: m, entryPoint: vs, buffers: [vbl] }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: HDR }] },
    primitive: { topology: strip ? 'triangle-strip' : 'triangle-list', cullMode: 'none' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
  const pPart = device.createRenderPipeline({ layout: pl0, vertex: { module: mp, entryPoint: 'vs', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] }] },
    fragment: { module: mp, entryPoint: 'fs', targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] },
    primitive: { topology: 'triangle-strip' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
  LV_GPU = { vb, ib, nI: mesh.ib.length, vbRope, vbP, u, bg, pVeh: pipe('vs', false), pRope: pipe('vsW', true), pPart, uf: new Float32Array(20) };
}
function lauvUpdate() {
  const g = LV_GPU, uf = g.uf, R = lv.R, P = lv.pos;
  const tx = P[0] - (R[0] * LAUV_CGX + R[3] * LAUV_CGY), ty = P[1] - (R[1] * LAUV_CGX + R[4] * LAUV_CGY), tz = P[2] - (R[2] * LAUV_CGX + R[5] * LAUV_CGY);
  uf[0] = R[0]; uf[1] = R[3]; uf[2] = R[6]; uf[3] = tx; uf[4] = R[1]; uf[5] = R[4]; uf[6] = R[7]; uf[7] = ty; uf[8] = R[2]; uf[9] = R[5]; uf[10] = R[8]; uf[11] = tz;
  for (let i = 0; i < 4; i++) uf[12 + i] = lv.servo[i];
  const sweep = abs(lv.rpm) / 60 * TAU / 120;           // angle swept in half a frame at 60 fps: the blades fade into a disc as it nears the blade spacing
  let bl = clamp((sweep / (TAU / 3) - 0.08) / 0.42, 0, 1); bl = bl * bl * (3 - 2 * bl);
  uf[16] = -lv.propAngle; uf[17] = bl;
  Q.writeBuffer(g.u, 0, uf);
  // shadow caster for the terrain shader: the hull's axis, tail to nose
  lv.toWorld(0.1, 0, 0, lauvTmp); UB[60] = lauvTmp[0]; UB[61] = lauvTmp[1]; UB[62] = lauvTmp[2]; UB[63] = 0.075;
  lv.toWorld(1.75, 0, 0, lauvTmp); UB[64] = lauvTmp[0]; UB[65] = lauvTmp[1]; UB[66] = lauvTmp[2]; UB[67] = 0;
  if (lauvRopeOn) { lauvRopeBuild(); Q.writeBuffer(g.vbRope, 0, lauvRopeVB); }
  if (lauvPN) Q.writeBuffer(g.vbP, 0, lauvP.buffer, 0, lauvPN * 32);
}
function lauvDraw(r) {
  const g = LV_GPU;
  r.setPipeline(g.pVeh); r.setBindGroup(1, g.bg); r.setVertexBuffer(0, g.vb); r.setIndexBuffer(g.ib, 'uint32'); r.drawIndexed(g.nI);
  if (lauvRopeOn) { r.setPipeline(g.pRope); r.setVertexBuffer(0, g.vbRope); r.draw(LAUV_NS * 2); }
}
function lauvDrawParticles(r) {
  if (!lauvPN) return; const g = LV_GPU;
  r.setPipeline(g.pPart); r.setVertexBuffer(0, g.vbP); r.draw(4, lauvPN);
}

// ---------------------------------------------------------------- input
const lauvStep = (d) => { lv.in.throttle = clamp(round((lv.in.throttle + d) * 10) / 10, -0.3, 1); };
const lauvKey = (cmd, down) => {
  down = down ? 1 : 0;
  if (cmd === 'thrustUp' && down && !lauvKeys.thrustUp) { lauvStep(0.1); lauvS.thrUpT = -0.3; }
  if (cmd === 'thrustDown' && down && !lauvKeys.thrustDown) { lauvStep(-0.1); lauvS.thrDnT = -0.3; }
  if (cmd in lauvKeys) lauvKeys[cmd] = down;
  if (down) lauvS.hint = 0;
};
const LAUV_KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyE: 'up', ArrowDown: 'down', KeyQ: 'down', KeyW: 'thrustUp', KeyS: 'thrustDown' };
function lauvKeyEvent(code, v) { const c = LAUV_KEYMAP[code]; if (c) { lauvKey(c, v); return true; } return false; }
function lauvReleaseKeys() { for (const k in lauvKeys) lauvKeys[k] = 0; }

// ---------------------------------------------------------------- pose helpers
function lauvPlace(x, y, z, yaw, pitch) { lv.setPose(x, y, z, yaw, pitch || 0); lauvS.snap = 1; lauvS.camYaw = yaw; }
function lauvFace(px, py, pz, tx, ty, tz) { lauvPlace(px, py, pz, atan2(tx - px, -(tz - pz)), 0); }
const lauvWrapA = (a) => atan2(sin(a), cos(a));

// ---------------------------------------------------------------- camera
function lauvCamera(dt) {
  const S = lauvS, R = lv.R, P = lv.pos, fx = R[0], fy = R[1], fz = R[2], mode = S.camMode;
  const tx = P[0] + fx * 0.05, ty = P[1] + fy * 0.05 + 0.03, tz = P[2] + fz * 0.05;
  const hy = lv.yaw; let yawRef = S.camYaw;
  if (mode === 'chase' || mode === 'free') { yawRef += lauvWrapA(hy - yawRef) * (1 - exp(-dt * 2.6)); S.camYaw = yawRef; } else yawRef = S.camYaw = hy;
  let az = S.camAz, el = S.camEl, dist = S.camDist, baseEl = 0.26 + lv.pitch * 0.35;
  if (mode === 'chase') dist = 3.0 + 0.4 * abs(lv.v[0]);
  else if (mode === 'side') { az = 0; el = 0; baseEl = 0.06; dist = 1.9; }
  else if (mode === 'front') { az = 0; el = 0; baseEl = 0.1; dist = 2.1; }
  else if (mode === 'top') { az = 0; el = 0; baseEl = 1.45; dist = 3.2; }
  else if (mode === 'surface') { dist = 4.5; baseEl = 0.35; }
  else if (mode === 'free') { baseEl = 0.25; dist = 3.6; }
  if (mode === 'chase' && S.camIdle > 1.8) { const k = exp(-dt * 1.4); S.camAz *= k; S.camEl *= k; az = S.camAz; el = S.camEl; }
  S.camIdle += dt;
  const a = yawRef + az, e = clamp(baseEl + el, -1.3, 1.5);
  // behind the vehicle for az = 0 (forward is (sin, ., -cos))
  let dx = -sin(a) * cos(e), dy = sin(e), dz = cos(a) * cos(e);
  if (mode === 'side') { const sl = hypot(R[6], R[8]) || 1; dx = R[6] / sl * cos(e); dz = R[8] / sl * cos(e); }
  else if (mode === 'front') { const fl = hypot(fx, fz) || 1; dx = fx / fl * cos(e); dz = fz / fl * cos(e); }
  let px = tx + dx * dist, py = ty + dy * dist, pz = tz + dz * dist;
  if (mode === 'surface') py = 1.7;
  if (mode !== 'surface') {   // rock avoidance: walk from the target towards the wanted position and stop in front of the rock
    const n = max(2, Math.ceil(dist / 0.2)); let last = dist;
    for (let i = 1; i <= n; i++) { const t = i / n; if (lauvSdf(tx + (px - tx) * t, ty + (py - ty) * t, tz + (pz - tz) * t) > -0.45) { last = max((i - 1) / n * dist, 0.5); break; } }
    if (last < dist) { const k = last / dist; px = tx + (px - tx) * k; py = ty + (py - ty) * k; pz = tz + (pz - tz) * k; }
  }
  if (S.snap || mode === 'side' || mode === 'front' || mode === 'top') { S.cpx = px; S.cpy = py; S.cpz = pz; S.tx = tx; S.ty = ty; S.tz = tz; S.snap = 0; }
  else {
    const k = 1 - exp(-dt * 5.5), kt = 1 - exp(-dt * 9);
    S.cpx += (px - S.cpx) * k; S.cpy += (py - S.cpy) * k; S.cpz += (pz - S.cpz) * k; S.tx += (tx - S.tx) * kt; S.ty += (ty - S.ty) * kt; S.tz += (tz - S.tz) * kt;
  }
  for (let k = 0; k < 3; k++) {   // the smoothed camera can lag into a wall while turning: push it out
    const s = lauvSdf(S.cpx, S.cpy, S.cpz) + 0.3; if (s <= 0 || !lauvGrad(S.cpx, S.cpy, S.cpz)) break;
    S.cpx += lauvN[0] * s; S.cpy += lauvN[1] * s; S.cpz += lauvN[2] * s;
  }
  if (mode !== 'surface' && S.cpy > -0.15) S.cpy = -0.15;
  lookAt(S.cpx, S.cpy, S.cpz, S.tx, S.ty, S.tz);
}

// ---------------------------------------------------------------- the frame: input, physics steps, contact effects, camera
function lauvFrame(dt, play) {
  const S = lauvS, I = lv.in;
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null; let gs = 0, gpi = 0;
  if (gp) {
    const dz = (v) => abs(v) < 0.2 ? 0 : v; gs = dz(gp.axes[0] || 0); gpi = -dz(gp.axes[1] || 0);
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed ? 1 : 0, up = b(5) || b(7) || b(12), dn = b(4) || b(6) || b(13);
    if (up && !S.gpUp) lauvKey('thrustUp', 1); if (dn && !S.gpDn) lauvKey('thrustDown', 1); S.gpUp = up; S.gpDn = dn; if (gs || gpi) S.hint = 0;
    if (up || dn) { lauvKeys.thrustUp = 0; lauvKeys.thrustDown = 0; }
  }
  let steer = lauvKeys.right - lauvKeys.left + gs, pitch = lauvKeys.up - lauvKeys.down + gpi;
  if (tId >= 0) { const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); steer += clamp((tx - tx0) * tr, -1, 1); pitch -= clamp((ty - ty0) * tr, -1, 1); }
  I.steer = clamp(steer, -1, 1); I.pitch = clamp(pitch, -1, 1);
  if (lauvKeys.thrustUp) { S.thrUpT += dt; if (S.thrUpT > 0.2) { S.thrUpT = 0; lauvStep(0.1); } }
  if (lauvKeys.thrustDown) { S.thrDnT += dt; if (S.thrDnT > 0.2) { S.thrDnT = 0; lauvStep(-0.1); } }
  lauvHit.n = 0; lauvHit.impact = 0; lauvHit.slide = 0;
  if (play && !S.paused) lauvAdvance(dt);
  if (mdx || mdy) { S.camAz -= mdx * 0.0022; S.camEl += mdy * 0.0022; S.camIdle = 0; S.hint = 0; mdx = 0; mdy = 0; }
  lauvCamera(dt);
  if (!S.paused) lauvParticles(dt);
  S.fps += (min(1 / max(dt, 1e-3), 240) - S.fps) * 0.05;
  lauvHud(dt);
}

// fixed physics steps for dt seconds of frame time, then the effects of what happened
function lauvAdvance(dt) {
  const S = lauvS; S.acc += dt; let n = 0;
  while (S.acc >= LAUV_DT && n < 12) { lv.step(LAUV_DT); lauvCollide(); lauvConstrain(lv); lauvRopeStep(LAUV_DT); S.acc -= LAUV_DT; n++; }
  if (n === 12) S.acc = 0;
  lauvEffects(dt);
}

// contact scrapes, sediment, bubbles, fouling, scratch counter
function lauvEffects(dt) {
  const S = lauvS, H = lauvHit, R = lv.R, hit = H.n > 0;
  if (hit) {
    if (!S.inContact && S.sinceContact > 0.8 && (H.impact > 0.1 || H.slide > 0.15)) { S.scratches++; S.scratchFlash = 1; }
    S.inContact = true; S.sinceContact = 0;
    if (H.slide > 0.2) { S.slideAcc += H.slide * dt; if (S.slideAcc > 1.4) { S.slideAcc = 0; S.scratches++; S.scratchFlash = 1; } }
    if (H.impact > 0.05) lauvAud.thud = max(lauvAud.thud, min(H.impact * 2.2, 1));
    const up = H.ny > 0.25 ? 1 : 0.25;    // sediment rises mostly where the surface faces up
    S.puffAcc += (H.slide * 9 + H.impact * 40) * up * dt;
    while (S.puffAcc > 1) { S.puffAcc -= 1; lauvEmit(H.x + rr(-0.1, 0.1), H.y + rr(0, 0.1), H.z + rr(-0.1, 0.1), rr(0.12, 0.3), 1, rr(-0.12, 0.12), rr(0.04, 0.2), rr(-0.12, 0.12), rr(2.5, 4.5), 1); }
  } else { S.sinceContact += dt; if (S.sinceContact > 0.15) S.inContact = false; if (S.sinceContact > 1.5) S.slideAcc = 0; }
  lauvAud.scrape += ((hit ? min(H.slide * 0.9, 1) : 0) - lauvAud.scrape) * min(dt * 12, 1);
  S.scratchFlash = max(0, S.scratchFlash - dt * 1.6);
  lauvAud.rpm = lv.rpm; lauvAud.foul = lv.fouled;
  S.bubAcc += abs(lv.rpm) / 2100 * dt * 9;   // propeller wash bubbles
  while (S.bubAcc > 1) { S.bubAcc -= 1; lv.toWorld(-0.02, rr(-0.04, 0.04), rr(-0.04, 0.04), lauvTmp); lauvEmit(lauvTmp[0], lauvTmp[1], lauvTmp[2], rr(0.008, 0.022), 0, -R[0] * 0.2, rr(0.1, 0.3), -R[2] * 0.2, rr(1.5, 3), 1); lauvAud.bub = 1; }
  S.kelpT += dt; S.flCool -= dt;   // fouling: the propeller disc against kelp leaves, 20 times a second
  if (S.kelpT > 0.05) {
    S.kelpT = 0;
    if (lv.fouled < 0.5 && S.flCool <= 0 && abs(lv.rpm) > 150) {
      lv.toWorld(LAUV_PROP_X, 0, 0, lauvTmp);
      const len = lauvKelpNear(lauvTmp[0], lauvTmp[1], lauvTmp[2], 0.075);
      if (len) { lv.fouled = 1; lauvRopeStart(len + 0.3); S.revT = 0; lauvAud.thud = max(lauvAud.thud, 0.25); }
    }
  }
  if (lv.fouled > 0) {    // reverse clears: the shaft turning astern for about a second throws the strand off
    if (lv.rpm < -250) S.revT += dt; else S.revT = max(0, S.revT - dt * 0.3);
    if (S.revT > 1.1) { lv.fouled = 0; S.flCool = 3; S.revT = 0; lauvRopeOn = 0; const e = (LAUV_NS - 1) * 6; for (let i = 0; i < 3; i++) lauvEmit(lauvRope[e], lauvRope[e + 1], lauvRope[e + 2], 0.015, 0, 0, 0.2, 0, 2, 1); }
  }
}

// ---------------------------------------------------------------- HUD (OMST look: navy panels, white text, blue accents, orange for state)
let lauvH = null;
function lauvHudInit() {
  const st = document.createElement('style');
  st.textContent = '#hud{position:absolute;inset:0;pointer-events:none;font:600 clamp(12px,.55vw+.8vh,26px)/1.3 system-ui,sans-serif;color:#fff;font-variant-numeric:tabular-nums}' +
    'body:not(.g) #hud{display:none}' +
    '#hud .pn{position:absolute;background:#12305Cf0;border:1px solid #2175BC;border-radius:.45em;box-shadow:0 .2em .8em #0007;padding:.55em .8em}' +
    '#hud .k{font-size:.72em;letter-spacing:.12em;text-transform:uppercase;color:#9CC4EA}' +
    '#hud .v{font-size:1.45em;font-weight:700;line-height:1.1}#hud .v small{font-size:.55em;font-weight:600;color:#9CC4EA;margin-left:.25em}' +
    '#hl{left:1.2em;bottom:1.2em;display:grid;grid-template-columns:repeat(4,auto);gap:.4em 1.4em;align-items:end}' +
    '#hl .th{grid-column:1/5;display:grid;grid-template-columns:auto 1fr auto;gap:.8em;align-items:center;margin-top:.15em}' +
    '#hl .bar{height:.7em;background:#0B1F3F;border:1px solid #2175BC;border-radius:.4em;position:relative;overflow:hidden}' +
    '#hl .bar i{position:absolute;top:0;bottom:0;background:#F07A1E}#hl .bar b{position:absolute;top:-1px;bottom:-1px;width:2px;background:#fff;left:23%}' +
    '#hsc{transition:color .15s}#hsc.f{color:#F07A1E}' +
    '#hw{left:50%;top:1.4em;transform:translateX(-50%);background:#12305C;border-color:#F07A1E;border-left-width:.45em;padding:.5em 1.2em;display:none;white-space:nowrap}' +
    '#hw b{color:#F07A1E;letter-spacing:.1em;margin-right:.7em}#hw.on{display:block;animation:hwp 1s infinite}@keyframes hwp{50%{border-color:#12305C}}' +
    '#hk{left:50%;bottom:1.4em;transform:translateX(-50%);display:flex;gap:1.6em;align-items:center;transition:opacity 1s}#hk.off{opacity:0}' +
    '#hk span{display:flex;align-items:center;gap:.45em;white-space:nowrap}' +
    '#hk kbd{font:700 .9em system-ui;min-width:1.5em;text-align:center;padding:.12em .45em;border-radius:.3em;background:#EAF2FB;color:#12305C;box-shadow:inset 0 -.15em #C3D0E0}';
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = 'hud';
  d.innerHTML = '<div id=hl class=pn><div><div class=k>Depth</div><div class=v id=hd>0<small>m</small></div></div><div><div class=k>Speed</div><div class=v id=hs>0<small>m/s</small></div></div>' +
    '<div><div class=k>Heading</div><div class=v id=hh>0<small>N</small></div></div><div><div class=k>Scratches</div><div class=v id=hsc>0</div></div>' +
    '<div class=th><span class=k>Throttle</span><div class=bar><i id=ht></i><b></b></div><span class=v id=hp style="min-width:3.4em;text-align:right">0<small>rpm</small></span></div></div>' +
    '<div id=hw class=pn><b>PROPELLER FOULED</b>reverse (S) to clear it</div>' +
    '<div id=hk class=pn><span><kbd>&larr;</kbd><kbd>&rarr;</kbd>steer</span><span><kbd>&uarr;</kbd><kbd>&darr;</kbd>climb / dive</span><span><kbd>W</kbd><kbd>S</kbd>throttle</span><span>mouse look</span></div>';
  document.body.appendChild(d);
  const q = (i) => document.getElementById(i);
  lauvH = { d: q('hd'), s: q('hs'), h: q('hh'), sc: q('hsc'), t: q('ht'), p: q('hp'), w: q('hw'), k: q('hk'), t0: 0 };
  if (/[?&]hud=0/.test(location.search)) d.style.display = 'none';
}
function lauvHud(dt) {
  const h = lauvH, S = lauvS; if (!h) return;
  h.t0 += dt; if (h.t0 < 0.05) return; h.t0 = 0;
  const hd = ((lv.yaw * 180 / PI) % 360 + 360) % 360, dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const set = (el, t, u) => { const s = t + (u || ''); if (el._s !== s) { el._s = s; el.innerHTML = u ? t + '<small>' + u + '</small>' : t; } };
  set(h.d, (-lv.pos[1]).toFixed(1), 'm'); set(h.s, abs(lv.v[0]).toFixed(1), lv.v[0] < -0.05 ? 'm/s astern' : 'm/s');
  set(h.h, hd.toFixed(0) + '&deg;', dirs[round(hd / 45) & 7]);
  set(h.sc, '' + S.scratches); h.sc.className = S.scratchFlash > 0 ? 'f' : '';
  const th = lv.in.throttle; h.t.style.left = th >= 0 ? '23%' : (23 + th / 0.3 * 23) + '%'; h.t.style.width = (th >= 0 ? th * 77 : -th / 0.3 * 23) + '%';
  set(h.p, round(lv.rpm) + '', 'rpm');
  h.w.className = lv.fouled > 0 ? 'pn on' : 'pn';
  h.k.className = S.hint && S.hintT < 14 ? 'pn' : 'pn off';
  if (!menu) S.hintT += 0.05;
}
