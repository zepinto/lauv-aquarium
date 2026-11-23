// ============================================================================
// renderer, camera and input
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
if (!navigator.gpu) fail('This scene needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep('abyssal', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
// the baked volume wraps in x and z (the world is a torus) but not in y
const sVol = device.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tWater = tex(WATER, WATER, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });
const tMap = tex(512, 512, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);

const UB = new Float32Array(68), UBS = new Float32Array(68);
const ubo = device.createBuffer({ size: 272, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 272, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sVol }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tWater.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
// group 1: the offset of the tile copy being drawn (dynamic offset into 9 slots of 256 bytes: the 3x3 copies of the world)
const bglTile = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
const tileData = new Float32Array(9 * 64);
for (let k = 0; k < 9; k++) { tileData[k * 64] = (k % 3 - 1) * PER; tileData[k * 64 + 2] = (floor(k / 3) - 1) * PER; }
const bgTile = device.createBindGroup({ layout: bglTile, entries: [{ binding: 0, resource: { buffer: buf(tileData, BU.UNIFORM), size: 16 } }] });
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0, bglTile] });
let curTile = -1;
const SHREACH = 34; // m of the neighbouring tile copies that are baked into the shadow map
const useTile = (r, k) => { if (k !== curTile) { r.setBindGroup(1, bgTile, [k * 256]); curTile = k; } };

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibBub = { arrayStride: 32, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4')] };
const ibSnow = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: o.eq ? 'greater-equal' : 'greater' }, multisample: { count: AA } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });

await say('Compiling shaders…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSurf = mod(W_SURF), mSpr = mod(W_SPR);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back', eq: true });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { eq: true });
const pLeaf = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 9 } });
const pLeaf5 = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 5 } });
const pLeafS = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3, FAR: 70 } });
const pLeafF = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
const pFish = scenePipe(mAnim, 'vsFish', 'fsFish', [vbSolid, ibAnim]);
const pManta = scenePipe(mAnim, 'vsManta', 'fsManta', [vbSolid, ibAnim]);
const pSurf = scenePipe(mSurf, 'vs', 'fs', [], { strip: true }), pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pBub = scenePipe(mSpr, 'vsBub', 'fsBub', [ibBub], { strip: true, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pSnow = scenePipe(mSpr, 'vsSnow', 'fsSnow', [ibSnow], { strip: true, blend: ADD });
const pDTerrain = device.createRenderPipeline({ layout: pl0, vertex: { module: mSolid, entryPoint: 'vs', buffers: [vbSolid, ibSolid] },
  primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
const pDSolid = device.createRenderPipeline({ layout: pl0, vertex: { module: mSolid, entryPoint: 'vs', buffers: [vbSolid, ibSolid] },
  primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const pLeafSh = shadowPipe(mLeaf, 'vs', [ibLeaf], { strip: true, constants: { ROWS: 3 } });
await lauvInit(); // the LAUV: model, pipelines (lauv.js)
for (const f of FAUNA) if (f.init) await f.init();

const mWater = mod(W_WATER);
const pWater = device.createRenderPipeline({ layout: 'auto', vertex: { module: mWater, entryPoint: 'vs' }, fragment: { module: mWater, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgWater = device.createBindGroup({ layout: pWater.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const waterViews = [0, 1, 2, 3, 4].map((m) => tWater.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const waterBG = waterViews.map((v) => blitBG(v));
const waterPass = waterViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));

const mTaa = mod(W_TAA);
const pTaa = device.createRenderPipeline({ layout: 'auto', vertex: { module: mTaa, entryPoint: 'vs' }, fragment: { module: mTaa, entryPoint: 'fs', targets: [{ format: HDR }] } });
const uboT = device.createBuffer({ size: 160, usage: BU.UNIFORM | BU.COPY_DST });
const TUB = new Float32Array(40), CURVP = new Float32Array(16), PREVVP = new Float32Array(16);
let taaK = 0, taaReset = 1;
const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

// ---------------------------------------------------------------- sun + shadow matrix
const SUN = (() => { const v = [0.27, 1, -0.24], l = hypot(...v); return v.map((c) => c / l); })();
{
  const L = SUN, lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 225, d0 = -175, d1 = 125, m = UBS;
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = 0;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = 0;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
  UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- world generation
await say('Sculpting the seabed…', 0.25, 1200);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep('abyssalLoad', 1);
addEventListener('pagehide', () => keep('abyssalLoad', ''));
let D, MAP;
{
  const prims = primBuffer();
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } }), pm = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'mapMain' } });
  const size = NX * NY * NZ * 4, msize = NX * NZ * 16;
  const u = new ArrayBuffer(48), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uu[8] = MESAS.length; uu[9] = ARCHES.length; uu[10] = HOLES.length; uu[11] = CLEARS.length;
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(prims, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bm = device.createBuffer({ size: msize, usage: BU.STORAGE | BU.COPY_SRC }), bmr = device.createBuffer({ size: msize, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  const bgm = device.createBindGroup({ layout: pm.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 2, resource: { buffer: bp } }, { binding: 3, resource: { buffer: bm } }] });
  const e = device.createCommandEncoder();
  let c = e.beginComputePass();
  c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4);
  c.setPipeline(pm); c.setBindGroup(0, bgm); c.dispatchWorkgroups(NX / 8, NZ / 8); c.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size); e.copyBufferToBuffer(bm, 0, bmr, 0, msize);
  Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ); await bmr.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0)); MAP = new Float32Array(bmr.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy(); bmr.unmap(); bmr.destroy(); bm.destroy();
  // rock connected to the seabed: each column's unbroken run up from the bottom is, and the rock above a gap
  // (overhangs, specks) is when it touches rock that is (the grid wraps in x and z). What never connects is a speck of
  // noise floating in the water (surface nets would make it a small box), so it becomes water
  const R = new Uint8Array(D.length), b = new Uint8Array(NX), L = [], S = NX * NY;
  for (let i = 0; i < D.length;) { b.fill(1); for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1; else L.push(i); }
  const conn = (i) => {
    const x = i & (NX - 1), y = ((i / NX) | 0) % NY, z = (i / S) | 0, r = i - x;
    return R[r + ((x + 1) & (NX - 1))] || R[r + ((x - 1) & (NX - 1))] || (y < NY - 1 && R[i + NX]) || (y > 0 && R[i - NX]) || R[x + NX * y + NX * NY * ((z + 1) & (NZ - 1))] || R[x + NX * y + NX * NY * ((z - 1) & (NZ - 1))];
  };
  for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && conn(i)) R[i] = k = 1; }
  for (const i of L) if (!R[i]) D[i] = -D[i];
}
// Distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to ±1 m), kept only in the 4x4x4-voxel
// bricks near the surface (the whole tile; sd() wraps). CI per brick: 0 all water, 1 all rock, n brick n-2 in CG.
const CN = NX / 4, CI = new Uint32Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * 60000);
{
  let n = 0;
  for (let bz = 0; bz < CN; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CN; bx++) {
    let lo = 127, hi = -127;
    if ((n + 1) * 64 > CG.length) { const g = new Int8Array(CG.length * 2); g.set(CG); CG = g; }
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const X = bx * 4 + x, Y = by * 4 + y, Z = bz * 4 + z, xp = (X + 1) & (NX - 1), xm = (X - 1) & (NX - 1), zp = (Z + 1) & (NZ - 1), zm = (Z - 1) & (NZ - 1);
      const i = X + NX * (Y + NY * Z), gz = D[X + NX * (Y + NY * zp)] - D[X + NX * (Y + NY * zm)];
      const gx = D[xp + NX * (Y + NY * Z)] - D[xm + NX * (Y + NY * Z)], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / 1.5;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : (n++, n + 1);
  }
  CG = CG.slice(0, n * 64);
}
await say('Carving canyons…', 0.32, 400);
const T = buildTerrain(D, MAP);

