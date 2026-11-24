// ============================================================================
// LAUV rigid body + DUNE-style control (plain JS, no dependencies, fixed step)
// ============================================================================
// Ported (structure, coefficients, gains) from lauv-ocean-3d/src/lauv/LauvPhysics.js and DuneControl.js, reduced to the
// underwater case. Body frame = model frame of lauv-omst.glb: +x from the tail (propeller, x = 0.02) to the nose
// (x = 1.782), +y up (mast), +z starboard. World: y up, heading psi = 0 looks to -z, grows towards +x (like the camera).
// DUNE conventions inside the controller: roll phi > 0 starboard down, pitch theta > 0 bow up, yaw clockwise from above.
const LAUV_L = 1.782, LAUV_R = 0.074, LAUV_CGX = 0.85, LAUV_CGY = -0.012, LAUV_MASS = 29.8, LAUV_RHO = 1025, LAUV_G = 9.81;
// hull radius profile (from the GLB), x from the tail
const LAUV_PROF = [[0, 0], [0.015, 0.004], [0.045, 0.009], [0.255, 0.070], [0.346, 0.074], [1.690, 0.074], [1.718, 0.069], [1.730, 0.063], [1.740, 0.058],
  [1.750, 0.050], [1.760, 0.041], [1.770, 0.027], [1.776, 0.016], [1.782, 0]];
