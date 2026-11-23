// Screenshots and fps of the game at 1920x1080 in headless Chrome (WebGPU on the Intel Arc).
//   node tools/shoot.mjs PORT shots.json OUTPREFIX [--fps]
// shots.json: [{"name": "reef", "q": "url query", "js": "code run in the page before the shot", "wait": 2500}, ...]
// The page must expose window.__app (see BRIEF.md): ready, start(). Without it the base game's 'Dive in' button is clicked.
// Frames are read back in-page (headless Chrome does not composite WebGPU canvases). With --fps each shot also gets
// 4 s of uncapped rAF timing; run it through tools/fps.sh so only one agent times the GPU at a time.
import { launch } from './chrome.mjs';
import { grab } from './grab.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// GPU lock: screenshots hold it shared, fps.sh holds it exclusive, so timings never overlap another agent's renders.
// no GPU lock for frames: it starved tools/fps.sh. fps.sh alone takes the lock; the lead measures authoritatively at merges.
const [port, shotsFile, out, flag] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(shotsFile, 'utf8'));
const b = await launch();
const res = [];
let page = null, lastQ = null;
for (const s of shots) {
  if (s.q !== lastQ || !page) {
    if (page) await page.close();
    page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', e => console.log('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console: ' + m.text().slice(0, 300)); });
    await page.goto(`http://127.0.0.1:${port}/${process.env.PAGE || 'index.html'}?${s.q || ''}`);
    const hasApp = await page.waitForFunction(() => window.__app?.ready || document.querySelector('#d:not([disabled])')?.offsetParent, null, { timeout: 180000 }).then(() => page.evaluate(() => !!window.__app?.ready));
    if (hasApp) await page.evaluate(() => window.__app.start?.()); else await page.click('#d').catch(() => {});
    await page.waitForTimeout(3000);
    lastQ = s.q;
  }
  if (s.js) await page.evaluate(s.js);
  await page.waitForTimeout(s.wait ?? 2500);
  const r = { name: s.name };
  if (flag === '--fps') {
    // rAF pacing in headless Chrome is unreliable (no back-pressure), so the per-frame GPU total from window.__perf is the gate
    const { ts, gpu } = await page.evaluate(() => new Promise(res => { const ts = [], gpu = [], t0 = performance.now(), P = window.__perf; let n = -1;
      function f(t) { ts.push(t); if (P && P.n !== n) { n = P.n; gpu.push(P.gpu); } if (t - t0 < 4000) requestAnimationFrame(f); else res({ ts, gpu }); } requestAnimationFrame(f); }));
    gpu.sort((a, b) => a - b);
    const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b), mean = d.reduce((a, b) => a + b, 0) / d.length;
    Object.assign(r, { fps: +(1000 / mean).toFixed(1), p95ms: +d[Math.floor(d.length * .95)].toFixed(1) });
    if (gpu.length) Object.assign(r, { gpuMean: +(gpu.reduce((a, b) => a + b, 0) / gpu.length).toFixed(1), gpuP95: +gpu[Math.floor(gpu.length * .95)].toFixed(1), gpuN: gpu.length });
  }
  r.canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return c.width + 'x' + c.height; });
  if (s.stat) r.stat = await page.evaluate(s.stat);
  await grab(page, `${out}_${s.name}.png`);
  r.png = `${out}_${s.name}.png`;
  console.log(JSON.stringify(r)); res.push(r);
}
await b.close();
