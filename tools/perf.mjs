// Per-pass GPU ms at the 6 preset poses, 1920x1080, for several URL queries in one go (no frames saved).
//   node tools/perf.mjs PORT "res=1" "res=1&aa=2" ...   (run under flock /home/zp/workspace/lauv-aquarium/.gpu.lock)
// Needs window.__perf (main.js). Prints per query: pose -> 10th percentile (best frames, the GPU is shared) over 6 s of [water scene rays blur bloom post] ms, gpu total, fps.
import { launch } from './chrome.mjs';
const [port, ...qs] = process.argv.slice(2);
const POSES = (process.env.POSES || '1,2,3,4,5,6').split(',').map(Number);
const b = await launch();
for (const q of qs) {
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => console.log('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:' + port + '/' + (process.env.PAGE || 'index.html') + '?' + q);
  await page.waitForFunction(() => window.__perf && document.querySelector('#d:not([disabled])')?.offsetParent, null, { timeout: 260000 });
  await page.click('#d').catch(() => {});
  await page.waitForTimeout(1500);
  const rows = [];
  for (const p of POSES) {
    await page.evaluate(p => dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit' + p })), p);
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => new Promise(res => { const ts = [], g = [], t0 = performance.now(), P = window.__perf; let n = -1;
      function f(t) { ts.push(t); if (P.n !== n) { n = P.n; g.push([...P.raw, P.cpu || 0]); } if (t - t0 < 4000) requestAnimationFrame(f); else res({ ts, g }); } requestAnimationFrame(f); }));
    const d = r.ts.slice(1).map((t, i) => t - r.ts[i]), mean = d.reduce((a, c) => a + c, 0) / d.length;
    const pc = (i, q) => { const s = r.g.map(x => x[i]).sort((a, c) => a - c); return s.length ? s[Math.floor((s.length - 1) * q)] : -1; };
    const last = r.g[0].map((_, i) => pc(i, 0.05)), med = pc(1, 0.5);
    rows.push({ p, med: +med.toFixed(1), ms: last.slice(0, last.length - 2).map(v => +v.toFixed(2)), gpu: +last[last.length - 2].toFixed(2), cpu: +last[last.length - 1].toFixed(2), fps: +(1000 / mean).toFixed(1), p95: +d.slice().sort((a, c) => a - c)[Math.floor(d.length * .95)].toFixed(1) });
  }
  console.log(q + '\n' + rows.map(r => '  p' + r.p + ' ' + JSON.stringify(r.ms) + ' (scene median ' + r.med + ') gpu ' + r.gpu + ' fps ' + r.fps + ' p95 ' + r.p95).join('\n'));
  await page.close();
}
await b.close();