function lauvHullR(x) {
  if (x <= 0 || x >= LAUV_L) return 0;
  for (let i = 1; i < LAUV_PROF.length; i++) if (x <= LAUV_PROF[i][0]) { const a = LAUV_PROF[i - 1], b = LAUV_PROF[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
  return 0;
}
// spheres that touch the world: x, y, z (body, metres), radius
const LAUV_SPHERES = [[0.06, 0, 0, 0.14], [0.30, 0, 0, 0.13], [0.60, 0, 0, 0.13], [0.90, 0, 0, 0.13], [1.20, 0, 0, 0.13], [1.50, 0, 0, 0.13], [1.70, 0, 0, 0.11], [1.77, 0, 0, 0.07],
  [0.245, 0, 0.14, 0.05], [0.245, 0, -0.14, 0.05], [0.245, -0.14, 0, 0.05], [0.245, 0.14, 0, 0.05], [0.65, 0.26, 0, 0.06]];   // hull radius 0.074 + a margin: the SDF is a 0.75 m voxel field
const LAUV_PARAMS = {
  netBuoy: 1.2,          // N, slightly positive buoyancy
  cdAxial: 0.30, cdCross: 0.8, k1: 0.02, ca: 1.0, mungK: 0.1,
  finArea: 0.083 * 0.08, finX: 0.245, finR: 0.11, finCLa: 3.0, finStall: 0.4, finCd0: 0.0144,
  KT0: 0.17, J0: 1.25, KQ0: 0.036, JQ: 1.5, wake: 0.10, propD: 0.122, revThrust: 0.3,
  rpmMax: 2100, rpmRev: 1200, rpmSlew: 700, tauMotor: 0.25,
  rollLin: 0.35, rollQuad: 0.06,
};
const LAUV_DUNE = {
  rollGains: [1.0, 0.5, 0.05], pitchGains: [1.5, 0, 1.1], headingGains: [1.5, 0, 0], hrateGains: [1.2, 0, 0],
  maxFinRot: 25 * PI / 180, maxPitchAct: 25 * PI / 180, maxHeadingRate: 30 * PI / 180,
  conv: { k: 0.25, m: 0.5, n: 0.5 }, servoLag: 0.12, servoRate: 140 * PI / 180,
  mpsKi: 25, mpsIntLimit: 400, minRpm: 200, maxRpm: 2100, rpmAccel: 450,
};

class LauvPID {
  constructor(g, lo, hi) { this.kp = g[0]; this.ki = g[1]; this.kd = g[2]; this.lo = lo; this.hi = hi; this.int = 0; this.prev = 0; }
  reset() { this.int = 0; this.prev = 0; }
  // err_derivative: the (negated) measured rate when there is one (DUNE DiscretePID)
  step(dt, err, dErr) {
    if (dErr === undefined) dErr = (err - this.prev) / dt;
    let c = this.kp * err + this.kd * dErr + this.int;
    if (this.hi > this.lo) c = c < this.lo ? this.lo : c > this.hi ? this.hi : c;
    this.int += this.ki * err * dt; this.prev = err; return c;
  }
}
const lauvWrap = (a) => atan2(sin(a), cos(a));

// DUNE Control/AUV/Allocator: torques (k roll, m pitch, n yaw) -> fin servos [bottom, port, starboard, top]
function lauvAllocate(k, m, n, p, out) {
  const mx = p.maxFinRot;
  let ang = n / p.conv.n * 0.5, marginV;
  if (abs(ang) > mx) { ang = ang < 0 ? -mx : mx; marginV = 0; } else marginV = mx - abs(ang);
  out[0] = -ang; out[3] = -ang;
  ang = m / p.conv.m * 0.5; let marginH;
  if (abs(ang) > mx) { ang = ang < 0 ? -mx : mx; marginH = 0; } else marginH = mx - abs(ang);
  out[1] = -ang; out[2] = -ang;
  ang = k / p.conv.k / 4; ang = clamp(ang, -marginH, marginH); ang = clamp(ang, -marginV, marginV);
  out[1] += ang; out[2] -= ang; out[0] -= ang; out[3] += ang;
  marginH -= abs(ang); marginV -= abs(ang);
  const kA = ang * p.conv.k * 4;
  ang = (k - kA) / p.conv.k * 0.5;
  if (marginH > 0) { ang = clamp(ang, -marginH, marginH); out[1] += ang; out[2] -= ang; }
  else if (marginV > 0) { ang = clamp(ang, -marginV, marginV); out[0] -= ang; out[3] += ang; }
}

class LauvVehicle {
  constructor() {
    this.p = LAUV_PARAMS; this.d = LAUV_DUNE; const P = this.p, d = this.d;
    this.pos = new Float64Array(3);           // world position of the CG
    this.R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);   // columns = body axes in world: R[0..2] x_b, R[3..5] y_b, R[6..8] z_b
    this.v = new Float64Array(3);             // body-frame velocity relative to the water (u, vy, vz)
    this.w = new Float64Array(3);             // body-frame angular velocity
    this.mass = LAUV_MASS;
    const ma = LAUV_RHO * PI * LAUV_R * LAUV_R * LAUV_L * P.ca;       // cross-flow added mass
    this.mx = this.mass * (1 + P.k1 * 0 ) + ma * P.k1; this.my = this.mass + ma; this.mz = this.my;
    const Iy = this.mass * LAUV_L * LAUV_L / 12 + ma * LAUV_L * LAUV_L / 12;
    this.Ix = 0.5 * this.mass * LAUV_R * LAUV_R + 0.003; this.Iy = Iy; this.Iz = Iy;
    this.weight = this.mass * LAUV_G; this.buoy = this.weight + P.netBuoy;
    // slices for the cross-flow drag
    this.ns = 18; this.sl = []; for (let i = 0; i < this.ns; i++) { const x = (i + 0.5) * LAUV_L / this.ns; this.sl.push([x - LAUV_CGX, lauvHullR(x)]); }
    // DUNE controllers
    this.pidRoll = new LauvPID(d.rollGains, -d.maxFinRot, d.maxFinRot); this.pidPitch = new LauvPID(d.pitchGains, -d.maxPitchAct, d.maxPitchAct);
    this.pidHead = new LauvPID(d.headingGains, -d.maxHeadingRate, d.maxHeadingRate); this.pidHrate = new LauvPID(d.hrateGains, -d.maxFinRot, d.maxFinRot);
    this.pidMps = new LauvPID([0, d.mpsKi, 0], 0, 0);
    this.cmd = new Float64Array(4); this.servo = new Float64Array(4); this.tmp = new Float64Array(4);
    this.in = { steer: 0, pitch: 0, throttle: 0.4 };    // steer: +1 right; pitch: +1 climb; throttle -0.4..1 (speed 2 m/s at 1)
    this.headRef = 0; this.holdHeading = true; this.rpm = 0; this.rpmCmd = 0; this.propAngle = 0;
    this.fouled = 0; this.thrust = 0; this.rpmPrev = 0; this.ctrlAcc = 0;
    this.ffTable = null; this.buildFF();
    this.t = 0; this.ydepth = 0; this.depthMin = -0.045;
    this.surfY = 0; this.surfSx = 0; this.surfSz = 0; this.surfVy = 0;   // water surface under the hull (surface.js): height, slope in x and z, vertical speed
    this.contact = 0; this.sy = 0;
  }
  // rpm that gives speed U in calm water: table by bisection (DUNE speed model feed-forward)
  buildFF() {
    const P = this.p, t = new Float64Array(41);
    for (let i = 0; i <= 40; i++) {
      const U = i * 0.06; let lo = 0, hi = 4000;
      for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (this.propThrust(mid, U) > this.axialDrag(U)) hi = mid; else lo = mid; }
      t[i] = (lo + hi) / 2;
    }
    this.ffTable = t;
  }
  ffRpm(U) { const f = clamp(U / 0.06, 0, 39.999), i = floor(f), a = this.ffTable; return a[i] + (a[i + 1] - a[i]) * (f - i); }
  axialDrag(u) { return (LAUV_RHO * 0.5 * this.p.cdAxial * PI * LAUV_R * LAUV_R * 2.2 + 0.4) * abs(u) * u; }
  propThrust(rpm, u) {
    const P = this.p, n = rpm / 60, D = P.propD, nn = abs(n) + 1e-6;
    const J = clamp(u * (1 - P.wake) / (nn * D), -1, 1.2), KT = P.KT0 * (1 - J / P.J0);
    let T = LAUV_RHO * n * nn * D * D * D * D * KT; if (rpm < 0) T *= P.revThrust / 0.1 * 0.1; return T;
  }
  setPose(x, y, z, yaw, pitch) {
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z;
    const cp = cos(pitch), f = [sin(yaw) * cp, sin(pitch), -cos(yaw) * cp], s = [cos(yaw), 0, sin(yaw)];
    const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]], R = this.R;
    R[0] = f[0]; R[1] = f[1]; R[2] = f[2]; R[3] = u[0]; R[4] = u[1]; R[5] = u[2]; R[6] = s[0]; R[7] = s[1]; R[8] = s[2];
    this.v.fill(0); this.w.fill(0); this.holdHeading = true; this.headRef = yaw; this.pidReset(); this.servo.fill(0);
  }
  pidReset() { this.pidRoll.reset(); this.pidPitch.reset(); this.pidHead.reset(); this.pidHrate.reset(); this.pidMps.reset(); }
  setSpeed(u) { this.v[0] = u; this.in.throttle = clamp(u / 2, -0.4, 1); this.rpm = this.rpmCmd = u > 0.05 ? this.ffRpm(u) : 0; this.pidMps.int = 0; this.rpmPrev = this.rpm; }
  // attitude (DUNE convention) from the rotation matrix
  get yaw() { return atan2(this.R[0], -this.R[2]); }
  get pitch() { return Math.asin(clamp(this.R[1], -1, 1)); }
  get roll() { return -Math.asin(clamp(this.R[7], -1, 1)); }    // starboard down positive
  get speed() { return this.v[0]; }
  get depth() { return -this.pos[1]; }
  toWorld(x, y, z, out) {
    const R = this.R, a = x - LAUV_CGX, b = y - LAUV_CGY, c = z;
    out[0] = this.pos[0] + R[0] * a + R[3] * b + R[6] * c; out[1] = this.pos[1] + R[1] * a + R[4] * b + R[7] * c; out[2] = this.pos[2] + R[2] * a + R[5] * b + R[8] * c; return out;
  }
  // ---- onboard control at ~30 Hz: DUNE attitude + allocator + speed task
  control(dt) {
    const d = this.d, I = this.in, u = this.v[0], back = u < 0;
    const phi = this.roll, th = this.pitch, psi = this.yaw, p = this.w[0], q = this.w[2], r = -this.w[1];
    // pitch
    const pitchRef = I.pitch * 20 * PI / 180;
    let m = this.pidPitch.step(dt, pitchRef - th, -(q * cos(phi) - r * sin(phi)));
    if (back) m = -m;
    // roll held at 0
    let k = this.pidRoll.step(dt, -phi, -(p + Math.tan(th) * (sin(phi) * q + cos(phi) * r)));
    if (back) k = -k;
    // heading: a turn command sets the heading rate, otherwise the heading is held
    let hrate;
    if (abs(I.steer) > 0.02) { hrate = I.steer * d.maxHeadingRate; this.holdHeading = false; this.pidHead.reset(); }
    else {
      if (!this.holdHeading) { this.holdHeading = true; this.headRef = psi; }
      hrate = this.pidHead.step(dt, lauvWrap(this.headRef - psi), -(sin(phi) * q + cos(phi) * r) / cos(th));
      if (back) hrate = -hrate;
    }
    const n = this.pidHrate.step(dt, hrate - r);
    lauvAllocate(k, m, n, d, this.cmd);
    // speed task
    const thr = I.throttle;
    if (thr > 0.04) {
      let rpm = this.pidMps.step(dt, thr * 2 - u) + this.ffRpm(thr * 2);
      rpm = clamp(rpm, this.rpmPrev - d.rpmAccel * dt, this.rpmPrev + d.rpmAccel * dt);
      this.rpmCmd = clamp(rpm, d.minRpm, d.maxRpm);
    } else if (thr < -0.04) { this.rpmCmd = clamp(thr * 4000, -this.p.rpmRev, 0); this.pidMps.reset(); }
    else { this.rpmCmd = 0; this.pidMps.reset(); }
    this.rpmPrev = this.rpmCmd;
  }
  servos(dt) {
    const d = this.d, al = 1 - exp(-dt / d.servoLag), mr = d.servoRate * dt;
    for (let i = 0; i < 4; i++) { const e = clamp((this.cmd[i] - this.servo[i]) * al, -mr, mr); this.servo[i] = clamp(this.servo[i] + e, -d.maxFinRot * 1.04, d.maxFinRot * 1.04); }
  }
  // ---- one fixed physics step
  step(dt) {
    const P = this.p, R = this.R, v = this.v, w = this.w, rho = LAUV_RHO;
    surfWave(this);   // the waves under the hull
    this.ctrlAcc += dt;
    if (this.ctrlAcc >= 1 / 30) { this.control(this.ctrlAcc); this.ctrlAcc = 0; }
    this.servos(dt);
    // motor
    const rl = this.rpmCmd, sl = P.rpmSlew * dt; let dr = (rl - this.rpm) * (1 - exp(-dt / P.tauMotor)); dr = clamp(dr, -sl, sl); this.rpm += dr;
    this.propAngle += this.rpm / 60 * TAU * dt;
    let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
    const u = v[0], vy = v[1], vz = v[2], wx = w[0], wy = w[1], wz = w[2];
    // buoyancy (reduced when the hull breaks the surface) and weight, in the body frame
    const depthTop = -(this.pos[1] - this.surfY + LAUV_R * 0.4), sub = clamp((depthTop + LAUV_R) / (2 * LAUV_R), 0, 1);
    this.sub = sub;
    const fw = this.buoy * sub - this.weight;                    // world vertical net force
    Fx += R[1] * fw; Fy += R[4] * fw; Fz += R[7] * fw;
    // buoyancy acts 12 mm above the CG: torque = r x F (F = buoyancy in the body frame)
    const bx = R[1] * this.buoy * sub, by = R[4] * this.buoy * sub, bz = R[7] * this.buoy * sub, cy = -LAUV_CGY;
    Tx += cy * bz * 1 - 0; Tz += -cy * bx; // (0,cy,0) x (bx,by,bz) = (cy*bz, 0, -cy*bx)
    // axial drag (hull, appendages) with the fouling penalty
    Fx -= this.axialDrag(u) * (1 + 0.8 * this.fouled);
    // cross-flow drag on the hull strips
    const cd = 0.5 * rho * P.cdCross * 2;
    for (let i = 0; i < this.ns; i++) {
      const s = this.sl[i], rx = s[0], rad = s[1] * LAUV_L / this.ns;   // rad = r * dx
      const vly = vy + wz * rx, vlz = vz - wy * rx, vc = sqrt(vly * vly + vlz * vlz);
      const fy = -cd * rad * vc * vly, fz = -cd * rad * vc * vlz;
      Fy += fy; Fz += fz; Ty += -rx * fz; Tz += rx * fy;
    }
    // mast + sensor pod: extra sway / heave drag, small
    // roll damping (bilge strips, fins, rotary skin friction)
    Tx -= (P.rollLin + P.rollQuad * abs(wx)) * wx;
    // fins
    const q = P.finArea, rf = P.finX - LAUV_CGX, fr = P.finR;
    for (let k = 0; k < 4; k++) {
      // 0 bottom (y-), 1 port (z-), 2 starboard (z+), 3 top (y+); vertical fins have normal +z, horizontal +y
      const vert = k === 0 || k === 3, py = k === 0 ? -fr : k === 3 ? fr : 0, pz = k === 1 ? -fr : k === 2 ? fr : 0;
      const fvx = u + wy * pz - wz * py, fvy = vy + wz * rf - wx * pz, fvz = vz + wx * py - wy * rf;
      const un = vert ? fvz : fvy, uf = fvx, s = uf < 0 ? -1 : 1, ua = abs(uf) + 1e-3;
      const alpha = s * this.servo[k] - Math.atan(un / ua);
      const as = P.finStall * Math.tanh(alpha / P.finStall), dyn = 0.5 * rho * q * (uf * uf + un * un);
      const CL = P.finCLa * as, CD = P.finCd0 + 0.3 * CL * CL;
      const fn = dyn * CL, fa = -s * dyn * CD;      // along the fin normal, along the chord
      const Fyk = vert ? 0 : fn, Fzk = vert ? fn : 0;
      Fx += fa; Fy += Fyk; Fz += Fzk;
      // torque = r x F, r = (rf, py, pz), F = (fa, Fyk, Fzk)
      Tx += py * Fzk - pz * Fyk; Ty += pz * fa - rf * Fzk; Tz += rf * Fyk - py * fa;
    }
    // at the surface the hull rides the waves: a pitch moment towards the slope of the water along the hull (fades out below 0.3 m)
    {
      const dpt = this.surfY - this.pos[1], k = clamp(1 - (dpt - 0.05) / 0.3, 0, 1);
      if (k > 0) {
        const hl = hypot(R[0], R[2]) || 1, slope = (this.surfSx * R[0] + this.surfSz * R[2]) / hl, tgt = Math.atan(slope) * (R[0] * R[0] + R[2] * R[2] > 0.1 ? 1 : 0);
        Tz += k * (90 * (tgt - this.pitch) - 28 * w[2]);
      }
    }
    // propeller
    {
      const n = this.rpm / 60, nn = abs(n) + 1e-6, D = P.propD, J = clamp(u * (1 - P.wake) / (nn * D), -1, 1.3);
      const vent = clamp((-(this.pos[1] + LAUV_R) - 0.0) / 0.08 + 0.3, 0.1, 1);   // prop disc near the surface
      const f = (1 - 0.72 * this.fouled) * vent;
      let T = rho * n * nn * D ** 4 * P.KT0 * (1 - J / P.J0), Q = rho * n * nn * D ** 5 * P.KQ0 * (1 - J / P.JQ);
      if (n < 0) { T *= P.revThrust / 0.1 * 0.1 * 1.0; Q *= 0.1; }
      this.thrust = T * f; Fx += T * f; Tx += Q * f;
    }
    // Munk moment (scaled), Coriolis
    const mx = this.mx, my = this.my, mz = this.mz, mk = P.mungK;
    // rigid body + added mass:  M dv/dt = F - w x (M v)
    const Mx = mx * u, My = my * vy, Mz = mz * vz;
    const ax = (Fx - (wy * Mz - wz * My)) / mx, ay = (Fy - (wz * Mx - wx * Mz)) / my, az = (Fz - (wx * My - wy * Mx)) / mz;
    // torque side: I dw/dt = T - w x (I w) - mk * v x (M v)
    const Ix = this.Ix, Iy = this.Iy, Iz = this.Iz;
    const vMx = vy * Mz - vz * My, vMy = vz * Mx - u * Mz, vMz = u * My - vy * Mx;
    const gx = (Iy * wy), gy = (Iz * wz), gz = (Ix * wx);   // placeholders replaced below
    const Iwx = Ix * wx, Iwy = Iy * wy, Iwz = Iz * wz;
    const cwx = wy * Iwz - wz * Iwy, cwy = wz * Iwx - wx * Iwz, cwz = wx * Iwy - wy * Iwx;
    const awx = (Tx - cwx - mk * vMx) / Ix, awy = (Ty - cwy - mk * vMy) / Iy, awz = (Tz - cwz - mk * vMz) / Iz;
    v[0] += ax * dt; v[1] += ay * dt; v[2] += az * dt; w[0] += awx * dt; w[1] += awy * dt; w[2] += awz * dt;
    // kinematics: position, then rotation R <- R * exp(w dt)
    const V0 = v[0], V1 = v[1], V2 = v[2];
    this.pos[0] += (R[0] * V0 + R[3] * V1 + R[6] * V2) * dt; this.pos[1] += (R[1] * V0 + R[4] * V1 + R[7] * V2) * dt; this.pos[2] += (R[2] * V0 + R[5] * V1 + R[8] * V2) * dt;
    this.rotate(w[0] * dt, w[1] * dt, w[2] * dt);
    // water surface: the hull top stays at the surface
    const lim = this.surfY + this.depthMin;
    // within 10 cm of the surface (and not told to dive) the hull rides the water: it follows the waves up and down. Once
    // floating it stays with them (a crest can outrun it by more than 10 cm) until told to dive or half a metre down
    const gap = lim - this.pos[1];
    if (this.in.pitch < -0.05 || gap > 0.5) this.floating = false; else if (gap < 0.1) this.floating = true;
    const hug = this.in.pitch > -0.05 && (gap < 0.1 || (this.floating && gap < 0.5));
    if (this.pos[1] > lim) this.pos[1] = lim; else if (hug) this.pos[1] += (lim - this.pos[1]) * Math.min(1, 15 * dt);
    if (hug || this.pos[1] >= lim) {
      const vyw = R[1] * v[0] + R[4] * v[1] + R[7] * v[2] - this.surfVy;
      if (hug || vyw > 0) { v[0] -= vyw * R[1]; v[1] -= vyw * R[4]; v[2] -= vyw * R[7]; }
    }
    this.t += dt;
  }
  // R <- R * Rodrigues(axis angle a = (ax, ay, az) in the body frame), re-orthonormalised
  rotate(ax, ay, az) {
    const R = this.R, a = sqrt(ax * ax + ay * ay + az * az); if (a < 1e-12) return;
    const kx = ax / a, ky = ay / a, kz = az / a, c = cos(a), s = sin(a), t = 1 - c;
    const m00 = c + kx * kx * t, m01 = kx * ky * t - kz * s, m02 = kx * kz * t + ky * s;
    const m10 = ky * kx * t + kz * s, m11 = c + ky * ky * t, m12 = ky * kz * t - kx * s;
    const m20 = kz * kx * t - ky * s, m21 = kz * ky * t + kx * s, m22 = c + kz * kz * t;
    // columns of R are body axes; new column j = sum_i R_col_i * m[i][j]
    const c0 = [R[0], R[1], R[2]], c1 = [R[3], R[4], R[5]], c2 = [R[6], R[7], R[8]];
    for (let r = 0; r < 3; r++) { R[r] = c0[r] * m00 + c1[r] * m10 + c2[r] * m20; R[3 + r] = c0[r] * m01 + c1[r] * m11 + c2[r] * m21; R[6 + r] = c0[r] * m02 + c1[r] * m12 + c2[r] * m22; }
    // Gram-Schmidt
    let l = hypot(R[0], R[1], R[2]); R[0] /= l; R[1] /= l; R[2] /= l;
    let dd = R[3] * R[0] + R[4] * R[1] + R[5] * R[2]; R[3] -= dd * R[0]; R[4] -= dd * R[1]; R[5] -= dd * R[2];
    l = hypot(R[3], R[4], R[5]); R[3] /= l; R[4] /= l; R[5] /= l;
    R[6] = R[1] * R[5] - R[2] * R[4]; R[7] = R[2] * R[3] - R[0] * R[5]; R[8] = R[0] * R[4] - R[1] * R[3];
  }
  // impulse at body point r_b (relative to CG) along world normal n (unit, pointing out of the obstacle); returns the normal impulse
  impulse(nx, ny, nz, rx, ry, rz, e, mu) {
    const R = this.R, v = this.v, w = this.w;
    const nb = [R[0] * nx + R[1] * ny + R[2] * nz, R[3] * nx + R[4] * ny + R[5] * nz, R[6] * nx + R[7] * ny + R[8] * nz];
    // point velocity (body): v + w x r
    const pv = [v[0] + w[1] * rz - w[2] * ry, v[1] + w[2] * rx - w[0] * rz, v[2] + w[0] * ry - w[1] * rx];
    const vn = pv[0] * nb[0] + pv[1] * nb[1] + pv[2] * nb[2];
    if (vn >= 0) return 0;
    const rxn = [ry * nb[2] - rz * nb[1], rz * nb[0] - rx * nb[2], rx * nb[1] - ry * nb[0]];
    const K = nb[0] * nb[0] / this.mx + nb[1] * nb[1] / this.my + nb[2] * nb[2] / this.mz + rxn[0] * rxn[0] / this.Ix + rxn[1] * rxn[1] / this.Iy + rxn[2] * rxn[2] / this.Iz;
    const j = -(1 + e) * vn / K;
    v[0] += j * nb[0] / this.mx; v[1] += j * nb[1] / this.my; v[2] += j * nb[2] / this.mz;
    w[0] += j * rxn[0] / this.Ix; w[1] += j * rxn[1] / this.Iy; w[2] += j * rxn[2] / this.Iz;
    // Coulomb friction on the tangential velocity (after the normal impulse)
    const pv2 = [v[0] + w[1] * rz - w[2] * ry, v[1] + w[2] * rx - w[0] * rz, v[2] + w[0] * ry - w[1] * rx];
    const vn2 = pv2[0] * nb[0] + pv2[1] * nb[1] + pv2[2] * nb[2];
    const t = [pv2[0] - vn2 * nb[0], pv2[1] - vn2 * nb[1], pv2[2] - vn2 * nb[2]], tl = hypot(t[0], t[1], t[2]);
    if (tl > 1e-4) {
      const tn = [t[0] / tl, t[1] / tl, t[2] / tl], rxt = [ry * tn[2] - rz * tn[1], rz * tn[0] - rx * tn[2], rx * tn[1] - ry * tn[0]];
      const Kt = tn[0] * tn[0] / this.mx + tn[1] * tn[1] / this.my + tn[2] * tn[2] / this.mz + rxt[0] * rxt[0] / this.Ix + rxt[1] * rxt[1] / this.Iy + rxt[2] * rxt[2] / this.Iz;
      const jt = min(tl / Kt, mu * j);
      v[0] -= jt * tn[0] / this.mx; v[1] -= jt * tn[1] / this.my; v[2] -= jt * tn[2] / this.mz;
      w[0] -= jt * rxt[0] / this.Ix; w[1] -= jt * rxt[1] / this.Iy; w[2] -= jt * rxt[2] / this.Iz;
    }
    return j;
  }
}
