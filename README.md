# NEBULA RUN — Velocity Drift

High-speed Three.js browser racer. Fly the glowing orb down an infinite neon
lane, thread the octagon gates, and reach the finish at the end of sector 8.

## Play

```bash
node serve.mjs
# open http://localhost:8741
```

No build. Everything is procedural + vendored Three.js.

## Controls

- A / D or Left/Right — steer
- SPACE — boost (drains the meter)
- SHIFT — brake (refills the meter)
- ESC / P — pause
- R — restart the run
- Mouse steering optional: click the canvas to lock the pointer

## Gameplay

- Race 8 sectors (~3.4 km) to the finish gate; your time and score are saved
- 3 shields — hitting a block or spinner costs one and resets your combo
- Energy orbs: score + boost + combo (up to x8)
- Octagon gates: big score, bigger if you pass dead-center (PERFECT)
- Speed builds the deeper you get; obstacles get denser to match

## Tech notes

- The track centerline is an analytic function of distance, so the world is
  infinite, always smooth, and generated/recycled in 48-unit chunks
- All collisions happen in track space (distance + lateral offset) with swept
  checks, so nothing tunnels at high speed and hitboxes are slightly smaller
  than visuals — grazes are forgiven
- Same seed every run: the track is learnable for time-attack
- Synth WebAudio engine hum + pickup / gate / hit / crash sfx
- Metaloot platform integration for cloud saves and rewards
