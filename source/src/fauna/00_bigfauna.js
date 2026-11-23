// ============================================================================
// shared helpers of the big fauna (dolphins.js, rays.js)
// ============================================================================
// Own random streams (the world generator's rnd() must not be disturbed), the seabed under a point, and mesh building
// with welded normals. Everything the animals do on the torus works on wrapD() differences and wrapT() positions.
const bfRng = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const bfClamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bfSS = (a, b, x) => { const t = bfClamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bfMis = { ms: 0, n: 0 };    // CPU time of the animals' update (test hook __big.cost())
// y of the first rock or sand below (x, yTop, z): sampled from the collision bricks every 0.4 m, refined by linear interpolation
function bfGround(x, z, yTop) {
  let prev = sdAt(x, yTop, z);
  if (prev > 0) return yTop;
  for (let y = yTop - 0.4; y > OY; y -= 0.4) {
    const s = sdAt(x, y, z);
    if (s > 0) return y + 0.4 * s / (s - prev);
    prev = s;
  }
  return OY;
}
// ground map channels of the world (world.js): 0 sand, 1 floor height
const bfMap = (x, z, ch) => MAP[((floor((wrapT(x) - OX) / VS) & (NX - 1)) + NX * (floor((wrapT(z) - OZ) / VS) & (NZ - 1))) * 4 + ch];
// is the segment from (x0,y0,z0) along (dx,dy,dz) free of rock for len metres (stepped every 1.5 m)?
function bfFree(x, y, z, dx, dy, dz, len, clear = 0.5) {
  for (let d = 1; d <= len + 0.01; d += 1) if (sdAt(x + dx * d, y + dy * d, z + dz * d) > -clear) return false;
  return true;
}
// a puff of sand / silt: n sediment particles in a ring of radius r (the shared particle pool of lauv.js)
function bfPuff(x, y, z, r, n, up, size) {
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + rr(0, 0.5), d = r * rr(0.2, 1), s = rr(0.25, 0.7);
    lauvEmit(x + cos(a) * d, y + rr(0, 0.1), z + sin(a) * d, size * rr(0.7, 1.3), 1, cos(a) * s, up * rr(0.3, 1), sin(a) * s, rr(3, 5.5), 0.9);
  }
}
// triangle mesh with all coincident vertices welded for the normals (rings that close on themselves, seams between parts);
// m: Mesh from math.js; returns vertices (pos f32x3, normal snorm8x3, aux snorm8) and indices; flips parts that come out inside-out
function bfBuild(m, flipTest) {
  const n = m.p.length / 3, P = m.p, I = m.i, N = new Float64Array(n * 3), key = new Map(), rep = new Int32Array(n);
  for (let k = 0; k < n; k++) { const q = round(P[k * 3] * 2e4) + ',' + round(P[k * 3 + 1] * 2e4) + ',' + round(P[k * 3 + 2] * 2e4); let r = key.get(q); if (r === undefined) { r = k; key.set(q, k); } rep[k] = r; }
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [I[t], I[t + 1], I[t + 2]]) { const r = rep[k] * 3; N[r] += nx; N[r + 1] += ny; N[r + 2] += nz; }
  }
  // inside-out? (normals against the direction from the part's centre)
  let cx = 0, cy = 0, cz = 0; for (let k = 0; k < n; k++) { cx += P[k * 3]; cy += P[k * 3 + 1]; cz += P[k * 3 + 2]; } cx /= n; cy /= n; cz /= n;
  let dot = 0; for (let k = 0; k < n; k++) { const r = rep[k] * 3; dot += N[r] * (P[k * 3] - cx) + N[r + 1] * (P[k * 3 + 1] - cy) + N[r + 2] * (P[k * 3 + 2] - cz); }
  const flip = flipTest ? flipTest(dot) : dot < 0;
  const vb = new ArrayBuffer(n * 16), f = new Float32Array(vb), s = new Int8Array(vb), sg = flip ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const r = rep[k] * 3, l = hypot(N[r], N[r + 1], N[r + 2]) || 1;
    f[k * 4] = P[k * 3]; f[k * 4 + 1] = P[k * 3 + 1]; f[k * 4 + 2] = P[k * 3 + 2];
    s[k * 16 + 12] = round(sg * N[r] / l * 127); s[k * 16 + 13] = round(sg * N[r + 1] / l * 127); s[k * 16 + 14] = round(sg * N[r + 2] / l * 127); s[k * 16 + 15] = round(bfClamp(m.aux[k], -1, 1) * 127);
  }
  const ib = new Uint32Array(I); if (flip) for (let t = 0; t < ib.length; t += 3) { const q = ib[t + 1]; ib[t + 1] = ib[t + 2]; ib[t + 2] = q; }
  return { vb, ib, nv: n };
}
// several built parts into one vertex / index list (indices rebased)
function bfMerge(parts) {
  let nv = 0, ni = 0; for (const p of parts) { nv += p.nv; ni += p.ib.length; }
  const vb = new Uint8Array(nv * 16), ib = new Uint32Array(ni); let v0 = 0, i0 = 0;
  for (const p of parts) { vb.set(new Uint8Array(p.vb), v0 * 16); for (let k = 0; k < p.ib.length; k++) ib[i0 + k] = p.ib[k] + v0; v0 += p.nv; i0 += p.ib.length; }
  return { vb, ib, nv, ni };
}
// ring-section loft: sections [{le:[x,y,z], te:[x,y,z], up:[x,y,z], t}] -> closed lens-shaped fin / fluke / flipper
function bfLens(sections, aux, M = 10) {
  const m = new Mesh(), rings = [];
  for (const s of sections) {
    const r = [];
    for (let k = 0; k < M; k++) {
      const a = k / M * TAU, c = 0.5 - 0.5 * cos(a), th = s.t * sin(a) * (1 - 0.25 * c);
      r.push(m.v(s.le[0] + (s.te[0] - s.le[0]) * c + s.up[0] * th, s.le[1] + (s.te[1] - s.le[1]) * c + s.up[1] * th, s.le[2] + (s.te[2] - s.le[2]) * c + s.up[2] * th, aux));
    }
    rings.push(r);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < M; k++) { const k2 = (k + 1) % M; m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k2], rings[j][k2]); }
  return m;
}
// the vehicle's pose as the animals see it: heading vectors and velocity in world axes (filled by bfVehicle())
const bfV = { x: 0, y: 0, z: 0, fx: 0, fz: -1, rx: 1, rz: 0, vx: 0, vy: 0, vz: 0, u: 0, depth: 0, yaw: 0 };
function bfVehicle() {
  const p = lv.pos, R = lv.R, u = lv.v[0];
  bfV.x = p[0]; bfV.y = p[1]; bfV.z = p[2]; bfV.u = u; bfV.depth = -p[1]; bfV.yaw = lv.yaw;
  let hx = R[0], hz = R[2]; const hl = hypot(hx, hz); if (hl > 0.2) { hx /= hl; hz /= hl; bfV.fx = hx; bfV.fz = hz; bfV.rx = -hz; bfV.rz = hx; }
  bfV.vx = R[0] * u; bfV.vy = R[1] * u; bfV.vz = R[2] * u;
}

// test hook: __big.cam(px, py, pz, tx, ty, tz) puts the camera there (looking at t) until __big.cam() is called again
{
  let dbg = null;
  (window.__big ||= {}).cam = (...a) => { dbg = a.length >= 6 ? a : null; };
  FAUNA.push({ name: 'bigfauna-cam', update() { if (dbg) lookAt(dbg[0], dbg[1], dbg[2], dbg[3], dbg[4], dbg[5]); } });
}
