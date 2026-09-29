# Wizard Duel visual assets

## Purpose

This directory documents the four Wizard Duel SVG boards stored in [`web/public/assets/design/`](../web/public/assets/design/). Together they are the visual source of truth for the duel-screen composition, character proportions, animation timing, effects, collision guidance, and export naming.

They are reference boards, not runtime sprite atlases or application screens. Each SVG is one large illustrated canvas containing artwork and explanatory labels. Before the game can animate an individual character or effect, its frames must be exported into separate transparent images or a deliberately packed atlas; the duel-screen mockup must be implemented as responsive UI rather than embedded as one image.

The three production boards use lowercase, kebab-case names. `duel_file.svg` retains its supplied filename so existing references to the asset remain stable.

## Asset inventory

| File | Canvas | Contents | Intended use |
| --- | ---: | --- | --- |
| [`duel_file.svg`](../web/public/assets/design/duel_file.svg) | 1600 × 1000 | Complete desktop duel-screen mockup with arena, combat HUD, camera status, rune recognition feedback, spell legend, and dodge instruction | Layout, visual hierarchy, UI-state, and gameplay-integration reference |
| [`wizard-duel-character-design.svg`](../web/public/assets/design/wizard-duel-character-design.svg) | 2200 × 1500 | Berik and Alisher hero sprites, palettes, turnarounds, silhouettes, costume callouts, pivots, sockets, hurtboxes, and export rules | Character art direction and frame-production reference |
| [`wizard-duel-vfx-library.svg`](../web/public/assets/design/wizard-duel-vfx-library.svg) | 2200 × 1450 | Fireball, shield, lightning, dodge smear, hit spark, casting glyph, and VFX implementation rules | Effect-frame and timing reference |
| [`wizard-duel-animation-implementation.svg`](../web/public/assets/design/wizard-duel-animation-implementation.svg) | 2200 × 1650 | Idle, fireball-cast, and dodge strips for both characters, plus gameplay event frames and naming examples | Animation-state and gameplay-event reference |

The SVGs are self-contained vector documents. They contain no scripts, embedded raster images, external links, or external asset references. The three production boards request `Pixelify Sans` and `IBM Plex Mono`, with a system monospace fallback when those fonts are unavailable. The duel-screen mockup converts its lettering to vector paths, so it has no runtime font dependency.

## Duel-screen composition

`duel_file.svg` presents the intended desktop battle view at 1600 × 1000. It is a visual target, not a pixel-perfect requirement for every viewport. Preserve the hierarchy and states while allowing the implementation to reflow at smaller sizes.

- Header: “Wizard Duel” identity and the “Webcam-controlled multiplayer combat” descriptor.
- Match HUD: Berik and Alisher names, opposing health bars (`85 / 100` and `72 / 100` in the example), a `01:24` duel timer, and round `1 / 3` status.
- Arena: a moonlit, symmetrical pixel-art battleground with both wizards, projectile and shield effects, and explicit `CASTING` and `INCOMING` state labels.
- Camera panel: a mirrored `170 × 112` preview, tracking-skeleton overlay, and positive `Hand detected` tracking state.
- Rune-casting panel: the recognized triangle glyph, `FIREBALL` result, `91%` accuracy, and a confidence/progress bar.
- Rune legend: triangle maps to Fireball, circle to Shield, and `Z` to Lightning; leaning left or right triggers Dodge.

The layout uses a near-black and navy base, pale-gold headings and focus details, blue for Berik and defensive magic, red/orange for Alisher and offensive magic, and green for successful tracking and recognition. Thin blue borders, squared pixel geometry, and generous panel spacing establish the interface language. When implementing it, keep status meaning available through text or icons rather than color alone, and build health, timer, round, camera, recognition, and spell states as live semantic UI.

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
├── design/                 # the four source/reference boards
├── characters/
│   ├── berik/
│   └── alisher/
├── vfx/
└── manifests/             # animation timing, pivots, sockets, and events
```

## Relationship to the current prototype

The current application recognizes hand-drawn triangle, circle, and lightning shapes. It emits spell events for Aegis Ward, Astral Veil, and Storm Lance, but it does not yet contain a duel scene, character state machine, combat simulation, sprite renderer, or VFX player.

The art boards introduce fireball, shield, lightning, dodge, and hit effects. The duel-screen mockup goes further by proposing triangle → Fireball, circle → Shield, `Z` → Lightning, and lateral leaning → Dodge. These concepts are not mapped one-to-one to the prototype's current spell bindings (`Aegis Ward`, `Astral Veil`, and `Storm Lance`). Treat the mockup mappings as design proposals until combat configuration explicitly adopts them; importing the boards does not change gesture recognition or gameplay behavior.

## Refactor notes

- Removed download-copy suffixes and normalized the three production-board filenames.
- Formatted the previously single-line SVG sources so diffs and reviews are readable.
- Added accessible SVG titles and descriptions without changing the artwork.
- Preserved the supplied `duel_file.svg` filename while documenting its different naming convention.
- Preserved `shape-rendering="crispEdges"`, canvas dimensions, geometry, colors, labels, and timing notes.
- Kept the boards separate by responsibility instead of merging them into one oversized document.
