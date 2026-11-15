# NEON RUSH

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/gmlokie/best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/gmlokie/best-game-01/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A real-3D neon synthwave circuit racer, built for make.fun's **best-game-01** bounty. Eight karts, one glowing loop, three laps — drift through the corners to charge your boost, ride the amber pads, and beat seven AI rivals to the line, all from a chase camera over a banked, elevated track under a sunset sky.

## Play it

Serve `game/` with any static server and open it in desktop Chrome:

```sh
node serve.ts
# then open http://localhost:8080
```

No build step, no network requests, no external files — three.js is vendored locally under `game/vendor/`, and everything else (art, sound, fonts) is drawn or synthesized in the browser.

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrow keys | Drive and steer |
| Shift (hold) | Drift through a corner — release for a boost burst |
| Space | Boost (spends the boost meter) |
| P | Pause |
| R | Restart the race |
| M | Mute |

## What's in the game

- **Driving with feel** — acceleration, braking, steering, drift + drift-boost, boost pads, off-track slowdown with camera shake, kart-to-kart and kart-to-wall collisions with sparks.
- **A real 3D scene** — perspective chase camera with an FOV kick on boost, a banked ribbon track with elevation changes, karts built from 3D primitives, neon edge glow, a sunset-gradient sky, fog, glowing pylons, arches, and a city skyline, lit by a warm low sun with shadows.
- **A real race** — 3 laps on the Neon Loop circuit, with lap and checkpoint validation along the centerline, so cutting a corner never counts as a lap.
- **Seven AI rivals** — each follows a racing line with its own lane, brakes for corners by reading the curvature ahead, and rubber-bands gently so the pack stays together. Every rival has different top speed, cornering, and aggression.
- **Full HUD** — position (1st–8th), lap, speed, boost meter, race time, best lap, a live position tower, and a minimap with a dot per kart.
- **Feedback everywhere** — drift smoke, boost flames, wall sparks, speed lines, screen shake, and a WebAudio synth soundtrack: engine hum tied to speed, boost whooshes, countdown beeps, and a podium fanfare.
- **Complete loop** — title screen with controls, 3-2-1-GO countdown, race, pause, and a results screen with full standings, lap times, best lap, and a restart prompt.

## Determinism

All randomness is seeded (a small seeded RNG) and physics runs at a fixed 120 Hz step, driven only by accumulated step time — the same seed always plays the same race. Screenshot scenes are deterministic too: `?shot=title|race|drift|results` sets up the exact scene from the fixed seed.

## Layout

- `game/index.html` — WebGL canvas + DOM HUD, import map for the vendored three.js
- `game/vendor/three.module.min.js` + `three.core.min.js` — three.js r187, vendored locally (never a CDN)
- `game/style.css` — page and HUD styling
- `game/src/main.js` — boot + fixed-timestep loop (physics decoupled from rendering)
- `game/src/rng.js` — seeded RNG
- `game/src/track.js` — circuit centerline with elevation + banking, boost pads, checkpoints
- `game/src/physics.js` — kart kinematics, drift, collisions
- `game/src/ai.js` — AI racing line, rubber-banding, skill
- `game/src/race.js` — race state machine, lap/checkpoint validation
- `game/src/render.js` — three.js renderer (3D scene, chase camera, lighting + shadows, track mesh, kart meshes, environment, 3D particles)
- `game/src/hud.js` — DOM HUD (position, lap, speed, boost, time, minimap, tower) and menu/pause/results screens
- `game/src/particles.js` — 3D particles: smoke, flames, sparks, speed lines, confetti
- `game/src/audio.js` — WebAudio synth sounds
- `game/src/input.js` — keyboard + mouse input
- `game/src/shots.js` — deterministic `?shot=` scene setup
- `main.ts` — hands the game in: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`
- `screenshots/` — the four screenshots (title, race, drift, results)

## License

MIT — see [LICENSE](LICENSE).
