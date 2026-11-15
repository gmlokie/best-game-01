# NEON RUSH

[![make.fun · best-game-01](https://make.fun/badge/best-game-01.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![rank](https://make.fun/badge/best-game-01/gmlokie/best-game-01/rank.svg)](https://make.fun/bounty/best-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)
[![reward](https://make.fun/badge/best-game-01/gmlokie/best-game-01/reward.svg)](https://make.fun/bounty/best-game-01?utm_source=github&utm_medium=readme&utm_campaign=best-game-01)

A real-3D neon synthwave circuit racer, built for make.fun's **best-game-01** bounty. Eight karts, three circuits, races of about two minutes — drift through the corners to charge your boost, ride the amber pads (which shift to new spots every lap), and beat seven AI rivals to the line, all from a chase camera over a banked, elevated track under a sunset sky. Or run the **Neon League**: a three-race championship season with points, credits, a garage shop for upgrades, and three AI difficulty levels.

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
| R | Restart the race / back to menu from the champion screen |
| M | Mute (in a race) / cycle mode (on the menu) |
| T | Cycle track (on the menu, single race) |
| D | Cycle AI difficulty (on the menu) |
| 1 / 2 / 3 | Buy an upgrade in the garage (between league races) |
| Enter | Start / continue to the next race |

## What's in the game

- **Driving with feel** — acceleration, braking, steering, drift + drift-boost, boost pads, off-track slowdown with camera shake, kart-to-kart and kart-to-wall collisions with sparks, and a live wind that pushes every kart sideways (shown in the HUD).
- **A real 3D scene** — perspective chase camera with an FOV kick on boost, a banked ribbon track with elevation changes, karts built from 3D primitives, neon edge glow, a bright asphalt surface with a glowing centre line and road markings, a sunset-gradient sky, fog, glowing pylons, arches, neon billboards, and a city skyline, lit by a warm low sun with shadows.
- **Three circuits, ~2-minute races** — Neon Loop (5 laps, balanced), Sunset Bay (5 laps, fast sweepers + hairpin), Void Circuit (6 laps, technical). Each lap the boost pads shift to new seeded spots, so no two laps play the same.
- **A real race** — 5–6 laps per circuit, with lap and checkpoint validation along the centerline, so cutting a corner never counts as a lap. Finish 8th and the results screen says so: OUT OF THE POINTS — TRY AGAIN.
- **Seven AI rivals** — each follows a racing line with its own lane, brakes for corners by reading the curvature ahead (with a short lookahead on tight bends, so nobody stalls in the S-curves), and rubber-bands gently so the pack stays together. Every rival has different top speed, cornering, and aggression.
- **Neon League championship** — three races, one per track, with Formula-style points (25-18-15-12-10-8-6-4), credits earned from finishing positions, and a garage shop between races: Top Speed, Handling, and Boost upgrades, three levels each. Three AI difficulties (Rookie / Pro / Legend) set the field's pace. Finishing league races unlocks the next track for single races.
- **Full HUD** — position (1st–8th), lap, speed, boost meter, race time, best lap, a live position tower, a minimap with a dot per kart, wind direction, and (in the league) championship points and credits.
- **Feedback everywhere** — drift smoke, boost flames, wall sparks, speed lines, screen shake, and a WebAudio synth soundtrack: engine hum tied to speed, boost whooshes, countdown beeps, and a podium fanfare.
- **Complete loop** — title screen with mode / track / difficulty select, 3-2-1-GO countdown, race, pause, results with full standings, lap times, and best lap, plus season standings, garage, and a champion screen in the league.

## Determinism

All randomness is seeded (a small seeded RNG) and physics runs at a fixed 120 Hz step, driven only by accumulated step time — the same seed always plays the same race. Screenshot scenes are deterministic too: `?shot=title|race|drift|results` simulates a real race from the fixed seed with the AI driving the player kart, then freezes it — so every screenshot shows honest gameplay, never staged numbers.

## Layout

- `game/index.html` — WebGL canvas + DOM HUD, import map for the vendored three.js
- `game/vendor/three.module.min.js` + `three.core.min.js` — three.js r187, vendored locally (never a CDN)
- `game/style.css` — page and HUD styling
- `game/src/main.js` — boot + fixed-timestep loop (physics decoupled from rendering)
- `game/src/rng.js` — seeded RNG
- `game/src/track.js` — three circuits (centerline with elevation + banking, boost pads, checkpoints, per-lap pad layouts); exactly 480 samples per track
- `game/src/physics.js` — kart kinematics, drift, collisions, wind
- `game/src/ai.js` — AI racing line, rubber-banding, skill, adaptive lookahead
- `game/src/race.js` — race state machine, lap/checkpoint validation, league flow, wind, pad shifts
- `game/src/league.js` — championship points, credits, shop, difficulties, track unlocks
- `game/src/render.js` — three.js renderer (3D scene, chase camera, lighting + shadows, track mesh, kart meshes, environment, 3D particles, track rebuilds)
- `game/src/hud.js` — DOM HUD (position, lap, speed, boost, time, minimap, tower, wind, league) and menu/pause/results/season/champion screens
- `game/src/particles.js` — 3D particles: smoke, flames, sparks, speed lines, confetti
- `game/src/audio.js` — WebAudio synth sounds
- `game/src/input.js` — keyboard + mouse input
- `game/src/shots.js` — deterministic `?shot=` scene setup
- `main.ts` — hands the game in: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`
- `screenshots/` — the four screenshots (title, race, drift, results)

## License

MIT — see [LICENSE](LICENSE).
