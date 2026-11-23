// Scripted 2-tile drive of the free camera along +x (no collision) with frame timing and frame grabs near the seam.
//   HEADLESS=1 node tools/drive.mjs PORT OUTPREFIX [y=-9] [z=-60] [tiles=2]
// For timing run it through flock like tools/fps.sh does (the shared GPU lock).
import { launch } from './chrome.mjs';
import { grab } from './grab.mjs';
const [port, out, yS, zS, tilesS] = process.argv.slice(2);
const y = +(yS ?? -9), z = +(zS ?? -60), tiles = +(tilesS ?? 2), yaw = Math.PI / 2;
const b = await launch(), page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?res=1`);
await page.waitForFunction(() => window.__world?.ready, null, { timeout: 240000 });
await page.click('#d').catch(() => {});
await page.waitForTimeout(3000);
const tile = await page.evaluate(() => __world.state().tile);
// start on the seam, 2 m inside the tile: two more seams are crossed during the drive
await page.evaluate(([tile, y, z, yaw, tiles]) => { __world.set(-tile / 2 + 2, y, z, yaw, 0); __world.drive({ len: tile * tiles, yaw, y, pitch: 0, noclip: true }); }, [tile, y, z, yaw, tiles]);
let shot = 0, last = 0;
for (;;) {
  const r = await page.evaluate(() => __world.driveResult());
  if (r) { console.log(JSON.stringify(r)); break; }
  const x = (await page.evaluate(() => __world.state())).x;
  if (Math.abs(x) > tile / 2 - 12 && shot < 30 && Date.now() - last > 120) { last = Date.now(); await grab(page, `${out}_${String(shot++).padStart(2, '0')}_x${x.toFixed(1)}.png`); }
  await page.waitForTimeout(30);
}
await b.close();
