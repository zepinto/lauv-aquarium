// node tools/worldmap.mjs PORT out.png : the world's ground map (sand yellow, rock grey) with the designed rock masses in red
import { launch } from './chrome.mjs';
import { writeFileSync } from 'node:fs';
const [port, out] = process.argv.slice(2);
const b = await launch(), page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://127.0.0.1:${port}/index.html?res=1`);
await page.waitForFunction(() => window.__world?.ready, null, { timeout: 240000 });
const url = await page.evaluate(() => __world.mapImage());
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(JSON.stringify(await page.evaluate(() => __world.stats)));
await b.close();
