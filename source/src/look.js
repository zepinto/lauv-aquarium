// ============================================================================
// LOOK: scanned material textures (CC0, Poly Haven; see LICENSES) for rock, sand and coral rubble
// ============================================================================
// Two 2D-array textures of LOOK_LAYERS layers at 1024x1024 with full mip chains: albedo (sRGB) and normal xy + height.
// lookTextures() creates them at once (so bind groups can be made) and starts loading; await .ready before drawing.
const LOOK_LAYERS = ['seaside_rock', 'rock_face_03', 'rock_pitted_mossy', 'tiger_rock', 'rock_boulder_cracked', 'sand_03', 'coral_ground_02', 'coral_gravel'];
const LOOK_SIZE = 1024, LOOK_MIPS = 11;
function lookTextures() {
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
  const mk = (format) => device.createTexture({ size: [LOOK_SIZE, LOOK_SIZE, LOOK_LAYERS.length], format, usage, mipLevelCount: LOOK_MIPS });
  const alb = mk('rgba8unorm-srgb'), nh = mk('rgba8unorm');
  const code = `@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
    @fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, fc.xy * 2. / vec2f(textureDimensions(t)), 0.); }`;
  const m = device.createShaderModule({ code }), smp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const pipe = (format) => device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format }] } });
  const pA = pipe('rgba8unorm-srgb'), pN = pipe('rgba8unorm');
  const mips = (tex, p, layer) => {
    const e = device.createCommandEncoder();
    for (let i = 1; i < LOOK_MIPS; i++) {
      const src = tex.createView({ dimension: '2d', baseMipLevel: i - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const dst = tex.createView({ dimension: '2d', baseMipLevel: i, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
      const r = e.beginRenderPass({ colorAttachments: [{ view: dst, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      r.setPipeline(p); r.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: src }, { binding: 1, resource: smp }] })); r.draw(3); r.end();
    }
    device.queue.submit([e.finish()]);
  };
  const load = async (tex, p, layer, url) => {
    const b = await (await fetch(url)).blob();
    const im = await createImageBitmap(b, { colorSpaceConversion: 'none' });
    device.queue.copyExternalImageToTexture({ source: im }, { texture: tex, origin: [0, 0, layer] }, [LOOK_SIZE, LOOK_SIZE]);
    im.close(); mips(tex, p, layer);
  };
  const ready = Promise.all(LOOK_LAYERS.flatMap((n, i) => [load(alb, pA, i, `textures/${i}_${n}_alb.jpg`), load(nh, pN, i, `textures/${i}_${n}_nh.jpg`)]));
  return { alb, nh, ready, albView: alb.createView({ dimension: '2d-array' }), nhView: nh.createView({ dimension: '2d-array' }) };
}
