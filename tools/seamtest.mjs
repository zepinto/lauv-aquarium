// Numeric seam test: the height of the sea floor (from the collision bricks) just across the tile seam compared with
// the same step taken at random places inside the tile. Wrapping is exact if the seam steps look like the interior ones.
//   HEADLESS=1 node tools/seamtest.mjs PORT
import { launch } from './chrome.mjs';
const [port] = process.argv.slice(2);
const b = await launch(), page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/index.html?res=1`);
await page.waitForFunction(() => window.__world?.ready, null, { timeout: 240000 });
const res = await page.evaluate(() => {
  const P = __world.state().tile, h = P / 2, f = (x, z) => __world.floor(x, z), out = {};
  const stat = (a) => { a.sort((x, y) => x - y); const n = a.length; return { n, mean: +(a.reduce((s, v) => s + v, 0) / n).toFixed(3), p99: a[Math.floor(n * 0.99)], max: a[n - 1], over2m: +(a.filter((v) => v > 2).length / n).toFixed(4) }; };
  const seamX = [], seamZ = [], inX = [], inZ = [];
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 4000; i++) {
    const t = (rnd() * 2 - 1) * (h - 2), e = 0.25;
    seamX.push(Math.abs(f(h - e, t) - f(h + e, t)));       // across x = +h (= -h)
    seamX.push(Math.abs(f(-h - e, t) - f(-h + e, t)));
    seamZ.push(Math.abs(f(t, h - e) - f(t, h + e)));
    seamZ.push(Math.abs(f(t, -h - e) - f(t, -h + e)));
    const x = (rnd() * 2 - 1) * (h - 4), z = (rnd() * 2 - 1) * (h - 4);
    inX.push(Math.abs(f(x - e, z) - f(x + e, z)));
    inZ.push(Math.abs(f(x, z - e) - f(x, z + e)));
    // positions one tile apart must agree exactly
    if (Math.abs(f(x, z) - f(x + P, z + 2 * P)) > 1e-9) out.mismatch = (out.mismatch || 0) + 1;
  }
  return { seamX: stat(seamX), seamZ: stat(seamZ), interiorX: stat(inX), interiorZ: stat(inZ), mismatch: out.mismatch || 0 };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
