// ============================================================================
// world layout + procedural content generation (load-time only)
// The world is a torus: everything is generated inside one PER x PER tile with wrapped coordinates and drawn repeated.
// Units are metres; the vehicle is 1.8 m long, the sea floor is at about -19 m, the surface at 0.
// ============================================================================
const fract = (x) => x - floor(x);
// designed rock masses: ax, az, bx, bz, radius, top, overhang, waist
const MESAS = [
  // reef ridges
  [-150, -120, -100, -95, 8, -3, 2, 1.5], [-60, -150, -10, -165, 9, -4, 3, 2], [40, -130, 95, -150, 7, -6, 3, 1], [130, -90, 150, -40, 9, -3.5, 3, 2],
  [-170, -20, -165, 40, 8, -5, 2, 1.5], [-110, 60, -70, 95, 9, -4, 4, 2], [-30, 95, 25, 110, 8, -3, 3, 2], [80, 90, 120, 120, 8, -5, 2, 2], [150, 100, 175, 150, 7, -6, 2, 1],
  // the canyon: two walls 12 m apart
  [-30, -35, -33, 20, 11, -4, 3, 2], [4, -30, 2, 26, 11, -5, 3, 2],
  // pinnacles and a pillar that reaches the surface
  [-8, 62, -8, 62, 4.4, -3, 2, 1.5], [100, -30, 100, -30, 6, 2, 2, 2], [-120, 130, -120, 130, 5, -4, 2, 1],
  // patch reefs (bommies)
  [-130, -170, -130, -170, 7, -8, 1.5, 1], [0, -100, 0, -100, 6, -9, 1, 1], [60, -60, 60, -60, 6, -10, 1, 1], [110, -130, 110, -130, 5, -8, 1.5, 1], [-80, -60, -80, -60, 7, -7, 1.5, 1],
  [-60, 10, -60, 10, 6, -9, 1, 1], [150, 20, 150, 20, 6, -10, 1, 1], [-170, 120, -170, 120, 7, -8, 1.5, 1], [-20, -180, -20, -180, 5, -9, 1, 1], [40, 170, 40, 170, 6, -8, 1.5, 1],
  [100, 170, 100, 170, 7, -7, 1.5, 1], [-100, 150, -100, 150, 6, -9, 1, 1], [20, 130, 20, 130, 5, -9, 1, 1], [140, -150, 140, -150, 6, -9, 1, 1], [-80, 180, -80, 180, 5, -10, 1, 1],
  [-190, -80, -190, -80, 6, -8, 1.5, 1], [60, 30, 60, 30, 5, -10, 1, 1], [-45, 150, -45, 150, 4, -11, 1, 1], [170, 160, 170, 160, 5, -9, 1, 1],
];
// vertical ring arches: cx, cy, cz, yaw, major radius, minor radius, y squash
const ARCHES = [
  [-35, -10, -158, 0.3, 5.5, 1.5, 1.2],
  [-13, -11, -5, 0, 8.5, 2.0, 1.0], // across the canyon
  [-85, -10, 78, 0.5, 5, 1.4, 1.2],
  [124, -9, -48, 1.2, 4.5, 1.3, 1.2],
];
// carved tunnels: ax, ay, az, radius, bx, by, bz
const HOLES = [
  [-38.4, -12, -169, 2.6, -31.6, -12, -146],
  [143, -11, -66, 2.4, 137, -11, -48],
];
// regions kept free of the large rock plateaus: ax, az, bx, bz, radius, softness
const CLEARS = [
  [70, 40, 70, 40, 34, 12], [-20, -90, 20, -80, 24, 10], [-130, 0, -120, 20, 22, 10], [100, 150, 110, 160, 20, 10], [-60, 120, -30, 150, 20, 8],
];
const SHIP = [70, 40]; // x, z of the wreck
// extra outcrops on a jittered grid so there is a lit rock mass in the mid-ground wherever one looks
{
  const hsh = (i, j, k) => { let h = Math.imul(i * 73856093 ^ j * 19349663 ^ k * 83492791, 2654435761); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
  const SPLIT = 8, CW = PER / SPLIT;
  for (let i = 0; i < SPLIT; i++) for (let j = 0; j < SPLIT; j++) {
    const x = OX + (i + 0.2 + 0.6 * hsh(i, j, 1)) * CW, z = OZ + (j + 0.2 + 0.6 * hsh(i, j, 2)) * CW;
    let ok = hsh(i, j, 7) < 0.8;
    for (const m of MESAS) { const d = hypot(wrapD(x - m[0]), wrapD(z - m[1])), d2 = hypot(wrapD(x - m[2]), wrapD(z - m[3])); if (min(d, d2) < 22) ok = false; }
    if (hypot(wrapD(x - SHIP[0]), wrapD(z - SHIP[1])) < 36) ok = false;
    if (!ok) continue;
    const r = 3 + 3 * hsh(i, j, 3), len = hsh(i, j, 4) < 0.4 ? 14 * hsh(i, j, 5) : 0, a = hsh(i, j, 6) * TAU;
    MESAS.push([x, z, x + cos(a) * len, z + sin(a) * len, r, -5.5 - 6 * hsh(i, j, 8), 2 + 2 * hsh(i, j, 9), 1 + hsh(i, j, 10)]);
  }
}

function primBuffer() {
  const a = [];
  for (const m of MESAS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of HOLES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  return new Float32Array(a);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
// MAP: the GPU's ground map (NX x NZ x 4 floats: sand, floor height, reef noise, distance to rock)
function buildTerrain(D, MAP) {
  const sn = surfaceNetsP(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3P(D, NX, NY, NZ);
  const sandAt = (x, z) => MAP[((floor((wrapT(x) - OX) / VS) & (NX - 1)) + NX * (floor((wrapT(z) - OZ) / VS) & (NZ - 1))) * 4];
  const flrAt = (x, z) => MAP[((floor((wrapT(x) - OX) / VS) & (NX - 1)) + NX * (floor((wrapT(z) - OZ) / VS) & (NZ - 1))) * 4 + 1];
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3), vs = new Float32Array(nv);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    // the vertex's fourth normal byte carries how sandy the ground is (sand on the flats, bare rock higher up)
    const sa = sandAt(X, Z) * sstep(3.2, 0.7, Y - flrAt(X, Z)); vs[k] = sa;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = round(sa * 127);
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, vs, smp, sandAt, flrAt, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- instance stores
const PROP_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 26, 27]; // meshes drawn from cell-sorted prop stores
function makeWorld(D, T, POSES) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const smp = T.smp, sandAt = T.sandAt;
  const Dw = (x, y, z) => smp((x - OX) / VS, (y - OY) / VS, (z - OZ) / VS);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((wrapT(x) - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wrapT(z) - OZ) / CELLW), 0, CELLS - 1);
  const dist2 = (x, z, px, pz) => hypot(wrapD(x - px), wrapD(z - pz));
  const big = Array.from({ length: nCells }, () => []), small = Array.from({ length: nCells }, () => []);
  // Medium and Low keep every 2nd / 4th leaf (but every kelp stem), made wider; the random stream is the same
  let nth = 0;
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { if (type === 1 || !(nth++ % THIN)) L[cellOf(x, z)].push(wrapT(x), y, wrapT(z), len, yaw, tilt, type === 1 ? wid : wid * (1 + LV / 2), hA, type, s1, s2, bend); };
  const solids = []; // per mesh id: arrays of 12 floats (the ship)
  const props = {}; for (const id of PROP_IDS) props[id] = Array.from({ length: nCells }, () => []);
  const solid = (mesh, x, y, z, sc, q, mat, seed, ts = 1, bob = 0) => { (props[mesh] ? props[mesh][cellOf(x, z)] : (solids[mesh] ||= [])).push(wrapT(x), y, wrapT(z), sc, q[0], q[1], q[2], q[3], mat, seed, ts, bob); };
  const chunks = Array.from({ length: NCHUNK }, () => Array.from({ length: nCells }, () => []));
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (dist2(x, z, p[0], p[2]) < r) return true; return false; };
  const bubbles = [], kelpAbs = new Float32Array((NX / 2) * (NY / 2) * (NZ / 2));

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = round((wrapT(x) - OX) / VS) & (NX - 1), iz = round((wrapT(z) - OZ) / VS) & (NZ - 1);
    fl.length = 0; let ceil = 3;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, min(ceil, 0) - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const grad = (x, y, z) => {
    const e = 0.6; let nx = Dw(x - e, y, z) - Dw(x + e, y, z), ny = Dw(x, y - e, z) - Dw(x, y + e, z), nz = Dw(x, y, z - e) - Dw(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  };
  // march from outside along -n to the surface
  const snap = (x, y, z, n) => {
    let px = x + n[0] * 2.5, py = y + n[1] * 2.5, pz = z + n[2] * 2.5, prev = Dw(px, py, pz);
    if (prev > 0) return null;
    for (let i = 0; i < 24; i++) {
      const qx = px - n[0] * 0.25, qy = py - n[1] * 0.25, qz = pz - n[2] * 0.25, d = Dw(qx, qy, qz);
      if (d > 0) { const t = prev / (prev - d); const p = [mix(px, qx, t), mix(py, qy, t), mix(pz, qz, t)]; return p.concat(grad(p[0], p[1], p[2])); }
      px = qx; py = qy; pz = qz; prev = d;
    }
    return null;
  };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const tangent = (n) => { let t = abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]; const l = hypot(...t); t = t.map((v) => v / l); return [t, [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]]; };
  const gy = (x, z) => { const f = floorsAt(x, z); return f.length ? f[f.length - 2] : -19; };

  // --- kelp columns: giant kelp from the rocky floor up to the surface
  const column = (x, y, z, H, kind, dens = 1) => {
    const strands = 2 + (rnd() < 0.6) + (rnd() < 0.3), ph = rnd() * TAU, tw = rr(0.1, 0.28), sr = rr(0.2, 0.55), sc = rr(0.75, 1.25);
    const la = rnd() * TAU, lm = rr(0, 0.11), full = rr(0.55, 1.3) * dens;
    const stem = (s, h) => { const a = ph + s * TAU / strands + h * tw, r = sr * (1 - 0.6 * h / H), ln = lm * h * h / H; return [x + cos(a) * r + cos(la) * ln, z + sin(a) * r + sin(la) * ln, a]; };
    for (let s = 0; s < strands; s++) for (let h = 0; h < H - 1; h += 1.7) { const p = stem(s, h); leaf(big, p[0], y + h, p[1], 2.1, p[2] + PI / 2, 0.1, 0.17, h, 1, rnd(), rnd(), 0.3); }
    const n = floor(H * 26 * full);
    for (let i = 0; i < n; i++) {
      const t = pow(rnd(), 0.9), h = t * H, p = stem((rnd() * strands) | 0, h);
      const L = ((0.55 + 0.75 * rnd() * rnd()) * (1 - 0.5 * t * t) * sc + 0.25) * (kind === 1 ? 1.2 : 1.15);
      const tilt = mix(rr(0.4, 1.0), rr(0.15, 0.45), t);
      const type = kind === 1 ? (rnd() < 0.8 ? 3 : 4) : kind === 2 ? (rnd() < 0.5 ? 4 : 0) : 0;
      leaf(big, p[0], y + h, p[1], L, rnd() * TAU, tilt, L * (kind === 1 ? rr(0.09, 0.13) : rr(0.15, 0.21)) + 0.03, h, type, rnd(), rnd(), rr(0.38, 0.95));
    }
    // light absorption footprint for the skylight bake
    const hx = round((wrapT(x) - OX) / VS / 2) % (NX / 2), hz = round((wrapT(z) - OZ) / VS / 2) % (NZ / 2);
    for (let hy = floor((y - OY) / VS / 2); hy <= floor((y + H - OY) / VS / 2); hy++) if (hy >= 0 && hy < NY / 2) kelpAbs[hx + NX / 2 * (hy + NY / 2 * hz)] += 0.17;
  };
  // kelp forests: x, z, radius, density
  const KELPZ = [[-120, -110, 42, 1], [-20, -10, 36, 1], [-110, 95, 40, 0.9], [130, -85, 36, 0.9], [60, -140, 30, 0.8], [-170, 10, 30, 0.7], [110, 140, 38, 0.8], [10, 105, 30, 0.7], [-30, -170, 26, 0.8], [175, 40, 26, 0.7]];
  const NOKELP = [[SHIP[0], SHIP[1], 26], [-8, -5, 7]];
  const kelpDens = (x, z) => {
    for (const p of NOKELP) if (dist2(x, z, p[0], p[1]) < p[2]) return 0;
    let d = sstep(0.55, 0.66, pfbm(x, 4, z, 0.022, 3)) * 0.3;
    for (const p of KELPZ) d = max(d, p[3] * 0.8 * sstep(p[2], p[2] * 0.7, dist2(x, z, p[0], p[1])));
    // clearings with the seabed showing, and stands of different density
    return d * (1 - 0.95 * sstep(0.48, 0.58, pfbm(x, 11, z, 0.03, 3))) * (0.45 + 0.55 * pfbm(x, 12, z, 0.07, 2));
  };
  const occ = new Set();
  rseed(2);
  const tryColumn = (x, z, kind, dens = 1) => {
    const key = floor((wrapT(x) - OX) / 3.2) * 4096 + floor((wrapT(z) - OZ) / 3.2);
    if (occ.has(key) || sandAt(x, z) > 0.5) return;
    const f = floorsAt(x, z); const c = [];
    for (let i = 0; i < f.length; i += 2) if (f[i + 1] > 8) c.push(i);
    if (!c.length) return;
    const i = c[(rnd() * c.length) | 0], y = f[i];
    if (grad(x, y, z)[1] < 0.55 || nearPose(x, z, 5)) return;
    occ.add(key);
    column(x, y - 0.3, z, min(f[i + 1] - rr(0.6, 2.5), rnd() < 0.3 ? rr(5, 12) : rr(13, 28)), kind, dens * rr(0.6, 1.1));
  };
  for (let i = 0; i < 40000; i++) {
    const x = rr(OX, OX + PER), z = rr(OZ, OZ + PER);
    if (rnd() < kelpDens(x, z)) tryColumn(x, z, rnd() < 0.18 ? 1 : rnd() < 0.05 ? 2 : 0);
  }

  // --- clusters of ribbon leaves on the ground
  const cluster = (x, y, z, n, type, lmin, lmax, wmin, wmax, tmax, sway) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, r = rnd() * 0.5, L = rr(lmin, lmax);
      leaf(big, x + cos(a) * r, y - 0.15, z + sin(a) * r, L, a, rr(0.05, tmax), rr(wmin, wmax), sway, type, rnd(), rnd(), rr(0.3, 0.8));
    }
  };
  const hot = (x, z) => { let h = 0.3; for (const p of KELPZ) h = max(h, p[3] * sstep(p[2] * 1.2, p[2] * 0.5, dist2(x, z, p[0], p[1]))); return h; };
  rseed(3);
  for (let i = 0; i < 90000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1], sa = T.vs[k / 3];
    if (y > -3 || sa > 0.5 || nearPose(x, z, 6)) continue;
    const h = hot(x, z), u = rnd();
    if (ny > 0.6 && u < 0.10 * h) cluster(x, y, z, 6 + rnd() * 10 | 0, rnd() < 0.7 ? 3 : 4, 0.8, 2.2, 0.12, 0.22, 0.8, 1.5);
    else if (ny < -0.35 && u < 0.35) { // red algae hanging from overhangs
      const n = 10 + rnd() * 16 | 0;
      for (let j = 0; j < n; j++) leaf(big, x + rr(-0.6, 0.6), y + 0.2, z + rr(-0.6, 0.6), rr(0.5, 2.0), rnd() * TAU, PI - rr(0, 0.4), rr(0.06, 0.14), 0, 6, rnd(), rnd(), rr(0.3, 0.6));
    } else if (ny > -0.2 && ny < 0.8 && u < 0.05) { // tufts on rock walls
      const yaw = atan2(T.wn[k + 2], T.wn[k]), n = 4 + rnd() * 6 | 0;
      for (let j = 0; j < n; j++) leaf(big, x, y, z, rr(0.4, 1.1), yaw + rr(-0.9, 0.9), rr(0.3, 1.1), rr(0.05, 0.1), 0.5, rnd() < 0.5 ? 3 : 7, rnd(), rnd(), rr(0.2, 0.6));
    }
  }
  // --- sea grass meadows on the sand, short turf on the rock
  rseed(5);
  for (let i = 0; i < 900000; i++) {
    const k = pickV(), ny = T.wn[k + 1];
    if (ny < 0.72) continue;
    const x = T.wp[k] + rr(-0.75, 0.75), z = T.wp[k + 2] + rr(-0.75, 0.75), y = T.wp[k + 1], sa = T.vs[k / 3];
    if (nearPose(x, z, 1.5) || y > -2) continue;
    const meadow = sstep(0.46, 0.56, pfbm(x, 5, z, 0.014, 3)) * sstep(0.4, 0.8, sa), u = rnd();
    if (u < meadow * 0.6) { // a bushy clump
      const bl = 16 + (rnd() * 10 | 0), ln = rr(0.4, 0.95);
      for (let j = 0; j < bl; j++) leaf(small, x + rr(-0.16, 0.16), y - 0.04, z + rr(-0.16, 0.16), ln * rr(0.55, 1.25), rnd() * TAU, rr(0.04, 0.4), rr(0.03, 0.055), 0, 2, rnd(), rnd(), rr(0.3, 0.7));
    } else if (sa < 0.4 && u < 0.2 * sstep(0.45, 0.6, pfbm(x, 9, z, 0.05, 2))) {
      for (let j = 0; j < 7; j++) leaf(small, x + rr(-0.15, 0.15), y - 0.05, z + rr(-0.15, 0.15), rr(0.15, 0.45), rnd() * TAU, rr(0.1, 0.9), rr(0.03, 0.06), 0, rnd() < 0.5 ? 5 : 7, rnd(), rnd(), rr(0.3, 0.8));
    }
  }

  // --- sponges and corals on rock: scattered singles, then gardens
  const spots = [];
  const PIECE = (kind) => { // mesh, mat, scale for a coral garden (0) or a sponge garden (1)
    const u = rnd();
    if (kind === 0) return u < 0.34 ? [7, 5, rr(0.5, 1.5)] : u < 0.5 ? [10, 5, rr(0.5, 1.3)] : u < 0.68 ? [26, 5, rr(0.5, 1.3)] : u < 0.86 ? [8, 5, rr(0.5, 1.4)] : [9, 4, rr(0.4, 1)];
    return u < 0.3 ? [4, 4, rr(0.35, 1)] : u < 0.55 ? [5, 4, rr(0.35, 0.9)] : u < 0.72 ? [6, 4, rr(0.4, 1)] : u < 0.85 ? [9, 4, rr(0.4, 1)] : [27, 5, rr(0.6, 1.5)];
  };
  const place = (n0, ny, nz, nx, p, mesh, mat, sc, sd) => {
    const l = hypot(nx, ny + 0.9, nz), ux = nx / l, uy = (ny + 0.9) / l, uz = nz / l;
    solid(mesh, p[0] - ux * 0.1 * sc, p[1] - uy * 0.1 * sc, p[2] - uz * 0.1 * sc, sc, qMul(qFromY(ux, uy, uz), qAxis(0, 1, 0, rnd() * TAU)), mat, sd, 1, 0);
  };
  rseed(6);
  for (let i = 0; i < 20000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (y > -4 || ny < -0.15 || T.vs[k / 3] > 0.35 || rnd() > 0.5 * hot(x, z) + 0.12 || nearPose(x, z, 2)) continue;
    const n0 = [T.wn[k], ny, T.wn[k + 2]], [t1, t2] = tangent(n0), cnt = 2 + rnd() * 5 | 0, sd = rnd(), kind = rnd() < 0.55 ? 0 : 1;
    for (let j = 0; j < cnt; j++) {
      const a = rr(-1, 1) * (0.5 + cnt * 0.13), b = rr(-1, 1) * (0.5 + cnt * 0.13);
      const s = snap(x + t1[0] * a + t2[0] * b, y + t1[1] * a + t2[1] * b, z + t1[2] * a + t2[2] * b, n0);
      if (!s) continue;
      const [mesh, mat, sc] = PIECE(kind);
      place(n0, s[4], s[5], s[3], s, mesh, mat, sc, fract(sd + rr(-0.03, 0.03)));
    }
    if (kind === 1 && rnd() < 0.3) spots.push([x + n0[0], y + n0[1] + 0.5, z + n0[2]]);
  }
  // gardens: a few dozen dense patches. Rock vertices are bucketed in 8 m squares to find the ones around a centre.
  const GB = 48, gbk = Array.from({ length: GB * GB }, () => []);
  for (let k = 0; k < T.nv; k++) if (T.vs[k] < 0.3 && T.wn[k * 3 + 1] > -0.1 && T.wp[k * 3 + 1] > -17 && T.wp[k * 3 + 1] < -2.5) gbk[(floor((wrapT(T.wp[k * 3]) - OX) / 8) % GB) + GB * (floor((wrapT(T.wp[k * 3 + 2]) - OZ) / 8) % GB)].push(k * 3);
  rseed(7);
  let gardens = 0;
  for (let t = 0; t < 4000 && gardens < 64; t++) {
    const c = gbk[(rnd() * GB * GB) | 0]; if (c.length < 40) continue;
    const k0 = c[(rnd() * c.length) | 0], cx = T.wp[k0], cz = T.wp[k0 + 2], R = rr(4, 8), kind = rnd() < 0.5 ? 0 : 1, want = floor(R * R * rr(2.5, 4.5));
    if (nearPose(cx, cz, R)) continue;
    const near = []; // vertices within R of the centre
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      const bx = (floor((wrapT(cx) - OX) / 8) + gx + GB) % GB, bz = (floor((wrapT(cz) - OZ) / 8) + gz + GB) % GB;
      for (const k of gbk[bx + GB * bz]) if (dist2(T.wp[k], T.wp[k + 2], cx, cz) < R) near.push(k);
    }
    if (near.length < 12) continue;
    gardens++;
    const sd = rnd();
    for (let m = 0; m < want; m++) {
      const k = near[(rnd() * near.length) | 0], x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
      const [mesh, mat, sc] = PIECE(kind);
      place(null, T.wn[k + 1], T.wn[k + 2], T.wn[k], [x + rr(-0.3, 0.3), y, z + rr(-0.3, 0.3)], mesh, mat, sc, fract(sd + rr(-0.05, 0.05)));
    }
  }
  // --- mini reefs: boulder heaps crusted with coral and sponge, with grass about them, spread over the sand so every view has a landmark
  rseed(15);
  const MR = [];
  for (let t = 0; t < 60000 && MR.length < 150; t++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (T.wn[k + 1] < 0.9 || y > -8 || y < -24 || nearPose(x, z, 8) || dist2(x, z, SHIP[0], SHIP[1]) < 14) continue;
    if (MR.some((p) => dist2(x, z, p[0], p[1]) < 30)) continue;
    MR.push([x, z]);
    const nb = 5 + (rnd() * 5 | 0), top = [];
    for (let b = 0; b < nb; b++) {
      const a = rnd() * TAU, r = rnd() * 2.2, sc = rr(0.9, 2.3), bx = x + cos(a) * r, bz = z + sin(a) * r, by = gy(bx, bz) + sc * (0.2 + 0.35 * rnd());
      solid(rnd() * 4 | 0, bx, by, bz, sc, qRand(), 1, rnd(), 1, 0); top.push([bx, by + sc * 0.6, bz, sc]);
    }
    const sd = rnd(), kind = rnd() < 0.6 ? 0 : 1;
    for (let m = 0; m < 34; m++) {
      const q = top[(rnd() * top.length) | 0], a = rnd() * TAU, r = rnd() * q[3] * 0.6;
      const [mesh, mat, sc] = PIECE(kind), px = q[0] + cos(a) * r, pz = q[2] + sin(a) * r;
      place(null, 1, 0, 0, [px, rnd() < 0.5 ? q[1] + rr(-0.4, 0.1) : gy(px, pz), pz], mesh, mat, sc, fract(sd + rr(-0.05, 0.05)));
    }
    for (let m = 0; m < 10; m++) { const a = rnd() * TAU, r = rr(2, 5), px = x + cos(a) * r, pz = z + sin(a) * r, py = gy(px, pz); for (let j = 0; j < 14; j++) leaf(small, px + rr(-0.2, 0.2), py - 0.04, pz + rr(-0.2, 0.2), rr(0.4, 0.9), rnd() * TAU, rr(0.04, 0.4), rr(0.03, 0.055), 0, 2, rnd(), rnd(), rr(0.3, 0.7)); }
    for (let m = 0; m < 2; m++) { const a = rnd() * TAU, px = x + cos(a) * 2.5, pz = z + sin(a) * 2.5, f = floorsAt(px, pz); if (f.length) column(px, f[f.length - 2] - 0.3, pz, rr(4, 9), 0, 0.5); }
  }
  // --- rocks: boulders lying about, then rubble, then pebbles and shells on the sand
  rseed(8);
  for (let i = 0; i < 4000; i++) {
    const k = pickV(); if (T.wn[k + 1] < 0.6 || T.wp[k + 1] > -2 || nearPose(T.wp[k], T.wp[k + 2], 6) || rnd() > 0.28) continue;
    const sc = (rnd() < 0.1 ? rr(1.4, 2.6) : rr(0.3, 1.2)) * (T.vs[k / 3] > 0.5 ? 0.6 : 1), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], sd = rnd();
    solid(rnd() * 4 | 0, x, y + sc * 0.15, z, sc, qRand(), 1, sd, 1, 0);
    if (sc > 0.9) for (let j = 0; j < 6; j++) solid(rnd() * 4 | 0, x + rr(-1.6, 1.6) * sc, y + sc * 0.1 + rr(0, 0.3), z + rr(-1.6, 1.6) * sc, rr(0.12, 0.4), qRand(), 1, sd, 1, 0);
  }
  rseed(10);
  for (let i = 0; i < 60000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (y > -3 || (ny > 0.8 && rnd() < 0.7) || T.vs[k / 3] > 0.6 || nearPose(x, z, 3.5)) continue;
    const sc = (0.3 + 1.8 * pow(rnd(), 2.6)) * (ny > 0.8 ? 0.5 : 1), q = qRand();
    chunks[(sc > 1.1 ? 3 : 0) + (rnd() * 3 | 0)][cellOf(x, z)].push(x - T.wn[k] * sc * 0.3, y - ny * sc * 0.3, z - T.wn[k + 2] * sc * 0.3, sc, q[0], q[1], q[2], q[3], 1, rnd(), sc > 1.1 ? 0 : 96, 0);
  }
  rseed(11);
  for (let i = 0; i < 260000; i++) { // pebbles, shells and rubble
    const k = pickV(), x = T.wp[k] + rr(-0.4, 0.4), z = T.wp[k + 2] + rr(-0.4, 0.4), y = T.wp[k + 1];
    if (T.wn[k + 1] < 0.8 || nearPose(x, z, 1.3) || (T.vs[k / 3] > 0.6 && rnd() < 0.85 - 0.8 * sstep(0.5, 0.62, pfbm(x, 14, z, 0.05, 2)))) continue;
    const sc = 0.04 + 0.22 * pow(rnd(), 2.4), q = qRand();
    nth++ % THIN || chunks[6][cellOf(x, z)].push(wrapT(x), y - sc * 0.3, wrapT(z), sc, q[0], q[1], q[2], q[3], 1, rnd(), 44, 0);
  }
  // --- the wreck, on its sand shelf
  const shipY = gy(SHIP[0], SHIP[1]) + 7.6;
  solid(11, SHIP[0], shipY, SHIP[1], 1, qMul(qAxis(0, 1, 0, 0.5), qMul(qAxis(0, 0, 1, -0.07), qAxis(1, 0, 0, 0.2))), 3, 0.5, 1, 0);
  rseed(12);
  for (let i = 0; i < 40; i++) { // debris and rubble around it
    const a = rnd() * TAU, r = rr(8, 22), x = SHIP[0] + cos(a) * r, z = SHIP[1] + sin(a) * r;
    solid(rnd() * 4 | 0, x, gy(x, z) + 0.1, z, rr(0.3, 1.1), qRand(), 1, rnd(), 1, 0);
  }

  // --- bubbles from vents in the sand
  const VENTS = [];
  rseed(13);
  for (let i = 0; i < 14; i++) { const k = pickV(); if (T.vs[k / 3] > 0.5 && T.wn[k + 1] > 0.9) VENTS.push([T.wp[k], T.wp[k + 1], T.wp[k + 2]]); }
  for (const s of spots) if (rnd() < 0.15) VENTS.push(s);
  for (const v of VENTS) {
    const n = 60 + rnd() * 50 | 0, y0 = v[1];
    for (let i = 0; i < n; i++) {
      const sz = rnd() < 0.24 ? rr(0.05, 0.14) : rr(0.012, 0.04);
      bubbles.push(v[0] + rr(-0.2, 0.2), y0, v[2] + rr(-0.2, 0.2), sz, rnd(), rr(1.1, 2.4) * (0.6 + sz * 5), -y0 - 0.2, rr(0.05, 0.16));
    }
  }

  // --- pack leaves (36 bytes: 8 floats + 4 unorm8), sorted by culling cell
  const pack = (L, step = 1, wm = 1) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += Math.ceil(L[c].length / 12 / step); }
    start[nCells] = n;
    const buf = new ArrayBuffer(n * 36), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12 * step, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      f[k * 9 + 6] *= wm;
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };

  // --- half-res volume (wraps in x and z): r = openness, g = skylight
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz), tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[(x > 0 ? i - 1 : i + hx - 1)] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i - hx + 1]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, b = (tmp[z > 0 ? i - hx : i + hx * (hz - 1)] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i - hx * (hz - 1)]) * 0.25;
      const x1 = (x * 2 + 1) % NX, z1 = (z * 2 + 1) % NZ, y0 = y * 2, y1 = y * 2 + 1;
      const d = (D[gi(x * 2, y0, z * 2)] + D[gi(x1, y0, z * 2)] + D[gi(x * 2, y1, z * 2)] + D[gi(x1, y1, z * 2)] + D[gi(x * 2, y0, z1)] + D[gi(x1, y0, z1)] + D[gi(x * 2, y1, z1)] + D[gi(x1, y1, z1)]) * 0.125;
      const o = x + hx * (y + hy * z);
      const l = b * clamp(0.5 - d / 1.5, 0, 1) * (1 - min(kelpAbs[o], 0.5));
      Ln[i] = l;
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255; volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- ground map (wraps): r sand, a patchiness
  const gm = new Uint8Array(512 * 512 * 4);
  for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
    const x = (i + 0.5) / 512 * PER + OX, z = (j + 0.5) / 512 * PER + OZ, o = (i + 512 * j) * 4;
    gm[o] = sandAt(x, z) * 255; gm[o + 3] = sstep(0.42, 0.6, pfbm(x, 3, z, 0.04, 3)) * 255;
  }

  // --- fish schools + mantas (the fauna pieces replace these)
  const fish = [];
  rseed(14);
  for (let s = 0; s < 16; s++) {
    const x = rr(OX, OX + PER), z = rr(OZ, OZ + PER), y = rr(-14, -6), R = rr(10, 22), n = 200 + rnd() * 200 | 0, spd = 0.3 * rr(0.9, 1.1), dir = rnd() < 0.5 ? 1 : -1, ss_ = rnd();
    for (let i = 0; i < n; i++) fish.push(x, y, z, R, rnd(), dir * 1.9 / R, spd, ss_);
  }
  const mantas = [];
  for (let m = 0; m < 5; m++) mantas.push(rr(OX, OX + PER), rr(-12, -8), rr(OZ, OZ + PER), rr(26, 46), rnd() * 6, (rnd() < 0.5 ? 1 : -1) * rr(0.045, 0.085), rr(2.4, 3.4), rnd());

  // --- drifting particles
  const snow = new Float32Array(9000 * 4);
  for (let i = 0; i < snow.length; i++) snow[i] = rnd();

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < 12; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(n * 12), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 3); hi[c] = max(hi[c], a[i + 1] + 3); } }
    return { data, n, start, lo, hi };
  };
  return { gy, chunks: chunks.map(packC), props: PROP_IDS.map((id) => packC(props[id])), big: pack(big), bigF: pack(big, 2, 1.5), small: pack(small), solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, bubbles: new Float32Array(bubbles), volD, gm, fish: new Float32Array(fish), mantas: new Float32Array(mantas), snow, shipPos: [SHIP[0], shipY, SHIP[1]] };
}