// preset viewpoints (keys 1-6): x, height above the floor, z, then the look-at point (x, height above the floor, z)
const POSES = [
  [0, 3, 0, 0, 3, 40],
  [60, 4, 15, 70, 4, 40],
  [-40, 2.5, -60, -40, 4, 0],
  [30, 6, -110, 60, 5, -140],
  [-110, 3, 60, -80, 6, 95],
  [-100, 6, -90, -140, 6, -110],
];
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24, FRAME = 25;
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };

await say('Growing kelp…', 0.73, 2500);
const Wd = makeWorld(D, T, POSES);
for (const p of POSES) { p[1] += Wd.gy(p[0], p[2]); p[4] += Wd.gy(p[3], p[5]); }
const WSTAT = { terrainTris: T.ib.length / 3, big: Wd.big.n, small: Wd.small.n, props: Wd.props.map((p) => p.n), chunks: Wd.chunks.map((p) => p.n), fish: Wd.fish.length / 8, bubbles: Wd.bubbles.length / 8, loadS: performance.now() / 1000 };
D = Wd.gy = T.smp = null; // with gy goes the generator's working memory (about 200 MB)

await say('Building set pieces…', 0.94, 1200);
// mesh ids: 0-3 boulders, 4-6 sponges, 7-8 coral, 9 tube sponge, 10 table coral, 11 ship, 12 manta, 13 fish,
// 14-20 rock chunks + pebbles, 21-22 coral LOD, 23-25 far LOD of the large rock chunks, 26 brain coral, 27 encrusting mound
const meshes = [meshChunk(1, 3), meshChunk(7, 3), meshChunk(13, 3), meshChunk(22, 3),
  meshLathe([[0, 0, 0.5], [0.34, 0, 0.6], [0.5, 0.2, 0.85], [0.6, 0.6, 1], [0.55, 0.95, 1], [0.47, 1.08, 1], [0.38, 1.1, 0.9], [0.3, 1.0, 0.45], [0.26, 0.6, 0.15], [0, 0.35, 0.05]], 18, 0.3, 9),
  meshLathe([[0, 0, 0.5], [0.2, 0, 0.6], [0.26, 0.5, 0.85], [0.4, 1.25, 1], [0.4, 1.42, 1], [0.33, 1.48, 0.9], [0.26, 1.38, 0.4], [0.18, 0.8, 0.12], [0, 0.5, 0.05]], 16, 0.35, 8),
  meshLathe([[0, 0, 0.5], [0.5, 0, 0.7], [0.72, 0.18, 1], [0.74, 0.38, 1], [0.62, 0.5, 0.9], [0.48, 0.42, 0.45], [0.4, 0.2, 0.15], [0, 0.14, 0.06]], 18, 0.25, 10),
  meshCoral(0), meshCoral(1), meshTubes()].map((m) => m.build());
