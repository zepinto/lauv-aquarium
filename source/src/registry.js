// ============================================================================
// registry for the animals and other systems added on top of the scene (fauna/*.js)
// ============================================================================
// Each fauna file pushes one object: { name, init() (async, runs once after the pipelines exist), update(dt) (every frame,
// dt = 0 while paused unless __app.step), draw(r) (inside the scene pass, after the vehicle; call useTile(r, 4) first
// and draw the nearest copy across the torus seam) }. Files in src/fauna/ are concatenated after this one, before main.js.
const FAUNA = [];
