// Deterministic clips for behaviour critics: pause the game, then step it by dt and grab every frame.
//   node tools/clip.mjs PORT clip.json OUTPREFIX
// clip.json: {"q": "res=1", "setup": "js run once (place the vehicle, spawn animals, set the camera)",
//             "every": "optional js run before each step (e.g. steer: __app.key('left', true))",
//             "frames": 120, "dt": 0.0333, "sheet": 12}
// Needs window.__app.pause(bool) and window.__app.step(dt) (advance the vehicle, animals, particles and animation time
// by dt while paused, then let the next rAF draw it). Writes OUTPREFIX.mp4 (30 fps) and OUTPREFIX_sheet.jpg (a contact
// sheet of 'sheet' frames evenly spaced, 4 per row) that a critic can view with the Read tool.
import { launch } from './chrome.mjs';
import { grab } from './grab.mjs';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// no GPU lock for frames: it starved tools/fps.sh. fps.sh alone takes the lock; the lead measures authoritatively at merges.
const [port, specFile, out] = process.argv.slice(2);
const s = JSON.parse(readFileSync(specFile, 'utf8'));
const N = s.frames ?? 120, dt = s.dt ?? 1 / 30, tmp = out + '_frames';
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const b = await launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('pageerror: ' + e.message));
await p.goto(`http://127.0.0.1:${port}/index.html?${s.q || 'res=1'}`);
await p.waitForFunction(() => window.__app?.ready, null, { timeout: 180000 });
await p.evaluate(() => window.__app.start());
await p.waitForTimeout(2500);
if (s.setup) await p.evaluate(s.setup);
await p.waitForTimeout(1500);
await p.evaluate(() => window.__app.pause(true));
for (let i = 0; i < N; i++) {
  if (s.every) await p.evaluate(s.every);
  await p.evaluate((dt) => window.__app.step(dt), dt);
  await grab(p, `${tmp}/f${String(i).padStart(4, '0')}.png`);
}
await b.close();
spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '30', '-i', `${tmp}/f%04d.png`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out + '.mp4']);
const k = s.sheet ?? 12, pick = Array.from({ length: k }, (_, i) => Math.round(i * (N - 1) / (k - 1)));
const sel = pick.map(i => `eq(n\\,${i})`).join('+');
spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${tmp}/f%04d.png`, '-vf', `select='${sel}',scale=640:360,tile=4x${Math.ceil(k / 4)}`, '-frames:v', '1', '-q:v', '3', out + '_sheet.jpg']);
console.log(JSON.stringify({ mp4: out + '.mp4', sheet: out + '_sheet.jpg', frames: N, dt }));