meshes.push(meshTable().build(), meshShip().build(), meshManta().build(), meshFish().build(),
  meshChunk(3).build(), meshChunk(11).build(), meshChunk(29).build(), meshChunk(5, 3).build(), meshChunk(17, 3).build(), meshChunk(41, 3).build(), meshChunk(9, 1).build(), meshCoral(0, 1).build(), meshCoral(1, 1).build(), meshChunk(5, 2, 1).build(), meshChunk(17, 2, 1).build(), meshChunk(41, 2, 1).build(), meshBrain().build(), meshMound().build());
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX);
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
const ibSolids = buf(solidData, BU.VERTEX);
const ibChunk = Wd.chunks.map((c) => buf(c.data, BU.VERTEX)), ibProp = Wd.props.map((c) => buf(c.data, BU.VERTEX));
const ibBig = buf(new Uint8Array(Wd.big.buf), BU.VERTEX), ibBigF = buf(new Uint8Array(Wd.bigF.buf), BU.VERTEX), ibSmall = buf(new Uint8Array(Wd.small.buf), BU.VERTEX);
const ibFish = buf(Wd.fish, BU.VERTEX), ibManta = buf(Wd.mantas, BU.VERTEX), ibBubbles = buf(Wd.bubbles, BU.VERTEX), ibSnowB = buf(Wd.snow, BU.VERTEX);
const nFish = Wd.fish.length / 8, nManta = Wd.mantas.length / 8, nBub = Wd.bubbles.length / 8, nSnow = Wd.snow.length / 4;
const MANTA = meshes[12], FISH = meshes[13];
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tMap }, Wd.gm, { bytesPerRow: 2048 }, [512, 512]);