// ---------------------------------------------------------------- procedural meshes
function meshChunk(sd, sub = 2, det = sub > 2) {
  if (LV > 1 && sub > 1) sub--; // Low: a quarter of the triangles
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < 4; i++) { const q = qRand(); pl.push([q[0], q[1], q[2], rr(0.8, 0.98)]); const l = hypot(q[0], q[1], q[2]) || 1; pl[i][0] /= l; pl[i][1] /= l; pl[i][2] /= l; }
  return icosphere(sub, (x, y, z) => {
    let r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - 0.5) * 0.9 + (det ? (fbm(x * 4 + sd, y * 4, z * 4, 2) - 0.5) * 0.25 : 0);
    let px = x * r, py = y * r * 0.8, pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
function meshLathe(prof, seg, lump, ribs = 0) {
  const m = new Mesh(), rings = [];
  for (const [r, h, ao] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU, rl = r * (1 + lump * (fbm(cos(a) * 1.5 + h * 2, h * 3, sin(a) * 1.5, 2) - 0.5) + 0.07 * cos(ribs * a + h * 1.5)); ring.push(m.v(cos(a) * rl, h, sin(a) * rl, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
  return m;
}
function meshCoral(fan, lo = LV > 1) {
  rseed(200 + fan);
  const m = new Mesh();
  const nrm = (v) => { const l = hypot(...v) || 1; return v.map((c) => c / l); };
  const br = (p, d, r, len, depth) => {
    const pts = [p]; let q = p;
    for (let i = 0; i < 3; i++) { d = nrm([d[0] + rr(-0.3, 0.3), d[1] + rr(-0.1, 0.3), d[2] + (fan ? rr(-0.05, 0.05) : rr(-0.3, 0.3))]); q = [q[0] + d[0] * len / 3, q[1] + d[1] * len / 3, q[2] + d[2] * len / 3]; pts.push(q); }
    if (!depth) pts.push([q[0] + d[0] * r * 1.6, q[1] + d[1] * r * 1.6, q[2] + d[2] * r * 1.6]);
    if (lo) m.tube(depth ? [pts[0], pts[3]] : [pts[0], pts[3], pts[4]], (k) => (k > 1 ? r * 0.36 : r * (1 - 0.22 * k)) * 1.25, 3, true, (k) => clamp(1 - (depth + 1 - k) / 5, 0, 1));
    else m.tube(pts, (k) => k > 3 ? r * 0.36 : r * (1 - 0.22 * k / 3), fan ? 5 : 6, true, (k) => clamp(1 - (depth + 1 - k / 3) / 5, 0, 1));
    if (depth > 0) { const n = 2 + (rnd() < 0.5); for (let i = 0; i < n; i++) br(q, nrm([d[0] + rr(-0.8, 0.8), d[1] + rr(-0.1, 0.5), d[2] + (fan ? rr(-0.08, 0.08) : rr(-0.8, 0.8))]), r * 0.78, len * 0.8, depth - 1); }
  };
  const n0 = fan ? 1 : 2 + (rnd() * 2 | 0);
  for (let i = 0; i < n0; i++) br([rr(-0.08, 0.08), 0, rr(-0.08, 0.08)], nrm([rr(-0.5, 0.5), 1, fan ? 0 : rr(-0.5, 0.5)]), fan ? 0.06 : 0.08, fan ? 0.5 : 0.45, 3);
  return m;
}
function meshTubes() {
  rseed(210);
  const m = new Mesh();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, r0 = rr(0, 0.28), h = rr(0.45, 1.1), rad = rr(0.07, 0.12), lean = rr(0.05, 0.3), pts = [];
    for (let k = 0; k <= 4; k++) pts.push([cos(a) * (r0 + lean * k / 4 * h), h * k / 4, sin(a) * (r0 + lean * k / 4 * h)]);
    m.tube(pts, (k) => rad * (0.8 + 0.25 * k / 4), 12, false, (k) => 0.35 + 0.65 * k / 4);
    // rim + dark throat
    const e = pts[4], n = m.p.length / 3, c = m.v(e[0], e[1] - rad * 1.2, e[2], 0.05);
    for (let s2 = 0; s2 < 12; s2++) m.tri(n - 12 + s2, n - 12 + (s2 + 1) % 12, c);
  }
  return m;
}
// sunken ship (bow at +x): keel with stem and stern posts, curved ribs, hull planking with a breach,
// raised stern castle with transom, deck remnants, two masts with yards, bowsprit
function meshShip() {
  rseed(220);
  const m = new Mesh(), Lh = 17, B = 5.6, Dp = 7.6;
  const hb = (x) => B * pow(max(1 - pow(abs(x / Lh), x < 0 ? 3.6 : 2.6), 0), 0.5);
  const dp = (x) => Dp * (1 - 0.36 * pow(abs(x / Lh), 2.5));
  const sheer = (x) => 0.5 + (x > 0 ? 3.0 : 3.8) * pow(abs(x / Lh), 2.2);
  const pt = (x, ph, off = 0) => { const b = hb(x) + off, d = dp(x) + off, s = sheer(x); return [x, s - (d + s) * pow(max(cos(ph), 0), 0.66), b * Math.sign(ph) * pow(abs(sin(ph)), 0.8)]; };
  const out = (p) => { const l = hypot(p[1] + 0.5, p[2] * 1.3) || 1; return [0, (p[1] + 0.5) / l, p[2] * 1.3 / l]; };
  const up = () => [0, 1, 0];
  const keel = [];
  for (let i = 0; i <= 44; i++) { const x = mix(-Lh - 1.0, Lh + 2.4, i / 44), e = max(abs(x) / Lh - 0.78, 0) * 4.2; keel.push([x, -dp(clamp(x, -Lh, Lh)) - 0.3 + e * e * e * 4.2, 0]); }
  m.sweep(keel, 0.55, 0.95, up);
  for (let x = -Lh + 0.7; x < Lh - 0.3; x += 0.8) {
    const a0 = rnd() < 0.1 ? rr(-0.9, -0.2) : -PI / 2, a1 = rnd() < 0.1 ? rr(0.2, 0.9) : PI / 2, pts = [];
    for (let i = 0; i <= 16; i++) pts.push(pt(x, mix(a0, a1, i / 16)));
    m.sweep(pts, 0.24, 0.3, out);
  }
  const holeX = rr(-6, 2), holeS = rnd() < 0.5 ? 1 : -1;
  const BR = [[holeX, holeS * 0.8, 3.2, 0.42], [7, -holeS * 0.95, 2.4, 0.34], [12, holeS * 0.5, 1.7, 0.28], [-11, -holeS * 0.55, 2.1, 0.3]];
  const holed = (x, ph) => { for (const h of BR) { const a = (x - h[0]) / h[2], b = (ph - h[1]) / h[3]; if (a * a + b * b < 1 + 0.45 * sin(x * 3.1 + ph * 9)) return true; } return false; };
  const NS = 14, xs = []; for (let x = -Lh + 0.35; x <= Lh - 0.3; x += 0.85) xs.push(x);
  for (let j = 0; j < NS; j++) {
    const p0 = mix(-1.5, 1.5, j / NS), p1 = mix(-1.5, 1.5, (j + 1) / NS), sg = p0 + p1 < 0 ? -1 : 1, lo = sg < 0 ? p1 : p0, hi = sg < 0 ? p0 : p1;
    let pv = null;
    for (const x of xs) {
      const cu = [m.v(...pt(x, lo, 0.27)), m.v(...pt(x, hi, 0.14)), m.v(...pt(x, lo, 0.1)), m.v(...pt(x, hi, 0.1))];
      if (pv && !holed(x - 0.42, (p0 + p1) / 2)) {
        if (sg > 0) { m.quad(pv[0], pv[1], cu[1], cu[0]); m.quad(pv[2], cu[2], cu[3], pv[3]); }
        else { m.quad(pv[0], cu[0], cu[1], pv[1]); m.quad(pv[2], pv[3], cu[3], cu[2]); }
      }
      pv = cu;
    }
  }
  for (const sgn of [-1, 1]) {
    let pts = []; for (let x = -Lh + 0.6; x <= Lh - 0.6; x += 1) pts.push(pt(x, sgn * PI / 2, 0.2)); m.sweep(pts, 0.3, 0.28, up);
    // stern castle bulwarks
    for (let j = 0; j < 3; j++) { pts = []; for (let x = -Lh + 0.4; x <= -Lh + 8.5 - j; x += 0.9) pts.push([x, sheer(x) + 0.55 + j * 0.86, sgn * (max(hb(x), 2.6) + 0.15)]); m.sweep(pts, 0.82, 0.09, () => [0, 0, sgn]); }
  }
  // transom
  for (let y = -3; y < sheer(-Lh) + 3; y += 0.86) { const w = max(1.2, 2.9 * sstep(-4.5, 1.5, y)); if (rnd() < 0.9) m.sweep([[-Lh + 0.35, y, -w], [-Lh + 0.35, y, w]], 0.82, 0.1, () => [1, 0, 0]); }
  for (let x = -Lh + 2; x < Lh - 2; x += rr(1.8, 3.2)) m.sweep([[x, sheer(x) - 0.25, -hb(x)], [x, sheer(x) - 0.2, 0], [x, sheer(x) - 0.25, hb(x)]], 0.26, 0.26, up);
  for (let z = -3.9; z <= 3.9; z += 0.62) { let x = -Lh + rr(1, 5); while (x < Lh - 4) { const x1 = min(x + rr(3, 9), Lh - 3.5); if (rnd() < 0.6) { const pts = []; for (let xx = x; xx <= x1; xx += 1) if (hb(xx) > abs(z) + 0.3) pts.push([xx, sheer(xx) - 0.05, z]); if (pts.length > 1) m.sweep(pts, 0.56, 0.07, up); } x = x1 + rr(0.5, 3); } }
  // foremast with yard, broken main mast, bowsprit
  m.sweep([[7, -Dp + 0.6, 0], [7.1, 1, 0], [7.25, 5, 0.2], [7.4, 9.5, 0.4]], (k) => 0.62 - k * 0.1, (k) => 0.62 - k * 0.1, () => [1, 0, 0]);
  m.sweep([[7.3, 6.8, -5.2], [7.3, 6.9, 0.3], [7.3, 6.5, 5.6]], 0.26, 0.26, up);
  m.sweep([[-3, -Dp + 0.6, 0], [-3.2, 1, 0.2], [-3.9, 6, 1.0], [-5.2, 9.5, 2.6]], (k) => 0.74 - k * 0.1, (k) => 0.74 - k * 0.1, () => [1, 0, 0]);
  m.sweep([[Lh + 1.4, 2.6, 0], [Lh + 8, 5.2, 0.2]], 0.34, 0.34, up);
  return m;
}
// manta ray: span along x (half span = 1), nose +z; aux = span coordinate for the flap animation
function meshManta() {
  const m = new Mesh(), NU = 72, M = 22, rings = [];
  for (let j = 0; j <= NU; j++) {
    const u = j / NU * 2 - 1, au = abs(u);
    let zl = 0.52 - 0.74 * pow(au, 1.35) + 0.07 * exp(-pow((au - 0.13) / 0.05, 2)) - 0.05 * exp(-pow(au / 0.05, 2)) - 0.08 * pow(au, 5);
    const zt = -0.5 + 0.3 * pow(au, 0.8) + 0.02 - 0.08 * pow(au, 5);
    if (zl < zt + 0.004) zl = zt + 0.004;
    const th = 0.08 * pow(1 - au, 1.15) + 0.004 + 0.12 * exp(-pow(u / 0.2, 2)), ring = [];
    for (let k = 0; k < M; k++) { const a = k / M * TAU; ring.push(m.v(u, th * sin(a) * (0.62 + 0.38 * cos(a)), mix(zt, zl, 0.5 + 0.5 * cos(a)), u)); }
    rings.push(ring);
  }
  for (let j = 0; j < NU; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  const tail = []; for (let i = 0; i <= 8; i++) tail.push([0, 0, -0.42 - i * 0.19]);
  const n0 = m.p.length / 3;
  m.tube(tail, (k) => 0.016 * (1 - k / 9), 4, true);
  for (let k = n0; k < m.aux.length; k++) m.aux[k] = 0;
  for (const sx of [-1, 1]) { // cephalic fins
    const n1 = m.p.length / 3;
    m.tube([[sx * 0.12, -0.02, 0.48], [sx * 0.135, -0.05, 0.6], [sx * 0.115, -0.09, 0.69], [sx * 0.085, -0.125, 0.74]], (k) => 0.045 * (1 - k / 4.4), 6, true);
    for (let k = n1; k < m.aux.length; k++) m.aux[k] = sx * 0.1;
  }
  return m;
}
function meshFish() {
  const m = new Mesh();
  const X = [0.5, 0.3, 0.05, -0.22, -0.34], H = [0.01, 0.13, 0.17, 0.09, 0.035], Wd = [0.01, 0.05, 0.065, 0.03, 0.012], rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(X[i], sin(a) * H[i], cos(a) * Wd[i])); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  const a = m.v(-0.33, 0, 0), b = m.v(-0.56, 0.2, 0), c = m.v(-0.47, 0, 0), d = m.v(-0.56, -0.2, 0);
  m.tri(a, b, c); m.tri(a, c, d);
  return m;
}

// table coral: a wide wavy plate on a short stalk
function meshTable() { return meshLathe([[0, 0, 0.4], [0.1, 0, 0.5], [0.09, 0.3, 0.7], [0.14, 0.44, 0.8], [0.55, 0.5, 1], [0.95, 0.56, 1], [0.88, 0.62, 0.9], [0.4, 0.6, 0.55], [0, 0.58, 0.4]], 22, 0.3, 0); }
// brain / boulder coral: a grooved dome
function meshBrain() { return meshLathe([[0, 0, 0.4], [0.5, 0, 0.6], [0.64, 0.18, 0.9], [0.58, 0.5, 1], [0.34, 0.72, 1], [0, 0.78, 1]], 24, 0.14, 18); }
// encrusting sponge / massive coral: a low lumpy mound
function meshMound() { return meshLathe([[0, 0, 0.4], [0.7, 0, 0.6], [0.9, 0.18, 0.9], [0.78, 0.46, 1], [0.46, 0.62, 0.9], [0, 0.66, 0.7]], 16, 0.45, 0); }
