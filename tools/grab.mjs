// in-page frame grab: headless Chrome doesn't composite WebGPU canvases, so read the canvas in the rAF task right
// after the app has drawn (callbacks run in registration order; the app's was queued in the previous frame).
export async function grab(page, path) {
  const url = await page.evaluate(() => new Promise(res => requestAnimationFrame(() => res(document.querySelector('canvas').toDataURL('image/png')))));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
}