// ---------------------------------------------------------------- one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s); curTile = -1; useTile(r, 4);
  r.setPipeline(pTerrSh);
  r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
  shadowEdge(r, T.start, 1, 0);
  r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  { const g = Wd.solids.ranges[11]; if (g[1]) for (let k = 0; k < 9; k++) { useTile(r, k); r.drawIndexed(meshes[11].ib.length, g[1], meshes[11].i0, meshes[11].v0, g[0]); } useTile(r, 4); }
  // small rocks, sponges and corals (~35M triangles) only on High: too much for a phone's driver
  if (!LV) for (let i = 0; i < NCHUNK; i++) { r.setVertexBuffer(1, ibChunk[i]); r.drawIndexed(meshes[14 + i].ib.length, Wd.chunks[i].n, meshes[14 + i].i0, meshes[14 + i].v0, 0); shadowEdge(r, Wd.chunks[i].start, meshes[14 + i], 0); }
  if (!LV) for (let i = 0; i < PROP_IDS.length; i++) if (Wd.props[i].n) { const me = meshes[PROP_IDS[i]]; r.setVertexBuffer(1, ibProp[i]); r.drawIndexed(me.ib.length, Wd.props[i].n, me.i0, me.v0, 0); shadowEdge(r, Wd.props[i].start, me, 0); }
  r.setPipeline(pLeafSh); r.setVertexBuffer(0, ibBig); r.draw(6, Wd.big.n); shadowEdge(r, Wd.big.start, false, 6);
  r.end();
  Q.submit([e.finish()]);
}
lauvKelp(Wd.big); // kelp leaves as segments for propeller fouling, before the generator's copy goes
lauvSolids(Wd, meshes); // the wreck, boulders and large rock chunks as colliders (lauv.js)
// the GPU has its own copies now: let go of the generator's (about 300 MB)
for (const o of [Wd.big, Wd.bigF, Wd.small, ...Wd.chunks, ...Wd.props]) o.buf = o.data = 0;
Wd.volD = Wd.gm = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window. frame() tunes it and the draw distance scale `det`
// for 60 fps; both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : LV > 1 ? 5e5 : 1920 * 1080, DETMIN = 0.4;
const QS = new URLSearchParams(location.search), RES1 = QS.get('res') === '1', FIXT = QS.has('t') ? +QS.get('t') : -1; // res=1: no dynamic resolution; t=: fixed animation time
// ?sync=1 starts the next frame only when the GPU has finished this one (like a display with back-pressure): the GPU timings
// and the frame rate measured in headless Chrome, which has none, are then true
const SYNC = QS.get('sync') === '1';
let W = 0, H = 0, DW = 0, DH = 0, pix = RES1 ? PIXMAX : +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = RES1 ? 1 : +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passDepth, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [], passTaa = [], bgTaa = [], bgPostK = [], bloomBG0 = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  // TAA: two history textures (ping-pong); everything after the scene reads the one just written instead of tRes
  const tHis = [0, 1].map(() => tex(TAA ? W : 1, TAA ? H : 1, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING)); targets.push(...tHis);
  const vHis = tHis.map((t) => t.createView());
  taaReset = 1;
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'load', depthStoreOp: 'store' } };
  passDepth = { colorAttachments: [], depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tWater.createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sVol }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bgPostK = [0, 1].map((k) => device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: TAA ? vHis[k] : vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] }));
  bloomBG0 = [0, 1].map((k) => blitBG(TAA ? vHis[k] : vRes));
  passTaa = [0, 1].map((k) => ({ colorAttachments: [colorAtt(vHis[k], false)] }));
  bgTaa = TAA ? [0, 1].map((k) => device.createBindGroup({ layout: pTaa.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboT } }, { binding: 1, resource: sClamp },
    { binding: 2, resource: vRes }, { binding: 3, resource: vHis[1 - k] }, { binding: 4, resource: vDp }] })) : [];
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
// per-pass GPU time (ms, smoothed over ~10 frames): water texture, scene, light shafts, shaft blur, bloom, composite.
// window.__perf.ms gives it to the test tools, dev.js shows it
const PASSES = ['water', 'scene', 'taa', 'rays', 'blur', 'bloom', 'post'], NPASS = PASSES.length, PASSMS = new Float64Array(NPASS), PASSRAW = new Float64Array(NPASS + 1);
const PERF = window.__perf = { cpu: 0, names: PASSES, ms: PASSMS, raw: PASSRAW, n: 0, get gpu() { return F[GPU]; } };
let qs, qResolve, qRead = [];
const tsw = (p, begin, end) => ({ querySet: qs, beginningOfPassWriteIndex: begin ? 2 * p : undefined, endOfPassWriteIndex: end ? 2 * p + 1 : undefined });
let tsWater0, tsWater4, tsScene0, tsScene1, tsTaa, tsRays, tsBlur, tsBloom0, tsBloomN, tsPost;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 * NPASS });
  qResolve = device.createBuffer({ size: 16 * NPASS, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16 * NPASS, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[2 * NPASS - 1] - a[0]) / 1e6; F[GPU] = ms;
      for (let p = 0; p < NPASS; p++) { const v = Number(a[2 * p + 1] - a[2 * p]) / 1e6; if (v >= 0 && v < 1e3) { PASSRAW[p] = v; PASSMS[p] += (v - PASSMS[p]) * 0.1; } }
      PASSRAW[NPASS] = ms; PERF.n++;
      b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsWater0 = tsw(0, 1, 0); tsWater4 = tsw(0, 0, 1); tsScene0 = tsw(1, 1, 0); tsScene1 = tsw(1, 0, 1); tsTaa = tsw(2, 1, 1); tsRays = tsw(3, 1, 1); tsBlur = tsw(4, 1, 1);
  tsBloom0 = tsw(5, 1, 0); tsBloomN = tsw(5, 0, 1); tsPost = tsw(6, 1, 1);
}

