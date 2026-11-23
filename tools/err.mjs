import { launch } from './chrome.mjs';
const b = await launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('pageerror: ' + e.message + ' | ' + (e.stack||'').slice(0,500)));
await p.goto('http://127.0.0.1:' + process.argv[2] + '/' + process.argv[3]); await p.waitForFunction(()=>window.__app&&window.__app.ready,null,{timeout:120000}); await p.evaluate(()=>{__app.start();__world.pose(1);__app.cam('chase')}); await p.waitForTimeout(8000); await b.close();