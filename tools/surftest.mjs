// physics check at the surface: node tools/surftest.mjs PORT
import { launch } from './chrome.mjs';
const b = await launch(); const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', e => console.log('pageerror: ' + e.message));
await p.goto('http://127.0.0.1:' + process.argv[2] + '/index.html?res=1&hud=0&t=5');
await p.waitForFunction(() => window.__app?.ready, null, { timeout: 180000 });
await p.evaluate(() => __app.start());
const out = await p.evaluate(() => {
  const r = [], A = __app, v = A.vehicle;
  for (const u of [0, 1.2]) {
    A.set({ x: 0, y: -0.05, z: 0, yaw: 0.4, pitch: 0, u }); A.hold({ steer: 0, pitch: 0 });
    let pmin = 9, pmax = -9, ymin = 9, ymax = -9;
    for (let t = 0; t < 30; t += 0.5) {
      A.sim(0.5); const s = A.state();
      if (t > 8) { pmin = Math.min(pmin, s.pitch); pmax = Math.max(pmax, s.pitch); ymin = Math.min(ymin, s.y); ymax = Math.max(ymax, s.y); }
      if (t % 5 === 0) r.push(['u' + u, 't' + t, 'y' + s.y.toFixed(3), 'surfY' + v.surfY.toFixed(3), 'pitch' + (s.pitch * 57.3).toFixed(1), 'uu' + s.u.toFixed(2), 'rpm' + Math.round(s.rpm)]);
    }
    r.push(['u' + u, 'pitch deg ' + (pmin * 57.3).toFixed(1) + ' .. ' + (pmax * 57.3).toFixed(1), 'y ' + ymin.toFixed(3) + ' .. ' + ymax.toFixed(3)]);
  }
  return r;
});
for (const l of out) console.log(l.join(' '));
await b.close();
