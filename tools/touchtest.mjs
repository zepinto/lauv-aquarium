// Multi-touch test: node tools/touchtest.mjs PORT OUTPREFIX [WxH ...]
// Emulates a touch phone/tablet, drives the throttle slider and the 4-way stick with two fingers at once through CDP
// Input.dispatchTouchEvent, prints state() before/after and saves screenshots (canvas composited under the DOM controls).
import { launch } from './chrome.mjs';
import { writeFileSync } from 'node:fs';
const [port, out, ...sizes] = process.argv.slice(2);
const b = await launch();
for (const sz of (sizes.length ? sizes : ['915x412', '1180x820'])) {
  const [w, h] = sz.split('x').map(Number);
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('pageerror ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/index.html?res=1&' + (process.env.Q || ''));
  await page.waitForFunction(() => window.__app?.ready, null, { timeout: 120000 });
  await page.evaluate(() => { __app.start(); __app.set({ x: 0, y: -8, z: 0, yaw: 0, pitch: 0, u: 0 }); __app.cam('chase'); __app.key('thrustDown', 1); __app.key('thrustDown', 0); });
  await page.evaluate(() => { __app.vehicle.in.throttle = 0; __app.vehicle.setSpeed(0); });
  await page.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(page);
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const slot = await rect('#tth .sl'), pad = await rect('#tpd');
  const tp = (id, x, y) => ({ x, y, id, radiusX: 12, radiusY: 12, force: 1 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const shot = async (name) => {
    const url = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(document.querySelector('canvas').toDataURL('image/png')))));
    await page.evaluate((u) => { let i = document.getElementById('bg'); if (!i) { i = document.createElement('img'); i.id = 'bg'; i.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1'; document.body.prepend(i); } i.src = u; document.querySelector('canvas').style.opacity = 0; }, url);
    await page.waitForTimeout(200);
    await page.screenshot({ path: out + '-' + sz + '-' + name + '.png' });
  };
  const st = () => page.evaluate(() => { const s = __app.state(); return { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), u: +s.u.toFixed(2), yaw: +s.yaw.toFixed(3), pitch: +s.pitch.toFixed(3), throttle: s.throttle, rpm: Math.round(s.rpm), touch: __touch.stick(), level: __touch.level, fps: Math.round(s.fps) }; });
  console.log(sz, 'before', JSON.stringify(await st()));
  await shot('idle');
  // finger 1 on the slider at 75% of its height, finger 2 on the stick centre; then finger 2 pushes right+up, both held
  const sx = slot.x + slot.w / 2, sy = slot.y + slot.h * 0.25, cx = pad.x + pad.w / 2, cy = pad.y + pad.h / 2, R = pad.w * 0.3;
  await touch('touchStart', [tp(1, sx, sy + 40), tp(2, cx, cy)]);
  for (let i = 0; i <= 20; i++) { await touch('touchMove', [tp(1, sx, sy + 40 - 40 * i / 20), tp(2, cx + R * i / 20, cy - R * i / 20)]); await page.waitForTimeout(30); }
  await page.waitForTimeout(2500);
  console.log(sz, 'both fingers (speed + right/climb)', JSON.stringify(await st()));
  await shot('both');
  await page.waitForTimeout(1500);
  console.log(sz, 'after 1.5 s more', JSON.stringify(await st()));
  // lift the stick finger only: steering returns to 0, throttle stays
  await touch('touchEnd', [tp(1, sx, sy)]);
  await page.waitForTimeout(500);
  console.log(sz, 'stick released, throttle finger still down', JSON.stringify(await st()));
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  console.log(sz, 'all released (throttle stays)', JSON.stringify(await st()));
  // second drive: left + dive, throttle pulled to reverse
  await touch('touchStart', [tp(3, sx, slot.y + slot.h * 0.97), tp(4, cx, cy)]);
  for (let i = 0; i <= 10; i++) { await touch('touchMove', [tp(3, sx, slot.y + slot.h * 0.97), tp(4, cx - R * i / 10, cy + R * i / 10)]); await page.waitForTimeout(30); }
  await page.waitForTimeout(1500);
  console.log(sz, 'reverse + left/dive', JSON.stringify(await st()));
  await shot('reverse');
  await touch('touchEnd', []);
  // buttons
  const cam = await rect('#tcc'); await touch('touchStart', [tp(5, cam.x + cam.w / 2, cam.y + cam.h / 2)]); await touch('touchEnd', []);
  await page.waitForTimeout(300);
  console.log(sz, 'camera after tap', await page.evaluate(() => __app.state().cam));
  const men = await rect('#tcm'); await touch('touchStart', [tp(6, men.x + men.w / 2, men.y + men.h / 2)]); await touch('touchEnd', []);
  await page.waitForTimeout(500);
  console.log(sz, 'menu open', await page.evaluate(() => document.body.className));
  await ctx.close();
}
await b.close();
