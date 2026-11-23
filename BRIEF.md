# LAUV Aquarium: builder brief

Goal: a realistic, aquarium-like underwater game in the browser. The player flies an OceanScan LAUV through an endless
reef and explores it the way you do in Ecco the Dolphin: no score, no timer, just see the place without scratching
the vehicle. It starts from Abyssal Garden (WebGPU, no engine; `source/`), which we keep and extend. Size no longer
matters (models, textures and sound files are allowed); the visuals must be better than the original's and it must
hold **30+ fps at 1920x1080 on this laptop's Intel Arc 140T** (Chrome 157).

The work is judged by a gauntlet: for each piece a separate harsh critic with fresh context puts our frames next to
the bar **blind** (labels stripped, tools/blind.py), picks which is better, and names the single biggest gap. You never
grade your own work. Loop until the critic picks ours.

## The bar
- Visual: **Subnautica's** shallow-water footage (Safe Shallows, Kelp Forest, Grassy Plateaus; also the view from the
  surface). Frames and clips: `/home/zp/workspace/lauv-aquarium/refs/bar/` (see its index.md once it exists).
- Animal behaviour: real footage of each animal (in `refs/bar/` too): a school splitting and re-forming round a diver,
  a sardine bait ball, dolphins bow/wake riding, a ray lifting off the sand, an octopus flashing colour, inking, hiding.
- Measurable: fps at 1920x1080, internal render at full resolution (dynamic resolution off, `?res=1`), at every
  critic pose and during a scripted drive: min ≥ 30 fps, p95 frame ≤ 40 ms. Time it only with `tools/fps.sh`.

## The vehicle
- Model: `source/lauv-omst.glb` (copied from ~/workspace/lauv-ocean-3d/public; metres; nose x=0, tail x=1.782,
  Ø0.148 m, mast +y; calibrated mass 29.8 kg). Materials and look: ~/workspace/lauv-ocean-3d/src/lauv/LauvModel.js.
- Physics and control: port the underwater part of ~/workspace/lauv-ocean-3d/src/lauv/LauvPhysics.js and
  DuneControl.js (rigid body, Morison drag, added mass, propeller thrust, fin lift, slight positive buoyancy). It is a
  real LAUV: it has to keep moving to dive and turn (fins need flow), it drifts up slowly with no thrust,
  max ≈ 2 m/s. Roll is held at 0 automatically (roll controller on the fins).
- Commands (keyboard, also gamepad if cheap): left / right (rudder), up / down (climb / dive, elevator),
  thrust up / thrust down (throttle steps, a little reverse allowed). Arrows + W/S by default; show them on screen once.
- Kelp can foul the propeller (thrust drops, the vehicle drags a strand; reversing clears it). It hits rocks and the
  bottom: real contact (stops, bounces, scrapes), sediment puff, sound, and a scratch counter that is the only "score".
- At the surface the camera shows the scene from above the water (sky, sun, waves, the vehicle awash, the
  reef seen through the water), crossing smoothly to the underwater view.
- Camera: a chase camera that feels good (lag, collision with rocks), plus a free look with the mouse.

## The world
- Endless: it repeats seamlessly like Pac-Man (a torus in x and z); the player can keep going forever with no seam,
  no pop, no edge. Fauna and particles wrap too.
- Realistic reef, not fantasy: drop or rework what reads as fantasy next to the bar.
- World units are metres. Check the base's scale against a 1.8 m vehicle and real kelp, rock and fish sizes.

## Fauna (all react to the vehicle)
Fish schools (scatter and re-form, boids on the GPU), sardine bait ball (splits round the vehicle, flashes silver),
dolphins (come to look, ride the wake near the surface, clicks), rays (glide, lift off the sand and glide off),
octopuses (change colour and texture, ink, jet away and hide in rocks), plus small reef fish, crabs or what fits.

## Repository and rules
- Lead's tree: /home/zp/workspace/lauv-aquarium (branch `main`). Each builder works in its own worktree
  /home/zp/workspace/git-worktrees/lauv-aquarium-<piece> on branch `<piece>`, commits there (small commits), never on
  main. The lead merges. Keep changes inside your piece; when you must touch a shared spot (main.js render loop,
  shaders.js common code), keep the edit small and list it in your report.
- Build: `cd source && npm install && npm run build` writes `index.html` (single file is no longer required; the glb
  may be inlined or served next to it). Serve your worktree root with `python3 -m http.server <port> --bind 127.0.0.1`
  (WebGPU needs localhost). Ports: pick 5310-5399, one per worktree.
- Code: plain JS modules + WGSL like the existing code; readable names in new code; no per-frame allocations.
- Performance is a hard gate: say what your piece costs in ms at 1080p.

## Test hooks (window.__app; keep them working, extend as needed)
`ready` (bool, world built), `start()` (skip the menu, start playing), `set({x,y,z,yaw,pitch,u})` (vehicle pose,
speed m/s), `cam(mode)` ('chase', 'side', 'front', 'top', 'surface', 'free'), `state()` (x, y, z, depth, u, roll,
pitch, yaw, scratches, fouled, fps), `key(cmd, down)` (cmd: left right up down thrustUp thrustDown), `pause(bool)`.
URL: `res=1` (no dynamic resolution), `seed=`, `hud=0`, `t=` (fixed time of day/animation if useful).

## Tools (from the repo root; playwright-core is in the root node_modules: run `npm i` there too)
- `node tools/shoot.mjs PORT shots.json shots/<piece>/rN` — 1920x1080 frames read back in-page; shots.json is
  [{name, q, js, wait, stat}] (js runs in the page before the frame, e.g. `__app.set({...});__app.cam('side')`).
- `tools/fps.sh PORT shots.json OUTPREFIX` — same plus fps/p95 per shot, under the shared GPU lock.
- `python3 tools/blind.py OUTDIR SECRET.json ours.png:bar.jpg ...` — blind A/B pairs for the critic. Keep SECRET out
  of the critic's folder.
- Frames: view PNG/JPG with the Read tool. ffmpeg, `uvx yt-dlp` are available.

## Report back
Files changed, commits, what you measured (fps per pose at 1080p), the frames that best show your piece, the critic's
last verdict, and the biggest remaining gap.