// ---------------------------------------------------------------- frame
let hud = false;
const SKIP = {}; for (const k of (QS.get('off') || '').split(',')) SKIP[k] = true; // ?off=terrain,chunks,props,big,small // debugging: SKIP.terrain / chunks / props / big / small = true leaves that set out of the frame
let drive = null; // scripted drive of the LAUV (see __world.drive)
let mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0;
// draw distance of rocks and props: past ~100 m the haze has taken nearly all of their colour (kelp keeps its own distances)
const DLOD = QS.has('dlod') ? +QS.get('dlod') : 0.75;
const JITS = 0.5; // jitter spread (pixels): less than 1 trades some edge smoothing for sharper detail
const JIT = [...Array(8)].map((_, i) => { const h = (n, b) => { let f = 1, r = 0; for (n++; n > 0; n = floor(n / b)) { f /= b; r += f * (n % b); } return r - 0.5; }; return [h(i, 2), h(i, 3)]; });
const TANH = 0.6, NEAR = 0.1, EXPO = 0.46, RAYS = 0.45;
const submitList = [null];
const rowOrds = Array.from({ length: 9 }, () => new Uint8Array(CELLS));
const IMGS = [4, 5, 3, 7, 1, 8, 6, 2, 0]; // the 3x3 copies of the tile: k = column + 3 * row, 4 is the base tile; nearest first
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by `det`, but not for the
// terrain) as merged runs, nearest rows first. The world repeats: every copy of the tile that comes within maxD is
// walked in its own frame (the camera moved by minus the copy's offset), and drawn with that copy's offset.
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let im = 0; im < 9; im++) {
    const kk = IMGS[im], cx = F[CX] - (kk % 3 - 1) * PER, cy = F[CY], cz = F[CZ] - (floor(kk / 3) - 1) * PER;
    const ex0 = max(abs(cx) - HPER, 0), ez0 = max(abs(cz) - HPER, 0);
    if (ex0 * ex0 + ez0 * ez0 >= max2) continue; // this whole copy is out of range
    const rowOrd = rowOrds[kk];
    for (let k = 0; k < CELLS; k++) {
      const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
      if (hz * hz >= max2) continue;
      let run = -1;
      for (let x = 0; x <= CELLS; x++) {
        const c = row + x; let v = false;
        if (x < CELLS) {
          const l = lo[c], h = hi[c];
          if (l <= h) {
            const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
            if (h2 < max2 && h2 >= min2) {
              const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
              if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
            }
          }
        }
        if (v) { if (run < 0) run = c; } else if (run >= 0) {
          const a = start[run], n = start[c] - a;
          if (n > 0) {
            useTile(r, kk);
            if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a);
          }
          run = -1;
        }
      }
    }
  }
}
// shadow bake: the cells of the 8 neighbouring tile copies that reach into the base tile's shadow range (they shade
// its edges), drawn with their offsets
function shadowEdge(r, start, indexed, verts) {
  const lim = HPER + SHREACH + CELLW * 0.5;
  for (let k = 0; k < 9; k++) {
    if (k === 4) continue;
    const ox = (k % 3 - 1) * PER, oz = (floor(k / 3) - 1) * PER;
    for (let rw = 0; rw < CELLS; rw++) {
      if (abs(OZ + (rw + 0.5) * CELLW + oz) > lim) continue;
      let run = -1;
      for (let x = 0; x <= CELLS; x++) {
        const c = rw * CELLS + x, v = x < CELLS && abs(OX + (x + 0.5) * CELLW + ox) <= lim;
        if (v) { if (run < 0) run = c; } else if (run >= 0) {
          const a = start[run], n = start[c] - a;
          if (n > 0) {
            useTile(r, k);
            if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a);
          }
          run = -1;
        }
      }
    }
  }
  useTile(r, 4);
}
// the opaque rock: terrain, the wreck, rock chunks and props. dp: depth only (pre-pass, see render()), so the expensive rock shader
// then runs only for the pixels that stay visible
function drawSolids(r, dp) {
  r.setBindGroup(0, bg0); curTile = -1; useTile(r, 4);
  r.setPipeline(dp ? pDTerrain : pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  if (!SKIP.terrain) drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 240);
  r.setPipeline(dp ? pDSolid : pSolid); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  { // the wreck: the copies of it that are near
    const g = Wd.solids.ranges[11];
    if (g[1]) for (let k = 0; k < 9; k++) if (hypot(F[CX] - (k % 3 - 1) * PER - Wd.shipPos[0], F[CZ] - (floor(k / 3) - 1) * PER - Wd.shipPos[2]) < 260) { useTile(r, k); r.drawIndexed(meshes[11].ib.length, g[1], meshes[11].i0, meshes[11].v0, g[0]); }
  }
  if (!SKIP.chunks) for (let i = 0; i < NCHUNK; i++) {
    const c = Wd.chunks[i], big = i > 2 && i < 6; r.setVertexBuffer(1, ibChunk[i]);
    drawCells(r, c.start, c.lo, c.hi, 3, meshes[14 + i], 0, 0, i > 5 ? 30 : big ? 40 : 96 * DLOD);
    if (big) drawCells(r, c.start, c.lo, c.hi, 3, meshes[20 + i], 0, 40, 150 * DLOD);
  }
  if (!SKIP.props) for (let i = 0; i < PROP_IDS.length; i++) {
    const id = PROP_IDS[i], lod = id === 7 || id === 8; r.setVertexBuffer(1, ibProp[i]);
    drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[id], 0, 0, lod ? 6 : (id < 4 ? 150 : 110) * DLOD);
    if (lod) drawCells(r, Wd.props[i].start, Wd.props[i].lo, Wd.props[i].hi, 3, meshes[14 + id], 0, 6, 110 * DLOD);
  }
  useTile(r, 4);
}
function render() {
  // camera basis (right vector is horizontal)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  m[51] = 0;
  let ek = (-cy - 8) / 26; ek = ek < 0 ? 0 : ek > 1 ? 1 : ek;
  m[56] = EXPO * (0.6 + 0.4 * ek); m[57] = RAYS; m[58] = det;
  lauvUpdate();
  if (TAA) {
    // sub-pixel jitter (Halton 2,3) added to the clip position; the unjittered matrix is kept for the next frame's reprojection
    CURVP.set(UB.subarray(0, 16));
    const hj = JIT[F[FRAME] & 7], jx = hj[0] * JITS * 2 / W, jy = hj[1] * JITS * 2 / H;
    for (let c = 0; c < 4; c++) { UB[c * 4] += jx * UB[c * 4 + 3]; UB[c * 4 + 1] += jy * UB[c * 4 + 3]; }
    F[FRAME]++;
    TUB.set(PREVVP, 0); TUB.set(UB.subarray(32, 48), 16); TUB[32] = W; TUB[33] = H; TUB[34] = 1 / W; TUB[35] = 1 / H; TUB[36] = 0.12; TUB[37] = taaReset;
    Q.writeBuffer(uboT, 0, TUB);
  }
  Q.writeBuffer(ubo, 0, UB);
  WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);

  for (let kk = 0; kk < 9; kk++) { // rows of each tile copy, nearest the camera first
    const ro = rowOrds[kk]; let cr = floor((cz - (floor(kk / 3) - 1) * PER - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr;
    let n = 0; ro[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) ro[n++] = cr - d; if (cr + d < CELLS) ro[n++] = cr + d; }
  }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  waterPass[0].timestampWrites = slot ? tsWater0 : undefined; waterPass[4].timestampWrites = slot ? tsWater4 : undefined;
  passRays.timestampWrites = slot ? tsRays : undefined; passBlur.timestampWrites = slot ? tsBlur : undefined;
  bloomPass[0].timestampWrites = slot ? tsBloom0 : undefined; bloomPass[bloomPass.length - 1].timestampWrites = slot ? tsBloomN : undefined;
  passPost.timestampWrites = slot ? tsPost : undefined;
  // animated water texture + mips
  let r = e.beginRenderPass(waterPass[0]); r.setPipeline(pWater); r.setBindGroup(0, bgWater); r.draw(3); r.end();
  for (let i = 1; i < 5; i++) { r = e.beginRenderPass(waterPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, waterBG[i - 1]); r.draw(3); r.end(); }
  // scene: a depth-only pass over the rock first, so the rock shader runs once per pixel however much rock overlaps
  passDepth.timestampWrites = slot ? tsScene0 : undefined; passScene.timestampWrites = slot ? tsScene1 : undefined;
  r = e.beginRenderPass(passDepth);
  drawSolids(r, true);
  r.end();
  r = e.beginRenderPass(passScene);
  drawSolids(r, false);
  r.setPipeline(pManta); r.setVertexBuffer(1, ibManta); r.drawIndexed(MANTA.ib.length, nManta, MANTA.i0, MANTA.v0, 0);
  r.setPipeline(pFish); r.setVertexBuffer(1, ibFish); r.drawIndexed(FISH.ib.length, nFish, FISH.i0, FISH.v0, 0);
  lauvDraw(r);
  for (const f of FAUNA) if (f.draw) f.draw(r);   // animals (fauna/*.js); each calls useTile itself
  // kelp and plants: 9-row blades up close, 5 rows mid-range, a decimated set far away
  if (!SKIP.big) {
    r.setPipeline(pLeaf); r.setVertexBuffer(0, ibBig); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 18, 0, 24);
    r.setPipeline(pLeaf5); drawCells(r, Wd.big.start, Wd.big.lo, Wd.big.hi, 5, false, 10, 24, 58);
    r.setPipeline(pLeafF); r.setVertexBuffer(0, ibBigF); drawCells(r, Wd.bigF.start, Wd.bigF.lo, Wd.bigF.hi, 5, false, 6, 58, 150);
  }
  if (!SKIP.small) { r.setPipeline(pLeafS); r.setVertexBuffer(0, ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 6, 0, 70); }
  useTile(r, 4);
  r.setPipeline(pSurf); r.draw(4);
  r.setPipeline(pBack); r.draw(4);
  r.setPipeline(pBub); r.setVertexBuffer(0, ibBubbles); r.draw(4, nBub);
  r.setPipeline(pSnow); r.setVertexBuffer(0, ibSnowB); r.draw(4, nSnow);
  lauvDrawParticles(r);
  r.end();
  if (TAA) {
    taaK ^= 1; passTaa[taaK].timestampWrites = slot ? tsTaa : undefined;
    r = e.beginRenderPass(passTaa[taaK]); r.setPipeline(pTaa); r.setBindGroup(0, bgTaa[taaK]); r.draw(3); r.end();
    PREVVP.set(CURVP); taaReset = 0;
  }
  // light shafts
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, i === 0 ? bloomBG0[taaK] : bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPostK[taaK]); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2 * NPASS, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16 * NPASS); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

