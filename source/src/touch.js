// ============================================================================
// touch controls (phones and tablets, landscape): two fingers at once.
// Left: throttle slider (-0.3 reverse .. 1 full), it stays where it is released.
// Right: 4-way stick (left / right = rudder, up = climb, down = dive), springs back to centre.
// Top right: camera (tap to cycle) and menu. Shown on coarse pointers, or with ?touch=1.
// ============================================================================
const TOUCH_UI = mob || /[?&]touch=1/.test(location.search);
const touchEls = {};
function touchReset() { lauvTouch.steer = 0; lauvTouch.pitch = 0; if (touchEls.knob) touchEls.knob.style.transform = ''; if (touchEls.pad) touchEls.pad.classList.remove('on'); touchEls.dir = ''; }
if (TOUCH_UI) {
  document.documentElement.classList.add('tc');
  const st = document.createElement('style');
  st.textContent = 'html.tc,html.tc body{touch-action:none;overscroll-behavior:none}' +
    '#tc{display:none;position:absolute;inset:0;pointer-events:none;-webkit-tap-highlight-color:transparent;font:700 clamp(11px,2.6vmin,18px)/1.2 system-ui,sans-serif;color:#fff}' +
    '.g #tc{display:block}#tc *{touch-action:none;-webkit-user-select:none;user-select:none}' +
    '#tc .ct{position:absolute;pointer-events:auto;background:rgba(18,48,92,.42);border:2px solid rgba(33,117,188,.85);box-shadow:0 .2em 1em rgba(0,0,0,.35);backdrop-filter:blur(2px)}' +
    // throttle: a tall rounded slot on the left
    '#tth{left:max(2vmin,env(safe-area-inset-left));bottom:max(3vmin,env(safe-area-inset-bottom));width:min(22vmin,96px);height:min(68vh,300px);border-radius:999px}' +
    '#tth .sl{position:absolute;left:50%;top:7%;bottom:7%;width:34%;margin-left:-17%;border-radius:999px;background:rgba(11,31,63,.7);border:1px solid #C3D0E0;overflow:hidden}' +
    '#tth .fl{position:absolute;left:0;right:0;background:#F07A1E}' +
    '#tth .zr{position:absolute;left:8%;right:8%;height:2px;background:#fff;opacity:.9}' +
    '#tth .th{position:absolute;left:50%;width:92%;height:11%;margin-left:-46%;border-radius:999px;background:#fff;border:3px solid #F07A1E;box-shadow:0 .15em .6em rgba(0,0,0,.5);will-change:transform}' +
    '#tth .lb{position:absolute;left:0;right:0;text-align:center;font-size:.75em;letter-spacing:.12em;color:#EAF2FB;text-shadow:0 1px 3px #000}' +
    // stick
    '#tpd{right:max(3vmin,env(safe-area-inset-right));bottom:max(3vmin,env(safe-area-inset-bottom));width:min(44vmin,190px);height:min(44vmin,190px);border-radius:50%}' +
    '#tpd.on{background:rgba(18,48,92,.55);border-color:#2175BC}' +
    '#tpd .ar{position:absolute;width:0;height:0;border:solid transparent;opacity:.8}' +
    '#tpd .ar.u{left:50%;top:6%;margin-left:-.6em;border-width:0 .6em 1em;border-bottom-color:#EAF2FB}' +
    '#tpd .ar.d{left:50%;bottom:6%;margin-left:-.6em;border-width:1em .6em 0;border-top-color:#EAF2FB}' +
    '#tpd .ar.l{top:50%;left:6%;margin-top:-.6em;border-width:.6em 1em .6em 0;border-right-color:#EAF2FB}' +
    '#tpd .ar.r{top:50%;right:6%;margin-top:-.6em;border-width:.6em 0 .6em 1em;border-left-color:#EAF2FB}' +
    '#tpd .ar.a{opacity:1;filter:drop-shadow(0 0 4px #F07A1E)}' +
    '#tpd .ar.u.a{border-bottom-color:#F07A1E}#tpd .ar.d.a{border-top-color:#F07A1E}#tpd .ar.l.a{border-right-color:#F07A1E}#tpd .ar.r.a{border-left-color:#F07A1E}' +
    '#tpd .kn{position:absolute;left:50%;top:50%;width:38%;height:38%;margin:-19%;border-radius:50%;background:rgba(255,255,255,.88);border:3px solid #F07A1E;box-shadow:0 .15em .6em rgba(0,0,0,.5);will-change:transform}' +
    '#tpd .tx{position:absolute;left:0;right:0;top:-1.6em;text-align:center;font-size:.75em;letter-spacing:.12em;color:#EAF2FB;text-shadow:0 1px 3px #000}' +
    // buttons
    '#tc .bt{display:flex;flex-direction:column;align-items:center;justify-content:center;width:min(15vmin,64px);height:min(15vmin,64px);border-radius:.9em;right:max(2vmin,env(safe-area-inset-right));text-align:center;font-size:.8em;letter-spacing:.08em}' +
    '#tc .bt:active,#tc .bt.on{background:rgba(240,122,30,.75);border-color:#fff}' +
    '#tcm{top:max(2vmin,env(safe-area-inset-top))}#tcc{top:calc(max(2vmin,env(safe-area-inset-top)) + min(15vmin,64px) + 1.4vmin)}' +
    '#tcc svg,#tcm svg{width:48%;height:48%;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '#tcc small{font-size:.7em;color:#EAF2FB;text-transform:uppercase}' +
    // the base's own buttons and hints give way; the stats panel moves to the top left and shrinks
    '.tc #o,.tc #hk,.tc #i{display:none!important}' +
    '.tc #hl{bottom:auto;top:max(1.5vmin,env(safe-area-inset-top));left:max(1.5vmin,env(safe-area-inset-left));min-width:0;font-size:.75em;grid-template-columns:repeat(4,auto);padding:.35em .6em;background:rgba(18,48,92,.6)!important}' +
    '.tc #hl .th{display:none}.tc #hw{top:auto;bottom:4vmin;font-size:.85em}';
  document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'tc';
  root.innerHTML = '<div id=tth class=ct><div class=lb style="top:1.2%">FWD</div><div class=sl><i class=fl></i><i class=zr></i></div><i class=th></i><div class=lb style="bottom:1.2%">REV</div></div>' +
    '<div id=tpd class=ct><span class=tx>STEER · CLIMB · DIVE</span><i class="ar u"></i><i class="ar d"></i><i class="ar l"></i><i class="ar r"></i><i class=kn></i></div>' +
    '<button id=tcc class="ct bt" aria-label="Camera"><svg viewBox="0 0 24 24"><path d="M3 8h4l1.5-2h7L17 8h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg><small id=tcn>chase</small></button>' +
    '<button id=tcm class="ct bt" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>';
  document.body.appendChild(root);
  const q = (i) => document.getElementById(i);
  const th = q('tth'), pad = q('tpd'), knob = pad.querySelector('.kn'), thumb = th.querySelector('.th'), fill = th.querySelector('.fl'), zero = th.querySelector('.zr'), slot = th.querySelector('.sl');
  Object.assign(touchEls, { pad, knob, dir: '' });
  const arrows = { u: pad.querySelector('.u'), d: pad.querySelector('.d'), l: pad.querySelector('.l'), r: pad.querySelector('.r') };
  // finger offset from an element's centre in the page's own axes (the page is turned on its side in portrait)
  const local = (e, el) => { const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.right) / 2, dy = e.clientY - (r.top + r.bottom) / 2; return rot.matches ? [dy, -dx] : [dx, dy]; };
  const own = (el, e) => { if (el.pid !== undefined && el.pid !== e.pointerId) return false; return true; };
  // ---- throttle
  const TMIN = -0.3, TMAX = 1, ZERO = -TMIN / (TMAX - TMIN);   // zero sits 23% up the slot
  let shown = NaN;
  const showThrottle = () => {
    const t = lv.in.throttle; if (t === shown) return; shown = t;
    const sh = slot.offsetHeight, top = slot.offsetTop, f = (t - TMIN) / (TMAX - TMIN), y = top + sh * (1 - f) - thumb.offsetHeight / 2;
    thumb.style.top = '0'; thumb.style.transform = 'translateY(' + y + 'px)';
    zero.style.top = (100 * (1 - ZERO)) + '%'; zero.style.transform = 'translateY(-1px)';
    if (t >= 0) { fill.style.top = (100 * (1 - f)) + '%'; fill.style.bottom = (100 * ZERO) + '%'; } else { fill.style.top = (100 * (1 - ZERO)) + '%'; fill.style.bottom = (100 * f) + '%'; }
  };
  const setThrottle = (e) => {
    const [, ly] = local(e, slot), sh = slot.offsetHeight || 1;
    let f = 0.5 - ly / sh; f = f < 0 ? 0 : f > 1 ? 1 : f;
    let t = TMIN + f * (TMAX - TMIN); t = Math.round(t * 20) / 20; if (Math.abs(t) < 0.06) t = 0;
    lv.in.throttle = t; lauvS.hint = 0; showThrottle();
  };
  th.addEventListener('pointerdown', (e) => { if (th.pid !== undefined) return; th.pid = e.pointerId; th.setPointerCapture(e.pointerId); e.preventDefault(); sound(); setThrottle(e); });
  th.addEventListener('pointermove', (e) => { if (e.pointerId === th.pid) setThrottle(e); });
  const thEnd = (e) => { if (e.pointerId === th.pid) th.pid = undefined; };
  th.addEventListener('pointerup', thEnd); th.addEventListener('pointercancel', thEnd); th.addEventListener('lostpointercapture', thEnd);
  // ---- stick
  const stick = (e) => {
    const [lx, ly] = local(e, pad), R = pad.offsetWidth * 0.5, rk = R * 0.62;   // the knob travels 62% of the radius
    let x = lx, y = ly; const l = Math.hypot(x, y); if (l > rk) { x *= rk / l; y *= rk / l; }
    knob.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    // dead zone 12%, rescaled so full deflection is still 1
    const f = (v) => { v /= rk; const a = Math.abs(v); return a < 0.12 ? 0 : Math.sign(v) * Math.min(1, (a - 0.12) / 0.78); };
    lauvTouch.steer = f(x); lauvTouch.pitch = -f(y);
    arrows.l.classList.toggle('a', lauvTouch.steer < -0.2); arrows.r.classList.toggle('a', lauvTouch.steer > 0.2);
    arrows.u.classList.toggle('a', lauvTouch.pitch > 0.2); arrows.d.classList.toggle('a', lauvTouch.pitch < -0.2);
    lauvS.hint = 0;
  };
  pad.addEventListener('pointerdown', (e) => { if (pad.pid !== undefined) return; pad.pid = e.pointerId; pad.setPointerCapture(e.pointerId); e.preventDefault(); sound(); pad.classList.add('on'); stick(e); });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === pad.pid) stick(e); });
  const padEnd = (e) => { if (e.pointerId === pad.pid) { pad.pid = undefined; touchReset(); for (const k in arrows) arrows[k].classList.remove('a'); } };
  pad.addEventListener('pointerup', padEnd); pad.addEventListener('pointercancel', padEnd); pad.addEventListener('lostpointercapture', padEnd);
  // ---- buttons
  q('tcc').addEventListener('click', () => { sound(); lauvCycleCam(); });
  q('tcm').addEventListener('click', () => ui(true));
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('blur', () => { th.pid = pad.pid = undefined; touchReset(); });
  const camName = q('tcn'); let camShown = '';
  setInterval(() => { showThrottle(); if (lauvS.camMode !== camShown) { camShown = lauvS.camMode; camName.textContent = camShown; } }, 50);
  window.__touch = { level: LV, mobile: mob, throttle: () => lv.in.throttle, stick: () => [lauvTouch.steer, lauvTouch.pitch] };
}
