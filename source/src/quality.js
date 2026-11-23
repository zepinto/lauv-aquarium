// ============================================================================
// quality level, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th leaf, glint and pebble and bake fewer shadows;
// Low also drops anti-aliasing and uses coarser meshes, cheaper filtering and fewer light shaft steps.
// localStorage.abyssal = "level,pixels,detail". abyssalLoad is set while the world is built: still set on the next
// visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.abyssal || '').split(','); bad = localStorage.abyssalLoad; } catch {}
const UQ = new URLSearchParams(location.search); // ?lv=0|1|2 forces a level (not remembered), ?res=1 fixes the resolution (main.js)
LV = UQ.has('lv') ? +UQ.get('lv') : SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2 && !UQ.has('lv')) { SV = [++LV]; keep('abyssal', LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, TAA = UQ.has('aa') ? UQ.get('aa') === 't' : LV < 2, AA = UQ.has('aa') ? (UQ.get('aa') === '4' ? 4 : 1) : LV > 1 || TAA ? 1 : 4, WATER = LV > 1 ? 256 : 512, FASTSH = !UQ.has('sh9'), RAYN = LV > 1 ? 12 : 34;
