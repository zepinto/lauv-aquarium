// ============================================================================
// bottlenose dolphins: a pod of five (four adults and a calf) that cruises and breathes at the surface, comes over to look
// when the LAUV moves, rides its bow and wake near the surface and leaves again; clicks, whistles and blows (synth, positional)
// ============================================================================
// Body: a lofted hull with a beak, melon, falcate dorsal fin, flippers and flukes (length 1 in the mesh, x forward, y up, z right).
// The vertex shader swims it: a dorso-ventral wave that grows towards the tail (the fluke beat), lateral flex when turning;
// the instance carries position, heading, up (roll), beat phase / amplitude and bend. All motion is simulated here.
FAUNA.push((() => {
  const N = 5, rng = bfRng(40113), rf = (a, b) => a + (b - a) * rng();
  const W_DOL = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f, @location(5) d: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32, @location(4) lt: f32, @location(5) ax: f32 };
@vertex fn vsDol(i: VI) -> VO {
  var o: VO;
  let ph = i.b.w; let amp = i.c.w; let part = i.n.w;
  var l = i.p;
  // the fluke beat: a wave along the body, dorso-ventral, growing from the dorsal fin to the flukes
  let w = clamp((.2 - l.x) / .7, 0., 1.);
  let wt = w * w; let k = 5.2;
  let arg = ph - l.x * k;
  let ym = .105 * amp;
  let dy = ym * wt * sin(arg) - ym * .22 * (1. - w) * sin(arg + .5);
  let slope = ym * (-k * wt * cos(arg) - 2. * w / .7 * sin(arg));
  let dz = i.d.x * w * w * .22 + .014 * amp * w * sin(arg + 1.3);
  l.y += dy; l.z += dz;
  // the flippers steer: swing up / down with d.y
  if (abs(part + .88) < .05) { l.y += i.d.y * (abs(l.z) - .08) * 1.2; }
  var n = vec3f(i.n.x - slope * i.n.y, i.n.y + slope * i.n.x, i.n.z - i.d.x * 2. * w * w * .22 / .7 * i.n.x * .0);
  n = normalize(n);
  let F = i.b.xyz; let U = i.c.xyz; let R = cross(F, U);
  let P = g.cam.xyz + wd(i.a.xyz - g.cam.xyz);
  let wp = P + (F * l.x + U * l.y + R * l.z) * i.a.w;
  o.cp = g.vp * vec4f(wp, 1.); o.wp = wp; o.n = F * n.x + U * n.y + R * n.z; o.op = i.p; o.sd = i.d.z; o.ax = part;
  o.lt = shadow1(wp);
  return o;
}
@fragment fn fsDol(i: VO) -> @location(0) vec4f {
  let dist = length(i.wp - g.cam.xyz);
  let nn = normalize(i.n);
  let tx = textureSample(tD, sR, vec2f(i.op.x * 3. + i.op.y * 1.7, i.op.z * 3.) + i.sd);
  let n = normalize(nn + (vec3f(tx.r, tx.b, tx.g) - .5) * .05);
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let z = zone(i.wp); let vv = vol(i.wp);
  let ax = i.ax;
  let isfin = ax > .85 || ax < -.8;
  let a = (ax + .75) / 1.5 * TAU - 1.5708;
  let t = select(sin(a), 0., isfin);
  let s = .5 - i.op.x;
  let lat = abs(i.op.z);
  // countershading: dark slate cape, grey flank, pale pinkish belly; the cape line wanders (lighter streak behind the eye, dip at the dorsal fin)
  let wob = .16 * sin(s * 11. + 1.3) * ss(.08, .3, s) + .1 * sin(s * 27.) * ss(.15, .4, s) + (tx.a - .5) * .18;
  let tt = t + wob * (1. - abs(t));
  let back = vec3f(.030, .036, .046); let flank = vec3f(.115, .125, .138); let belly = vec3f(.42, .39, .37);
  var alb = mix(flank, back, ss(-.05, .5, tt));
  alb = mix(alb, belly, ss(-.12, -.62, tt));
  alb = mix(alb, vec3f(.40, .27, .26), ss(-.7, -1., tt) * .35 * ss(.15, .7, s));
  // fins and flukes: dark, paler underneath
  let finc = mix(vec3f(.025, .03, .04), vec3f(.07, .08, .095), ss(.2, .9, tx.b)) * (.8 + .4 * tx.a);
  alb = select(alb, finc, isfin);
  alb *= .86 + .28 * tx.b;
  // rake marks and mottling
  alb += vec3f(.06) * ss(.74, .9, tx.a) * (1. - f32(isfin)) * ss(-.2, .6, tt);
  // eye, mouth line, blowhole (side features: the eye is at 14 % of the length, level with the mouth corner)
  let sd = step(.3, lat) * (1. - f32(isfin));
  let eye = ss(.016, .006, length(vec2f(i.op.x - .36, i.op.y - .013))) * sd;
  let eyer = ss(.03, .012, length(vec2f(i.op.x - .36, i.op.y - .013))) * sd;
  let my = -.006 + .02 * ss(.44, .375, i.op.x) + .01 * ss(.5, .42, i.op.x);
  let mouth = ss(.0028, .0008, abs(i.op.y - my)) * step(.372, i.op.x) * (1. - f32(isfin));
  let blow = ss(.014, .006, length(vec2f(i.op.x - .245, i.op.z))) * step(.6, n.y) * (1. - f32(isfin));
  alb = mix(alb, vec3f(.05, .045, .045), eyer * .45);
  alb = mix(alb, vec3f(.008), eye);
  alb = mix(alb, alb * .35, mouth * .8);
  alb = mix(alb, vec3f(.01), blow * .9);
  let ca = caus(i.wp, dist);
  let E = sunE(i.wp.y, z) * i.lt;
  let dif = sat(dot(n, L) * .75 + .25);
  let fillN = vec3f(n.x, abs(n.y) * .5 + .3, n.z);
  var c = alb * (E * dif * (.3 + ca * .85) + amb(i.wp, fillN, vv.g, z) * 1.15 + side(i.wp, n, 1., z) * .6);
  // thin fins and flukes let the sun through
  c += select(vec3f(0.), alb * E * sat(dot(-n, L)) * .5, isfin);
  // wet skin: a glossy sun lobe, a broad sheen and the sky reflected at grazing angles
  let H = normalize(V + L); let nv = sat(dot(n, V));
  c += E * (pow(sat(dot(n, H)), 70.) * 1.3 + pow(sat(dot(n, H)), 12.) * .12) * (.4 + ca * .6) * (1. - mouth) * (1. - .8 * f32(isfin));
  let sky = amb(i.wp, vec3f(0., 1., 0.), vv.g, z);
  c += sky * pow(1. - nv, 4.) * .55 + alb * sky * ca * .25 * sat(-n.y);
  return fin(fog(c, i.wp, z));
}
`
  // ---------------------------------------------------------------- mesh
  // hull profile: s (0 nose .. 1 stock), top / bottom half height, half width, centre line height
  const PROF = [[0, .004, .003, .004, 0], [.02, .012, .009, .012, -.002], [.06, .021, .019, .023, -.004], [.105, .030, .025, .031, -.004], [.14, .060, .031, .050, 0],
    [.19, .088, .054, .070, .008], [.25, .106, .076, .088, .01], [.33, .116, .098, .098, .005], [.42, .112, .105, .098, 0], [.52, .100, .098, .088, -.003],
    [.62, .082, .082, .070, -.003], [.72, .060, .060, .050, -.002], [.82, .040, .042, .034, -.002], [.90, .028, .030, .024, -.002], [.96, .022, .022, .016, -.002],
    [1, .018, .018, .012, -.001], [1.03, .012, .012, .008, 0], [1.05, .002, .002, .002, 0]];
  function prof(s, ch) {   // cubic Hermite through the table, finite-difference tangents
    let k = 0; while (k < PROF.length - 2 && s > PROF[k + 1][0]) k++;
    const p0 = PROF[k], p1 = PROF[k + 1], h = p1[0] - p0[0], u = (s - p0[0]) / h;
    const tan = (j) => { const a = PROF[max(j - 1, 0)], b = PROF[min(j + 1, PROF.length - 1)]; return (b[ch] - a[ch]) / (b[0] - a[0]); };
    const m0 = tan(k) * h, m1 = tan(k + 1) * h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0[ch] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1[ch] + (u3 - u2) * m1;
  }
  function hull() {
    const m = new Mesh(), NR = 84, M = 30, rings = [];
    for (let j = 0; j <= NR; j++) {
      const q = j / NR, s = 1.05 * (q < 0.5 ? 0.5 * pow(q * 2, 1.25) : 1 - 0.5 * pow((1 - q) * 2, 1.25)), ring = [];
      const ht = max(prof(s, 1), 0.002), hb = max(prof(s, 2), 0.002), w = max(prof(s, 3), 0.002), cy = prof(s, 4);
      for (let k = 0; k <= M; k++) {
        const a = -PI / 2 + k / M * TAU, sa = sin(a), ca = cos(a);
        const y = cy + (sa > 0 ? ht : hb) * Math.sign(sa) * pow(abs(sa), 0.9), z = w * Math.sign(ca) * pow(abs(ca), 0.9);
        ring.push(m.v(0.5 - s, y, z, (a + PI / 2) / TAU * 1.5 - 0.75));
      }
      rings.push(ring);
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < M; k++) m.quad(rings[j][k], rings[j + 1][k], rings[j + 1][k + 1], rings[j][k + 1]);
    return m;
  }
  function dorsal() {   // falcate: swept back, concave trailing edge, tip curved back
    const S = [], NS = 12;
    for (let k = 0; k <= NS; k++) {
      const v = k / NS, sle = 0.45 + 0.12 * pow(v, 1.15), ste = 0.605 + 0.025 * pow(v, 2.2), y = 0.084 + 0.125 * v;
      S.push({ le: [0.5 - sle, y, 0], te: [0.5 - ste, y - 0.012 * v * v, 0], up: [0, 0, 1], t: 0.011 * pow(1 - v * v, 0.8) + 0.0008 });
    }
    return bfLens(S, 0.9);
  }
  function flipper(sd) {
    const S = [], NS = 8;
    for (let k = 0; k <= NS; k++) {
      const v = k / NS, ch = 0.07 * pow(1 - v, 0.75) + 0.014;
      const ax = 0.19 - 0.075 * pow(v, 1.3) - 0.03 * v * v, ay = -0.038 - 0.07 * v, az = sd * (0.082 + 0.105 * v);
      const nx = 0, ny = 0.8, nz = -sd * 0.6;
      S.push({ le: [ax + ch * 0.35, ay, az], te: [ax - ch * 0.65, ay - 0.006 * v, az], up: [nx, ny, nz], t: 0.0065 * pow(1 - v * v, 0.7) + 0.0006 });
    }
    return bfLens(S, -0.88);
  }
  function flukes() {
    const S = [], NS = 21;
    for (let k = 0; k < NS; k++) {
      const v = k / (NS - 1) * 2 - 1, av = abs(v);
      const le = -0.505 - 0.08 * pow(av, 1.6), te = -0.56 - 0.055 * av - 0.012 * av * av + 0.02 * exp(-pow(v / 0.1, 2)) - 0.012 * (1 - av);
      S.push({ le: [le, -0.002 + 0.008 * av, v * 0.1], te: [te, -0.002 + 0.004 * av, v * 0.1], up: [0, 1, 0], t: 0.0105 * pow(max(1 - pow(av, 1.5), 0), 0.8) + 0.0005 });
    }
    return bfLens(S, -1);
  }
  // ---------------------------------------------------------------- state
  const fld = (i) => ({ i, p: new Float64Array(3), v: new Float64Array(3), f: new Float64Array([0, 0, -1]), up: new Float64Array(3), ang: 0, yawRate: 0, roll: 0, barrel: -1, barrelIn: 8 + rng() * 14,
    phase: rng() * 6, amp: 0.3, bend: 0, flip: 0, scale: i === 4 ? 1.42 : 2.5 + 0.35 * (rng() - 0.3), cycT: rng() * 16, cT: 15 + rng() * 6, breath: 4 + rng() * 10, breathT: 99, vy0: 0, tClick: 2 + rng() * 5, tWhis: 4 + rng() * 10, blew: 0, lookSide: 0 });
  const D = Array.from({ length: N }, (_, i) => fld(i));
  // pod: mode cruise | approach | escort | leave; leader point (lx, lz) with heading
  const pod = { mode: 'cruise', t: 0, cool: 0, lx: 0, lz: 0, head: 0, spd: 2.3, orbit: 1, still: 0, deep: 0, init: false, visits: 0 };
  const CRUISE_OFF = [[0, 0], [-3.2, 2.6], [-3.6, -2.4], [-6.5, 0.6], [-3.6, 3.6]];   // [forward, right] in the leader's frame
  // escort slots in the LAUV's frame: forward, right, height above the vehicle (m): bow riders ahead, flank, wake
  const SLOTS = [[2.7, 0.85, 0.55], [2.2, -1.05, 0.4], [0.2, 1.7, 0.9], [-1.2, -1.8, 0.7], [-0.4, 2.7, 0.2]];
  const wrapA = (a) => a - TAU * floor((a + PI) / TAU);
  const ready = () => typeof window.__app === 'object';
  const tgt = new Float64Array(3), vd = new Float64Array(3);
  let inst, pipe, vb, ib, ni, ibuf, nDraw = 0, off = false;
  // ---------------------------------------------------------------- sound: clicks, whistles, blows, positional (WebAudio panners)
  const snd = { ok: false, pan: [], clk: null, noise: null };
  function sndInit() {
    if (snd.ok || !AC || !OUT) return;
    const ac = AC, sr = ac.sampleRate;
    snd.clk = new AudioBuffer({ length: (sr * 0.007) | 0, numberOfChannels: 1, sampleRate: sr });
    { const d = snd.clk.getChannelData(0); for (let i = 0; i < d.length; i++) { const t = i / sr; d[i] = (sin(TAU * 5600 * t) * 0.7 + sin(TAU * 9300 * t + 1) * 0.5 + sin(TAU * 3300 * t) * 0.4) * exp(-t * 900) * (1 - exp(-t * 9000)); } }
    snd.noise = new AudioBuffer({ length: sr, numberOfChannels: 1, sampleRate: sr });
    { const d = snd.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1; }
    for (let i = 0; i < N; i++) { const p = new PannerNode(ac, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 3, rolloffFactor: 1.05, maxDistance: 400 }); p.connect(OUT); snd.pan.push(p); }
    snd.ok = true;
  }
  const src = (buf, t, rate, gain, node) => { const s = new AudioBufferSourceNode(AC, { buffer: buf, playbackRate: rate }), g = new GainNode(AC, { gain }); s.connect(g); g.connect(node); s.start(t); return s; };
  // echolocation click train: the rate speeds up to a buzz, each click a little different
  function clickTrain(d, n, aimed) {
    if (!snd.ok || AC.state !== 'running') return;
    const pn = snd.pan[d.i]; let t = AC.currentTime + 0.03, gap = aimed ? 0.09 : 0.14; const base = rf(0.85, 1.15);
    for (let k = 0; k < n; k++) { src(snd.clk, t, base * rf(0.92, 1.08), 0.28 * rf(0.5, 1), pn); t += gap * rf(0.85, 1.15); gap = max(gap * 0.9, 0.007); }
  }
  // a whistle: a frequency contour of 2-4 linked sweeps, each dolphin with its own signature; second harmonic on top
  function whistle(d, chirp) {
    if (!snd.ok || AC.state !== 'running') return;
    const pn = snd.pan[d.i], t0 = AC.currentTime + 0.03, f0 = 5200 + d.i * 520, len = chirp ? 0.35 : 0.7 + 0.2 * (d.i % 3), o = new OscillatorNode(AC, { type: 'sine' }), o2 = new OscillatorNode(AC, { type: 'sine' });
    const g = new GainNode(AC, { gain: 0 }), g2 = new GainNode(AC, { gain: 0.22 });
    const seg = chirp ? [[0, 0.8], [1, 1.55]] : d.i % 2 ? [[0, 1], [0.3, 1.9], [0.55, 1.35], [0.8, 2.1], [1, 1.5]] : [[0, 1.3], [0.35, 0.85], [0.6, 1.7], [1, 2.2]];
    o.frequency.setValueAtTime(f0 * seg[0][1], t0); for (const s of seg) o.frequency.linearRampToValueAtTime(f0 * s[1], t0 + s[0] * len);
    o.connect(g); o.connect(g2); g2.connect(g); g.connect(pn);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.055, t0 + 0.05); g.gain.setValueAtTime(0.055, t0 + len - 0.08); g.gain.linearRampToValueAtTime(0, t0 + len);
    o.start(t0); o.stop(t0 + len + 0.05);
    // a slightly detuned second voice: the doubled tone dolphins make
    o2.frequency.setValueAtTime(f0 * seg[0][1] * 1.012, t0); for (const s of seg) o2.frequency.linearRampToValueAtTime(f0 * s[1] * 1.012, t0 + s[0] * len);
    const g3 = new GainNode(AC, { gain: 0.3 }); o2.connect(g3); g3.connect(g); o2.start(t0); o2.stop(t0 + len + 0.05);
  }
  // the blow: a short burst of filtered noise as the blowhole clears the surface
  function blow(d) {
    if (!snd.ok || AC.state !== 'running') return;
    const t0 = AC.currentTime + 0.02, s = new AudioBufferSourceNode(AC, { buffer: snd.noise, loop: true }), f = new BiquadFilterNode(AC, { type: 'bandpass', frequency: 1800, Q: 0.6 }), g = new GainNode(AC, { gain: 0 });
    s.connect(f); f.connect(g); g.connect(snd.pan[d.i]);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.002, t0 + 0.45);
    f.frequency.setValueAtTime(2600, t0); f.frequency.exponentialRampToValueAtTime(900, t0 + 0.4);
    s.start(t0); s.stop(t0 + 0.5);
  }
  function sndUpdate() {
    if (!snd.ok) { sndInit(); if (!snd.ok) return; }
    const L = AC.listener, cx = F[CX], cy = F[CY], cz = F[CZ];
    L.positionX.value = cx; L.positionY.value = cy; L.positionZ.value = cz;
    L.forwardX.value = F[FX]; L.forwardY.value = F[FY]; L.forwardZ.value = F[FZ]; L.upX.value = F[UX]; L.upY.value = F[UY]; L.upZ.value = F[UZ];
    for (const d of D) { const p = snd.pan[d.i]; p.positionX.value = cx + wrapD(d.p[0] - cx); p.positionY.value = d.p[1]; p.positionZ.value = cz + wrapD(d.p[2] - cz); }
  }
  // ---------------------------------------------------------------- behaviour
  function dolInit() {
    const m = [hull(), dorsal(), flipper(1), flipper(-1), flukes()].map((p) => bfBuild(p));
    const all = bfMerge(m); ni = all.ib.length;
    vb = buf(all.vb, BU.VERTEX); ib = buf(all.ib, BU.INDEX);
    inst = new Float32Array(N * 16); ibuf = device.createBuffer({ size: N * 64, usage: BU.VERTEX | BU.COPY_DST });
    const mm = mod(W_DOL);
    pipe = scenePipe(mm, 'vsDol', 'fsDol', [vbSolid, { arrayStride: 64, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4'), A(5, 48, 'float32x4')] }]);
  }
  // pod placed r metres from the vehicle in direction ang, swimming heading h (0 faces -z, grows towards +x)
  function place(x, z, h, spd) {
    pod.lx = x; pod.lz = z; pod.head = h; const f0 = sin(h), f1 = -cos(h), r0 = cos(h), r1 = sin(h);
    for (const d of D) {
      const o = CRUISE_OFF[d.i];
      d.p[0] = wrapT(x + f0 * o[0] + r0 * o[1]); d.p[2] = wrapT(z + f1 * o[0] + r1 * o[1]); d.p[1] = d.i === 4 ? -2.2 : -1.6 - 0.5 * d.i;
      d.v[0] = f0 * spd; d.v[1] = 0; d.v[2] = f1 * spd; d.f[0] = f0; d.f[1] = 0; d.f[2] = f1; d.ang = h;
    }
  }
  function relocate(minR, maxR, towards) {
    bfVehicle();
    const a = rng() * TAU, r = minR + (maxR - minR) * rng(), x = bfV.x + cos(a) * r, z = bfV.z + sin(a) * r;
    place(x, z, towards ? atan2(bfV.x - x, -(bfV.z - z)) : a + PI / 2, 2.4);
  }
  const arcG = (x) => exp(-x * x / 0.0025);
  function targetY(d, t, slotY) {
    // two breathing arcs per cycle; between them the dolphin stays under at its own depth (slotY when escorting)
    const c = ((t / d.cT + d.cycT / 16) % 1 + 1) % 1;
    const arc = max(arcG(c - 0.1), arcG(c - 0.27));
    return slotY + (-0.06 - slotY) * arc;
  }
  function stepDolphin(d, dt, t) {
    const i = d.i, escort = pod.mode === 'approach' || pod.mode === 'escort';
    // --- target position and the velocity the water / vehicle gives it
    let vmax = 3.2, gain = 1.4, tvx = 0, tvz = 0, slotY;
    if (escort) {
      const sl = SLOTS[i], k = bfClamp((pod.still - 0.4) / 1.5, 0, 1), th = t * 0.45 + i * TAU / N;
      const lead = 1.0;   // aim a second ahead of the vehicle
      const ox = bfV.fx * sl[0] + bfV.rx * sl[1], oz = bfV.fz * sl[0] + bfV.rz * sl[1];
      const cxp = cos(th) * 4.5, czp = sin(th) * 4.5;
      tgt[0] = bfV.x + (ox + (cxp - ox) * k) + bfV.vx * lead * (1 - k); tgt[2] = bfV.z + (oz + (czp - oz) * k) + bfV.vz * lead * (1 - k);
      slotY = bfClamp(bfV.y + sl[2], -5.5, -0.55);
      tvx = bfV.vx * (1 - k); tvz = bfV.vz * (1 - k); vmax = pod.mode === 'approach' ? 6 : 5; gain = 1.6;
      tgt[0] = bfV.x + wrapD(tgt[0] - bfV.x); tgt[2] = bfV.z + wrapD(tgt[2] - bfV.z);
    } else {
      const o = CRUISE_OFF[i], h = pod.head, f0 = sin(h), f1 = -cos(h), r0 = cos(h), r1 = sin(h);
      tgt[0] = pod.lx + f0 * o[0] + r0 * o[1]; tgt[2] = pod.lz + f1 * o[0] + r1 * o[1];
      tvx = f0 * pod.spd; tvz = f1 * pod.spd; slotY = i === 4 ? -2 : -2.2 - 1.3 * (0.5 + 0.5 * sin(t * 0.11 + i * 2.1)); vmax = pod.mode === 'leave' ? 6 : 4.2;
    }
    let dx = wrapD(tgt[0] - d.p[0]), dz = wrapD(tgt[2] - d.p[2]);
    vd[0] = tvx + dx * gain; vd[2] = tvz + dz * gain;
    // breathing: own arcs on the cruise cycle; while escorting a dolphin goes up for air every ~15 s
    let ty = slotY;
    if (escort) { d.breath -= dt; if (d.breath < 0) { d.breathT = 0; d.breath = 11 + rng() * 9; } if (d.breathT < 1.7) { d.breathT += dt; const a = sin(PI * d.breathT / 1.7); ty = slotY + (-0.07 - slotY) * a * a; } }
    else ty = targetY(d, t, slotY);
    vd[1] = bfClamp((ty - d.p[1]) * 2.6, -2.4, 2.8);
    const hl = hypot(vd[0], vd[2]); if (hl > vmax) { vd[0] *= vmax / hl; vd[2] *= vmax / hl; }
    // accelerate (limited), integrate
    let ax = vd[0] - d.v[0], ay = vd[1] - d.v[1], az = vd[2] - d.v[2]; const al = hypot(ax, ay, az), lim = 4.2 * dt;
    if (al > lim) { const s = lim / al; ax *= s; ay *= s; az *= s; }
    d.v[0] += ax; d.v[1] += ay; d.v[2] += az;
    d.p[0] = wrapT(d.p[0] + d.v[0] * dt); d.p[1] += d.v[1] * dt; d.p[2] = wrapT(d.p[2] + d.v[2] * dt);
    if (d.p[1] > 0.05) { d.p[1] = 0.05; if (d.v[1] > 0) d.v[1] = 0; }
    // --- orientation: along the velocity, banked into turns, rolled to look at the LAUV, an occasional barrel roll
    const sp = hypot(d.v[0], d.v[1], d.v[2]);
    if (sp > 0.3 && dt > 0) {
      const k = min(1, 6 * dt), ix = d.v[0] / sp, iy = d.v[1] / sp, iz = d.v[2] / sp;
      d.f[0] += (ix - d.f[0]) * k; d.f[1] += (iy - d.f[1]) * k; d.f[2] += (iz - d.f[2]) * k;
      const fl = hypot(d.f[0], d.f[1], d.f[2]); d.f[0] /= fl; d.f[1] /= fl; d.f[2] /= fl;
    }
    if (dt > 1e-5) { const a = atan2(d.f[0], -d.f[2]); d.yawRate += (wrapA(a - d.ang) / dt - d.yawRate) * min(1, 4 * dt); d.ang = a; }
    let rollT = bfClamp(d.yawRate * 0.7, -0.5, 0.5);
    if (escort) {   // roll onto the side to look at the vehicle when beside it
      const vxr = wrapD(bfV.x - d.p[0]), vzr = wrapD(bfV.z - d.p[2]), rgt = vxr * cos(d.ang) + vzr * sin(d.ang), dd = hypot(vxr, vzr);
      d.lookSide += ((dd < 7 ? bfClamp(rgt / 3, -1, 1) * 0.55 : 0) - d.lookSide) * min(1, 2 * dt);
      rollT += d.lookSide;
    }
    d.barrelIn -= dt;
    if (escort && d.barrel < 0 && d.barrelIn < 0 && pod.still < 0.5) { d.barrel = 0; d.barrelIn = 14 + rng() * 14; }
    if (d.barrel >= 0) { d.barrel += dt / 1.9; if (d.barrel >= 1) d.barrel = -1; }
    d.roll += (rollT - d.roll) * min(1, 5 * dt);
    const rl = d.roll + (d.barrel >= 0 ? d.barrel * TAU : 0);
    // --- swimming: beat frequency follows speed, amplitude follows effort (gliding in the bow wave, hard when climbing / catching up)
    const catchUp = escort ? bfClamp(hypot(dx, dz) / 2.5, 0, 1) : 0;
    let ampT = 0.3 + 0.12 * sp + 0.4 * bfClamp(d.v[1] * 0.5, 0, 1) + 0.45 * catchUp;
    if (escort && catchUp < 0.25 && pod.mode === 'escort') ampT = 0.1 + 0.35 * bfClamp(abs(d.v[1]), 0, 1);   // riding the pressure wave: almost no beat
    d.amp += (bfClamp(ampT, 0.08, 1) - d.amp) * min(1, 2.5 * dt);
    d.phase += TAU * (0.55 + 0.5 * sp) * dt;
    d.bend += (bfClamp(d.yawRate * 0.8, -0.9, 0.9) - d.bend) * min(1, 6 * dt);
    d.flip += (bfClamp(-d.v[1] * 0.12, -0.3, 0.3) - d.flip) * min(1, 4 * dt);
    // --- breath: the blowhole clears the surface -> exhale bubbles and a blow
    const bl = d.p[1] > -0.28 && d.v[1] > -0.2;
    if (bl && !d.blew) { d.blew = 1; blow(d); const bx = d.p[0] + d.f[0] * 0.6, bz = d.p[2] + d.f[2] * 0.6; for (let k = 0; k < 5; k++) lauvEmit(bx + rf(-0.1, 0.1), -0.25 - rf(0, 0.15), bz + rf(-0.1, 0.1), rf(0.02, 0.05), 0, 0, rf(0.3, 0.7), 0, rf(1.2, 2), 1); }
    else if (d.p[1] < -0.6) d.blew = 0;
    // --- voices
    d.tClick -= dt; d.tWhis -= dt;
    if (d.tClick < 0) { clickTrain(d, escort ? 10 + (rng() * 26 | 0) : 6 + (rng() * 12 | 0), escort); d.tClick = escort ? 1.4 + rng() * 3 : 5 + rng() * 9; }
    if (d.tWhis < 0) { whistle(d, rng() < 0.3); d.tWhis = escort ? 3 + rng() * 6 : 9 + rng() * 14; }
    // --- instance
    const o = d.i * 16, f = d.f, rg0 = -f[2], rg1 = 0, rg2 = f[0]; let rl_ = hypot(rg0, rg2); const rx = rl_ > 1e-4 ? rg0 / rl_ : 1, rz = rl_ > 1e-4 ? rg2 / rl_ : 0;
    // up0 = right0 x fwd
    let ux = 0 * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - 0 * f[0]; const ul = hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const cr = cos(rl), sr = sin(rl);
    inst[o] = d.p[0]; inst[o + 1] = d.p[1]; inst[o + 2] = d.p[2]; inst[o + 3] = d.scale;
    inst[o + 4] = f[0]; inst[o + 5] = f[1]; inst[o + 6] = f[2]; inst[o + 7] = d.phase;
    inst[o + 8] = ux * cr + rx * sr; inst[o + 9] = uy * cr; inst[o + 10] = uz * cr + rz * sr; inst[o + 11] = d.amp;
    inst[o + 12] = d.bend; inst[o + 13] = d.flip; inst[o + 14] = d.i * 3.17; inst[o + 15] = 0;
  }
  let tAll = 0;
  function update(dt) {
    if (!inst || !ready() || off) { nDraw = 0; return; }
    const t0 = performance.now();
    tAll += dt; bfVehicle();
    if (!pod.init) { pod.init = true; relocate(38, 60, false); }
    // --- pod behaviour
    const moving = bfV.u > 0.35, cx = D[0].p[0], cz = D[0].p[2], dist = hypot(wrapD(cx - bfV.x), wrapD(cz - bfV.z));
    pod.t += dt; pod.cool -= dt;
    if (pod.mode === 'cruise') {
      // wander on an orbit round the vehicle, where it is seen from the surface and from the side
      const rx = wrapD(pod.lx - bfV.x), rz = wrapD(pod.lz - bfV.z), dl = hypot(rx, rz) || 1, R0 = 42 + 12 * sin(tAll / 37);
      const tx = -rz / dl * pod.orbit, tz = rx / dl * pod.orbit, k = bfClamp((R0 - dl) / R0, -1, 1);
      const ex = tx + rx / dl * k * 1.2, ez = tz + rz / dl * k * 1.2, hd = atan2(ex, -ez);
      const turn = bfClamp(wrapA(hd - pod.head), -0.22 * dt - 1e-9, 0.22 * dt + 1e-9); pod.head += turn + 0.05 * sin(tAll * 0.3) * dt;
      pod.lx = wrapT(pod.lx + sin(pod.head) * pod.spd * dt); pod.lz = wrapT(pod.lz - cos(pod.head) * pod.spd * dt);
      if (dl > 260) relocate(90, 130, true);
      if (moving && pod.cool <= 0 && bfV.depth < 15) { pod.mode = 'approach'; pod.t = 0; pod.still = 0; pod.deep = 0; if (dist > 140) relocate(100, 125, true); }
    } else if (pod.mode === 'approach' || pod.mode === 'escort') {
      if (!moving) pod.still += dt; else pod.still = max(0, pod.still - dt);
      pod.deep = bfV.depth > 15 ? pod.deep + dt : 0;
      if (pod.mode === 'approach' && (pod.t > 30 || dist < 9)) { pod.mode = 'escort'; pod.t = 0; }
      if (pod.mode === 'escort' && (pod.t > 75 || pod.still > 14 || pod.deep > 6)) {
        pod.mode = 'leave'; pod.t = 0; pod.cool = 70; pod.orbit = -pod.orbit; pod.visits++;
        // swim away from the vehicle
        let ax = 0, az = 0; for (const d of D) { ax += wrapD(d.p[0] - bfV.x); az += wrapD(d.p[2] - bfV.z); }
        pod.head = atan2(ax, -az); pod.lx = bfV.x + wrapD(D[0].p[0] - bfV.x); pod.lz = bfV.z + wrapD(D[0].p[2] - bfV.z);
      }
      if (pod.mode === 'approach' && !moving && pod.t > 6) { pod.mode = 'escort'; }
    } else if (pod.mode === 'leave') {
      pod.lx = wrapT(pod.lx + sin(pod.head) * 5 * dt); pod.lz = wrapT(pod.lz - cos(pod.head) * 5 * dt);
      pod.spd = 4;
      if (pod.t > 16) { pod.mode = 'cruise'; pod.spd = 2.3; pod.t = 0; }
    }
    for (const d of D) stepDolphin(d, dt, tAll);
    Q.writeBuffer(ibuf, 0, inst);
    nDraw = N;
    if (snd.ok || AC) sndUpdate();
    bfMis.ms += performance.now() - t0; bfMis.n++;
  }
  function draw(r) {
    if (!nDraw) return;
    useTile(r, 4);
    r.setPipeline(pipe); r.setVertexBuffer(0, vb); r.setVertexBuffer(1, ibuf); r.setIndexBuffer(ib, 'uint32');
    r.drawIndexed(ni, nDraw, 0, 0, 0);
  }
  // test hooks: __big.dolphins
  const hook = (window.__big ||= {});
  hook.dolphins = {
    pod, D, off: (b) => { off = !!b; },
    // sound tests: the audio graph state and one voice of each kind from dolphin i
    sound: () => ({ ok: snd.ok, state: typeof AC === 'object' && AC ? AC.state : 'none' }),
    voice(i = 0, kind = 'whistle') { sndInit(); const d = D[i]; if (kind === 'click') clickTrain(d, 30, true); else if (kind === 'blow') blow(d); else whistle(d, kind === 'chirp'); },
    // put the pod beside the vehicle at once and make it escort (clips and screenshots)
    join() { bfVehicle(); pod.mode = 'escort'; pod.t = 0; pod.still = 0; pod.cool = 0; for (const d of D) { const s = SLOTS[d.i]; d.p[0] = wrapT(bfV.x + bfV.fx * (s[0] + 9 - d.i) + bfV.rx * s[1] * 2.5); d.p[2] = wrapT(bfV.z + bfV.fz * (s[0] + 9 - d.i) + bfV.rz * s[1] * 2.5); d.p[1] = bfClamp(bfV.y + 1, -5, -0.6); d.v[0] = bfV.vx; d.v[1] = 0; d.v[2] = bfV.vz; d.f[0] = bfV.fx; d.f[1] = 0; d.f[2] = bfV.fz; } },
    // the pod cruising and breathing at x, z (default: 25 m ahead of the vehicle)
    cruiseAt(x, z, h) { bfVehicle(); pod.mode = 'cruise'; pod.cool = 1e9; place(x ?? bfV.x + bfV.fx * 25, z ?? bfV.z + bfV.fz * 25, h ?? atan2(bfV.rx, -bfV.rz), 2.3); },
    // the pod arrives from dist metres away (default 40) in a direction 60 degrees off the vehicle's heading and comes to look
    call(dist = 40, side = 1) { bfVehicle(); const a = atan2(bfV.fx, -bfV.fz) + side * 1.05, x = bfV.x + sin(a) * dist, z = bfV.z - cos(a) * dist; place(x, z, atan2(bfV.x - x, -(bfV.z - z)), 3.5); pod.mode = 'approach'; pod.t = 0; pod.still = 0; pod.cool = 0; },
    leave() { pod.mode = 'leave'; pod.t = 0; },
  };
  return { name: 'dolphins', init: dolInit, update, draw };
})());
