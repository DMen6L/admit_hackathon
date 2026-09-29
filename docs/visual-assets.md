# Wizard Duel visual assets

## Purpose

This directory documents the three Wizard Duel SVG boards stored in [`web/public/assets/design/`](../web/public/assets/design/). The boards are the visual source of truth for character proportions, animation timing, effects, collision guidance, and export naming.

They are reference boards, not runtime sprite atlases. Each SVG is one large illustrated canvas containing artwork and explanatory labels. Before the game can animate an individual character or effect, its frames must be exported into separate transparent images or a deliberately packed atlas.

The imported files use stable, lowercase, kebab-case names. The original files in Downloads remain unchanged.

## Asset inventory

| File | Canvas | Contents | Intended use |
| --- | ---: | --- | --- |
| [`wizard-duel-character-design.svg`](../web/public/assets/design/wizard-duel-character-design.svg) | 2200 × 1500 | Berik and Alisher hero sprites, palettes, turnarounds, silhouettes, costume callouts, pivots, sockets, hurtboxes, and export rules | Character art direction and frame-production reference |
| [`wizard-duel-vfx-library.svg`](../web/public/assets/design/wizard-duel-vfx-library.svg) | 2200 × 1450 | Fireball, shield, lightning, dodge smear, hit spark, casting glyph, and VFX implementation rules | Effect-frame and timing reference |
| [`wizard-duel-animation-implementation.svg`](../web/public/assets/design/wizard-duel-animation-implementation.svg) | 2200 × 1650 | Idle, fireball-cast, and dodge strips for both characters, plus gameplay event frames and naming examples | Animation-state and gameplay-event reference |

The SVGs are self-contained vector documents. They contain no scripts, embedded raster images, external links, or external asset references. Their text requests `Pixelify Sans` and `IBM Plex Mono`; a system monospace fallback is used when those fonts are unavailable.

## Characters

### Berik — Arcane Warden

Berik is the defensive, precise, controlled silhouette. His identity is built around a wide blue hat brim, a bright beard, gold chest trim, an asymmetric cloak, and cyan magic.

- Native body grid: 48 × 76 pixels inside a 64 × 96 transparent frame.
- Runtime pivot: bottom-center at `(32, 90)` in the source frame.
- Approximate casting-hand socket: `(47, 37)`.
- Hurtbox: torso only; the hat and cloak tails are visual and should not enlarge collision.
- Animation character: two-to-three-frame anticipation, clean follow-through, stable feet.

### Alisher — Ember Shade

Alisher is the aggressive, fast, deceptive silhouette. His identity is built around a tall red hood peak, a shadowed face, gold torso trim, angular sleeves, and orange flame.

- Native body grid: 48 × 76 pixels inside a 64 × 96 transparent frame.
- Runtime pivot: bottom-center at `(32, 90)` in the source frame.
- Approximate casting-hand socket: `(48, 36)`.
- Hurtbox: torso only; the hood and robe tails are visual and should not enlarge collision.
- Animation character: sharp anticipation, fast release, and longer cloth overshoot.

Both designs target a 192 × 288 battle export at 4× nearest-neighbor scale. Settled poses should align to integer pixels. Do not use interpolated scaling or universal black outlines.

## Animation contract

| Character | State | Frames | Frame time | Total | Gameplay event |
| --- | --- | ---: | ---: | ---: | --- |
| Berik | Idle | 6 | 120 ms | 720 ms | Loop; no state change |
| Berik | Cast fireball | 6 | 80 ms | 480 ms | Spawn projectile on frame 4 |
| Berik | Dodge | 6 | 60 ms | 360 ms | Invulnerable on frames 2–4; move 42 px |
| Alisher | Idle | 6 | 110 ms | 660 ms | Loop; faster cloak pulse |
| Alisher | Cast fireball | 6 | 70 ms | 420 ms | Spawn projectile on frame 3 |
| Alisher | Dodge | 6 | 50 ms | 300 ms | Invulnerable on frames 2–4; move 48 px |

Cast anticipation locks input for frames 1–2. Recovery prevents a second cast through the remaining cast frames. Dodge frame 1 has no invulnerability, and recovery frames 5–6 turn invulnerability off.

These timings are design data and should eventually live in typed game configuration rather than being inferred from filenames or hardcoded in rendering code.

## VFX contract

The VFX board defines the following sequences:

- Fireball: eight frames covering spawn, travel, and impact.
- Shield: six frames covering spawn, active state, and break.
- Lightning: six frames covering charge, strike, and afterglow.
- Dodge: five smear or ghost frames.
- Hit feedback: a dedicated hit-spark treatment.
- Cast glyph: five evolution frames.

Export effects on transparent 128 × 128 or 192 × 192 canvases. Scale them with nearest-neighbor sampling and `image-rendering: pixelated`. Glow should be built from stacked pixel layers and opacity, not blur filters. Projectile collision uses its logical center; trail pixels never collide. Impact art is separate from the travel loop.

Recommended render order:

```text
arena → characters → runes and VFX → HUD
```

## Naming and export workflow

Use this filename format:

```text
<owner-or-vfx>_<animation-or-effect>_<phase-if-needed>_<two-digit-frame>.png
```

Examples from the implementation board:

```text
berik_cast_fireball_01.png
alisher_dodge_04.png
vfx_fireball_travel_06.png
vfx_shield_spawn_03.png
```

Recommended production workflow:

1. Treat the SVG boards as immutable visual specifications while exporting.
2. Reconstruct or crop each frame onto its prescribed transparent source canvas.
3. Keep the same bottom-center pivot across every character frame.
4. Record sockets, hurtboxes, duration, looping, and event frames in typed metadata.
5. Export with exact integer coordinates and nearest-neighbor scaling.
6. Verify silhouettes at 1× and at 100% browser zoom on a 1366 × 768 viewport.
7. Pack frames into an atlas only after standalone exports and metadata have been validated.

A future runtime asset layout could be:

```text
web/public/assets/
├── design/                 # the three source/reference boards
├── characters/
│   ├── berik/
│   └── alisher/
├── vfx/
└── manifests/             # animation timing, pivots, sockets, and events
```

## Relationship to the current prototype

The current application recognizes hand-drawn triangle, circle, and lightning shapes. It emits spell events for Aegis Ward, Astral Veil, and Storm Lance, but it does not yet contain a duel scene, character state machine, combat simulation, sprite renderer, or VFX player.

The art boards introduce fireball, shield, lightning, dodge, and hit effects. These concepts are not all mapped one-to-one to the prototype's current spell bindings. That mapping should be decided explicitly when combat is implemented; importing the boards does not change gesture recognition or gameplay behavior.

## Refactor notes

- Removed download-copy suffixes and normalized all filenames.
- Formatted the previously single-line SVG sources so diffs and reviews are readable.
- Added accessible SVG titles and descriptions without changing the artwork.
- Preserved `shape-rendering="crispEdges"`, canvas dimensions, geometry, colors, labels, and timing notes.
- Kept the boards separate by responsibility instead of merging them into one oversized document.