const cv = (x, y, z) => { const b = CI[((x >> 2) & (CN - 1)) + CN * ((y >> 2) + NY / 4 * ((z >> 2) & (CN - 1)))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sdAt(wx, wy, wz) {
  let x = (wx - OX) / VS, y = (wy - OY) / VS, z = (wz - OZ) / VS;
  x -= NX * floor(x / NX); z -= NZ * floor(z / NZ); y = y < 0 ? 0 : y > NY - 2 ? NY - 2 : y;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; return (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}

let gPaused = false, gStep = 0;
function frame(now) {
  if (!SYNC) requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Dynamic resolution for 30+ fps: every second (0.4 s behind the menu) scale the load by k. Desktop High and Medium never
  // go below 1920x1080 pixels (PIXMIN): past that only the draw distance shrinks
  if (!RES1 && dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 20 and 28 ms (the 25 ms budget)
    if (g) { if (g > 28 || g < 20) k = 24 / g; }
    // without: slow (over 34 ms) for two periods in a row means less load, and twice as long before trying to go back up
    else if (a > 34) { dynOk = 0; if (++dynBad > 1) { k = 28 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // faster than 22 ms there is room; at the display's rate there is no telling how much, so try a little more now and then
    else { dynBad = 0; if (a < 22 && a < 15) k = 20 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), lo = min(PIXMIN, top), mid = max(top / 2, lo), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : lo) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('abyssal', [LV, pix < top ? pix | 0 : '', det]); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  // __app.pause/step: while paused the world only moves by what step() queued (deterministic clips, tools/clip.mjs)
  if (gPaused) { dt = gStep; gStep = 0; }
  if (FIXT < 0) F[TIME] += dt; else F[TIME] = FIXT;
  lauvFrame(dt, !menu, drive && !drive.done ? drive : null);
  for (const f of FAUNA) if (f.update) f.update(dt);
  if (drive && !drive.done) { drive.log.push(dtr); drive.xs.push(lv.pos[0]); drive.dist += drive.speed * dt; if (drive.dist >= drive.len) drive.done = true; }
  const c0 = performance.now(); render(); PERF.cpu = performance.now() - c0; // JS time of render(): draw-call encoding and submit
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
  if (SYNC) Q.onSubmittedWorkDone().then(() => requestAnimationFrame(frame));
}

// ---------------------------------------------------------------- input
const key = (e, v) => {
  if (lauvKeyEvent(e.code, v)) { if (v && e.code.startsWith('Arrow')) e.preventDefault(); return; }
  switch (e.code) {
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyC') lauvCycleCam();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') { const p = POSES[e.code.charCodeAt(5) - 49]; lauvFace(...p); }
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { lauvReleaseKeys(); touchReset(); };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
// touch controls: touch.js (throttle slider, 4-way stick, camera and menu buttons)

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
const bDive = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the dive button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bDive.textContent = 'Resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bDive.onclick = go; $('o').onclick = () => ui(true);
// detail buttons: the current level is lit, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('abyssal', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
lauvHudInit(); lauvFace(...POSES[0]);
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'abyssalLoad', ''); // the load counts as survived after 15 s of frames
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
// ---------------------------------------------------------------- test hooks (BRIEF.md): window.__app
window.__app = {
  ready: true,
  start() { if (menu) ui(false); lauvS.hintT = 0; },
  // pose in metres / radians (yaw 0 faces -z and grows towards +x, pitch up positive), u in m/s
  set(o = {}) {
    const p = lv.pos, y = o.yaw !== undefined ? o.yaw : lv.yaw, pt = o.pitch !== undefined ? o.pitch : lv.pitch;
    lauvPlace(o.x !== undefined ? o.x : p[0], o.y !== undefined ? o.y : p[1], o.z !== undefined ? o.z : p[2], y, pt);
    if (o.u !== undefined) lv.setSpeed(o.u);
    if (o.scratches !== undefined) lauvS.scratches = o.scratches;
    lauvS.acc = 0;
  },
  cam(mode) { lauvS.camMode = mode; lauvS.snap = 1; if (mode === 'chase') { lauvS.camAz = lauvS.camEl = 0; lauvS.camIdle = 9; } },
  state() {
    const hd = ((lv.yaw * 180 / PI) % 360 + 360) % 360;
    return { x: lv.pos[0], y: lv.pos[1], z: lv.pos[2], depth: -lv.pos[1], u: lv.v[0], roll: lv.roll, pitch: lv.pitch, yaw: lv.yaw, heading: hd, scratches: lauvS.scratches, fouled: lv.fouled > 0,
      throttle: lv.in.throttle, gpu: F[GPU], particles: lauvPN, contact: lauvHit.n, rpm: lv.rpm, thrust: lv.thrust, fins: Array.from(lv.servo), cam: lauvS.camMode, camPos: [lauvS.cpx, lauvS.cpy, lauvS.cpz], camTarget: [lauvS.tx, lauvS.ty, lauvS.tz], camYaw: lauvS.camYaw, fps: lauvS.fps, paused: lauvS.paused };
  },
  key(cmd, down) { lauvKey(cmd, down); },
  pause(b) { gPaused = !!b; },
  step(dt) { gStep += dt; },   // while paused: the next frame advances everything by dt
  hold(o) { lauvS.hold = o || null; lv.in.steer = o ? o.steer || 0 : 0; lv.in.pitch = o ? o.pitch || 0 : 0; },   // {steer, pitch} held regardless of the keyboard (tests)
  addCollider(fn) { lauvColliders.push(fn); },   // fn(x, y, z) -> signed distance in metres, > 0 inside the obstacle
  puff(x, y, z, n = 8) { for (let i = 0; i < n; i++) lauvEmit(x + rr(-.3, .3), y + rr(0, .3), z + rr(-.3, .3), rr(0.2, 0.45), 1, 0, 0.05, 0, 3.5, 1); },
  sound,   // test: build the audio graph without a gesture
  vehicle: lv,
  // test helper: advance the simulation by sec seconds at 60 Hz regardless of the frame rate
  sim(sec) { for (let t = 0; t < sec; t += 1 / 60) { lauvAdvance(1 / 60); lauvParticles(1 / 60); } lauvS.snap = 1; },
  kelpNear: lauvKelpNear, sdf: lauvSdf, solids: () => lsN, hit: lauvHit,
  kelpSample(n) { const o = [], N = lkSeg.length / 7, st = floor(N / n); for (let i = 0; i < n; i++) o.push(Array.from(lkSeg.subarray(i * st * 7, i * st * 7 + 7))); return o; },
};

// ---------------------------------------------------------------- test hooks (world piece)
// __world.set(x, y, z, yaw, pitch)  put the LAUV there (wrapped into the base tile, chase camera snaps behind it); yaw 0 looks along -z, pi/2 along +x
// __world.pose(i)                   the preset viewpoint i (0-5)
// __world.drive({len, yaw, pitch, y, speed, noclip})  the LAUV flies straight on at `speed` (26 m/s) for len metres, timed every frame, chase camera behind it
// __world.driveResult()             null while driving, then {frames, meters, max, p95, p99, mean, hitches}
// __world.state()                   the LAUV: x, y, z, yaw, pitch
window.__world = {
  ready: true, stats: WSTAT, skip: SKIP, gpu: () => F[GPU], ship: Wd.shipPos,
  set(x, y, z, yaw, pitch) { lauvPlace(x, y, z, yaw, pitch); lv.setSpeed(0); },
  pose(i) { lauvFace(...POSES[i]); },
  // y of the highest rock under (x, z) (from the collision bricks); setAbove puts the camera h metres above it
  floor(x, z) { const ix = floor((wrapT(x) - OX) / VS), iz = floor((wrapT(z) - OZ) / VS); for (let y = NY - 2; y > 0; y--) if (cv(ix, y, iz) > 0) return OY + (y + 0.5) * VS; return OY; },
  setAbove(x, z, h, yaw, pitch) { this.set(x, this.floor(x, z) + h, z, yaw, pitch); },
  // the ground map as a PNG data URL: sand yellow, rock grey, brighter = shallower floor
  mapImage() {
    const c = document.createElement('canvas'); c.width = NX; c.height = NZ; const g = c.getContext('2d'), im = g.createImageData(NX, NZ);
    for (let i = 0; i < NX * NZ; i++) { const s = MAP[i * 4], fl = clamp((MAP[i * 4 + 1] + 26) / 14, 0, 1) * 0.5 + 0.5, v = 255 * (1 - fl * 0.4); im.data.set([v * (0.5 + 0.5 * s), v * (0.5 + 0.4 * s), v * (0.5 - 0.1 * s), 255], i * 4); }
    g.putImageData(im, 0, 0);
    g.fillStyle = '#f00'; for (const m of MESAS) { g.fillRect((m[0] - OX) / VS - 2, (m[1] - OZ) / VS - 2, 4, 4); g.fillRect((m[2] - OX) / VS - 2, (m[3] - OZ) / VS - 2, 4, 4); }
    return c.toDataURL();
  },
  state: () => ({ x: lv.pos[0], y: lv.pos[1], z: lv.pos[2], yaw: lv.yaw, pitch: lv.pitch, tile: PER }),
  drive(o) {
    drive = { len: o.len || 768, dist: 0, log: [], xs: [], done: false, noclip: !!o.noclip, speed: o.speed || 26 };
    lauvPlace(lv.pos[0], o.y ?? lv.pos[1], lv.pos[2], o.yaw ?? lv.yaw, o.pitch || 0);
  },
  driveResult() {
    if (!drive || !drive.done) return null;
    lv.setSpeed(0);
    const d = drive.log.slice(3).sort((a, b) => a - b), mean = d.reduce((a, b) => a + b, 0) / d.length;
    // frames within 6 m of a seam (x = +-HPER) against all the others
    const near = [], rest = []; for (let i = 3; i < drive.log.length; i++) (abs(abs(drive.xs[i]) - HPER) < 6 ? near : rest).push(drive.log[i]);
    const mx = (a) => a.reduce((m, v) => max(m, v), 0), av = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    // frames per second over consecutive 0.5 s windows (rAF in headless Chrome delivers frames in bursts, so single frame times are noisy)
    const wins = []; for (let i = 3, t = 0, n = 0; i < drive.log.length; i++) { t += drive.log[i]; n++; if (t >= 500) { wins.push(n * 1000 / t); t = 0; n = 0; } }
    wins.sort((a, b) => a - b);
    return { frames: d.length, meters: +drive.dist.toFixed(1), mean: +mean.toFixed(2), p50: d[floor(d.length * 0.5)], p95: d[floor(d.length * 0.95)], p99: d[floor(d.length * 0.99)], max: d[d.length - 1], over50ms: d.filter((v) => v > 50).length,
      winFpsMin: +(wins[0] || 0).toFixed(1), winFpsP10: +(wins[floor(wins.length * 0.1)] || 0).toFixed(1), winFpsMedian: +(wins[floor(wins.length / 2)] || 0).toFixed(1), windowsUnder30: wins.filter((v) => v < 30).length, windows: wins.length,
      seamFrames: near.length, seamMean: +av(near).toFixed(2), seamMax: mx(near), otherMean: +av(rest).toFixed(2), otherMax: mx(rest) };
  },
};