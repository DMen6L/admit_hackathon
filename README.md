# Webcam Magic Game

> A browser magic game where the player's body is the controller, powered by real-time computer vision.

## Purpose of this document

This README records the project's vision, architecture, and current implementation. The browser app in `web/` includes sign-in, a mode-selection lobby, local training, and private two-player duels.

The central interaction is fixed. Balance, presentation, and deployment details still need playtesting; distinguish implemented behavior from proposed improvements below.

## Run the hand-tracking prototype

The browser prototype uses TypeScript, Vite, and MediaPipe Hand Landmarker. It tracks up to two hands, draws their landmarks over a mirrored webcam preview, and displays how many hands are detected. All camera processing happens in the browser.

For development, install a current Node.js version supported by Vite (Node 22.12+ or a newer supported release) and npm, then run:

```bash
cd web
npm ci
npm run setup
npm run dev
```

Open the localhost URL shown in the terminal, click **Start camera**, and allow webcam access. Use **Stop camera** to release the camera. Camera access requires localhost or HTTPS; opening the HTML file directly is not the supported development workflow.

## Run the API and PostgreSQL

From the repository root, copy `.env.example` to `.env`, replace the development secrets, and start the services:

```bash
cp .env.example .env
docker compose up --build
```

The API is available at `http://localhost:8000`, PostgreSQL at `localhost:5432`, and migrations run automatically when the API container starts. Create an account in the browser's registration mode, or run `python scripts/smoke_auth.py` to create a test account and verify `/api/auth/me`. The frontend calls the database-backed API at `http://127.0.0.1:8000` by default; set `VITE_API_BASE_URL` before starting Vite to use another API origin.

If another local PostgreSQL service already owns host port `5432`, set `POSTGRES_PORT=5433` in `.env` (the API still uses PostgreSQL's internal Compose port `5432`).

The sign-in screen uses the API-backed account service. Start the backend with `docker compose up --build`, then create an account from **Create an account**. Passwords are hashed by the API and never stored in the browser.

The backend exposes `POST /api/auth/register`, `POST /api/auth/login`, and `GET /api/auth/me`. Copy `.env.example` to `.env` and replace the development JWT secret and PostgreSQL password before sharing the service. The frontend uses `VITE_API_BASE_URL` when supplied, otherwise `http://127.0.0.1:8000`.

Click your name in the lobby or arena to open `/profile.html`. There you can edit the display name shown in new duels without changing the login used to sign in. `GET /api/profile` returns the account and online duel totals; `PATCH /api/profile` updates the display name. Online wins, losses, and draws are recorded by the server when a room finishes. Local training-bot matches are deliberately excluded from those totals.

The lobby also links to `/tutorial.html`, a seven-lesson guided casting course. It teaches the six currently implemented runes in order, then asks the player to shield against a three-second fireball warning. Each lesson requires a recognized cast to continue and gives correction feedback after a wrong or unclear stroke. Mouse/touch drawing works without a camera; webcam casting uses the same hand tracker and shape evaluator as battle. The tutorial is local practice and does not change online duel statistics. See [the tutorial plan](docs/tutorial-plan.md).

Confirmed casts in the tutorial and duel play spell-specific sounds. In duels, attack sounds begin when the projectile is visibly moving and fade by impact; warnings remain silent and disappear at launch. An opponent attack only sounds after its charging warning was shown and the projectile has moved a short distance, so late network snapshots cannot play an attack cue alongside a newly appearing warning. Your own attack cue still starts at release. Shield and Time Lock sound when their effects activate. All six spells use distinct locally bundled recordings, with synthesized cues as fallback if a recording cannot load. Playback removes quiet lead-in, is capped at two seconds, and is level-adjusted to avoid long, delayed effects. The Sound on/off control in either screen remembers the player's choice in the browser. Browsers require a user interaction before audio can play; clicking Start camera, drawing, or using a spell button unlocks sound. Audio is not uploaded. See [audio credits](web/public/assets/audio/README.md) for sources and licenses.

The user-supplied background track loops quietly during active practice and online matches and throughout the tutorial. It pauses when the duel is paused, finished, disconnected, or hidden, and follows the same Sound on/off setting. Browsers may block its first play until the user clicks, taps, or presses a key. The WAV is currently about 28 MB; a compressed replacement would reduce download size before deployment.

## Play an online duel

Start the API/PostgreSQL and frontend as above. After sign-in, the lobby at `/lobby.html` offers **Face the training bot** (a local scripted opponent) or **Challenge a friend**. For a friend duel, sign in with two different accounts in separate browsers or private windows. One player chooses **Create a room**, then copies the invite link from the arena; the other opens that link or enters its six-character code in the lobby. Invite links survive sign-in. The match starts when both players connect. All six webcam runes and manual spell buttons send commands to the server. The server owns health, shields, Time Lock delays, warnings, damage, and winner; the browser only animates its snapshots and plays sounds for confirmed casts. **Back to lobby** returns to the mode selection. This first version holds rooms in one API process and loses them on restart. See [the multiplayer plan](docs/multiplayer-plan.md) for the protocol and remaining reliability work.

`npm run setup` downloads Google's pretrained `hand_landmarker.task` model and copies the WebAssembly runtime from the installed MediaPipe package. Both are served locally by the app. The generated assets are ignored by Git; rerun setup after installing or updating dependencies. Players do not need Node.js, Python, or a local installation.

The initial files are:

- [`web/src/main.ts`](web/src/main.ts): camera lifecycle, frame processing, and the landmark overlay.
- [`web/src/vision/hand-tracker.ts`](web/src/vision/hand-tracker.ts): MediaPipe initialization and tracking configuration.
- [`web/src/input/process-hands.ts`](web/src/input/process-hands.ts): custom gesture and open-palm release state, with corrective-feedback data.
- [`web/src/drawing/path-recorder.ts`](web/src/drawing/path-recorder.ts): normalized index-fingertip strokes recorded until a deliberate release.
- [`web/src/shapes/shape-evaluator.ts`](web/src/shapes/shape-evaluator.ts): tolerant topology, turn, closure, direction, proportion, and circle-radial matching with shape corrections.
- [`web/src/spells/spell-resolver.ts`](web/src/spells/spell-resolver.ts): converts confirmed shape IDs into versioned, JSON-safe spell messages and configurable frontend spell/rune definitions.
- [`web/src/ui/cast-result.ts`](web/src/ui/cast-result.ts): testable presentation states for successful, near-miss, failed, and cancelled casts.
- [`web/index.html`](web/index.html) and [`web/src/style.css`](web/src/style.css): the basic tracking screen.
- [`src/admit_hackathon/api/`](src/admit_hackathon/api/): FastAPI authentication routes, UUID user model, Argon2 password verification, and JWT handling.
- [`compose.yaml`](compose.yaml) and [`migrations/`](migrations/): PostgreSQL service configuration and the users-table migration.

The preview is mirrored, while the landmark data passed to `processHands` uses the original camera coordinates. Results also arrive when no hands are detected. Handedness is a model classification, not a persistent identity for a hand across frames.

The first custom casting gesture is a straightened index finger. `processHands` checks that the index is extended while the middle, ring, and pinky fingers are curled; the thumb may rest naturally and the wrist may rotate while drawing. The pose must remain stable for about 72 ms before `justStarted` is emitted. When the pose ends, the stroke enters a pending release state; the user must extend the four non-thumb fingers in a stable, camera-facing palm for about 72 ms to emit `justReleased`. A casting hand is highlighted in gold and labeled in the readout. Diagnostic fields provide concrete corrections for both casting and release poses.

While casting, the index fingertip writes a gold path on a dedicated canvas over the webcam preview. The recorder keeps both raw timestamped points and a filtered path. Recognition corrects for the video aspect ratio, then compares aligned outlines as well as topology, corners, closure, and circle geometry for six rune templates. A brief tracking or pose gap can be recovered; longer gaps and release timeouts cancel the pending attempt. A persistent result card reports **SPELL CAST**, **ALMOST**, **CAST FAILED**, or **CAST CANCELLED** with a correction when available. The shown match score is a heuristic and is not a calibrated probability.

When running `npm run dev`, the **Recognition diagnostics** panel can record local landmark and stroke data, download it as JSON, and replay it through the current recognition pipeline. It never records camera pixels. Capture starts only when the developer clicks **Start local capture**. Replay does not dispatch spell events. Candidate scores and the last raw/filtered outline are shown in the panel. The panel and browser capture code are absent from the production build. For labeled evaluation, see [`web/evaluation/README.md`](web/evaluation/README.md).

Confirmed matches are converted through `resolveSpell` into a `spell_cast` payload containing `spellId`, `sourceShapeId`, and confidence. The cast card also shows the resolved spell name and a short rune interpretation. The browser dispatches the payload as a `spell-cast` event; both practice and online rooms accept all six spell IDs. Near misses and unrecognized shapes do not produce backend commands.

This first prototype uses CPU inference on the main thread. It establishes the input pipeline, deliberate release gesture, and configurable shape matching; a broader gesture vocabulary, combat, and a playable scenario are not implemented yet. Move inference to a worker if it interferes with rendering as the game grows.

Run `npm test` and `npm run build` from `web/` to validate frontend auth and gesture logic and produce `web/dist/`. Run `npm run preview` to inspect that build locally. Run `uv run --extra test pytest` from the repository root for backend auth tests.

References: [MediaPipe web integration](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js), [official hand model](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker#models), and [Vite setup](https://vite.dev/guide/).

## Core idea

The player acts as a magic user in a fantasy combat setting. A normal webcam captures their movements, computer vision identifies body or hand landmarks, and custom recognition logic translates those movements into game actions with immediate visual feedback.

```text
Webcam input
    → landmark tracking
    → movement and gesture interpretation
    → in-game action
    → immediate visual feedback
```

Physical movement is the primary gameplay controller. Keyboard and mouse may support setup or menus, but the playable scenario must demonstrate control through the webcam.

The project primarily belongs to the computer vision and gesture-recognition space. MediaPipe is the selected landmark detector, starting with hands. The project's own logic must interpret the detected landmarks, recognize meaningful actions, and explain inaccurate attempts.

## Core requirements

- Run directly in a browser with no installation required for the player.
- Use a normal webcam as the primary gameplay input.
- Recognize several distinct physical movements or gestures.
- Clearly show when tracking detects the player and when a gesture is recognized.
- Translate recognized gestures into actions with immediate visual feedback.
- Provide a coherent fantasy / magic-combat experience.
- Include a complete playable scenario with a beginning and an end.
- Detect near-correct attempts and offer specific, actionable corrections.

## Design choices that remain open

Do not treat any particular spell list, gesture vocabulary, control scheme, combat system, game mode, progression system, or visual style as a requirement yet.

The following will be decided through prototyping:

- Whether to extend the initial hand tracking to the upper body, full body, or a combination; face tracking only if a mechanic calls for it.
- Which gestures are comfortable, distinguishable, and practical within a webcam's field of view.
- How gestures map to spells or other actions.
- How targeting, timing, resources, enemies, difficulty, and victory or defeat work.
- Whether rendering should use 2D, 3D, or another presentation.
- Whether the initial plain TypeScript frontend needs a framework or additional rendering tools as gameplay develops.
- Whether multiplayer adds value after the local experience works.

Any sample gesture or spell introduced during development is an experiment until explicitly adopted.

## Proposed major systems

| System | Responsibility |
| --- | --- |
| Camera and session setup | Request camera access, manage the video stream, explain setup, and handle unavailable or interrupted camera input. |
| Vision adapter | Run the chosen landmark detector and expose a consistent representation of positions, timestamps, visibility, and available confidence signals. |
| Movement processing | Normalize positions, smooth noisy input, and derive useful measurements such as angles, distances, orientation, and motion over time. |
| Gesture recognition | Evaluate configurable gesture definitions and track attempts across frames, including partial matches, completion, and ambiguity. |
| Error mode and coaching | Identify which requirements a near-correct attempt missed and turn those differences into concrete corrections. |
| Input-to-action mapping | Translate recognized gesture events into gameplay commands without coupling landmark logic to specific spells. |
| Game simulation | Own scenario state, combat rules, objectives, progression if needed, and the conditions that end a session. |
| Rendering and feedback | Present the fantasy world, action effects, tracking status, recognition feedback, and corrective guidance. |
| Application flow | Connect camera setup, an introduction or practice phase, active play, results, and restart. |
| Development diagnostics | Help inspect landmarks, derived measurements, gesture scores, and timing while tuning recognition. |

Keep tracking, gesture interpretation, game rules, and rendering separate. Changing a spell should not require rewriting landmark processing; changing the tracking provider should not require rewriting combat logic.

## Error mode: correcting near-correct movement

Error mode is a core product requirement. Recognition must produce more information than a simple recognized / unrecognized result.

A gesture definition should describe its expected shape or motion, required landmarks, relevant timing, and adjustable tolerances. Its evaluator should retain which conditions passed, which failed, and how far the attempt was from the expected movement.

Useful recognition outcomes include:

- **Recognized:** the movement satisfies the gesture's conditions.
- **In progress:** a plausible attempt is still developing and should be allowed to finish.
- **Near match:** there is enough evidence of a particular gesture attempt to explain a specific mismatch.
- **Ambiguous:** multiple gestures are plausible; avoid confidently assigning the wrong correction.
- **Insufficient tracking:** required landmarks are missing or unreliable; provide camera or positioning guidance.
- **No relevant attempt:** ordinary movement should not trigger constant coaching.

Corrections should follow from measured differences. For example, if a future gesture requires a hand above a shoulder, a near match could produce “Raise your hand above your shoulder.” A gesture requiring a held pose could produce “Hold this position a little longer.” These are examples of feedback specificity, not committed controls.

The correction pipeline should:

1. Identify a likely intended gesture using its partial match and recent movement history.
2. Distinguish poor camera visibility from inaccurate execution.
3. Select the most useful failed condition to correct first.
4. Show concise guidance, optionally supported by a visual cue.
5. Update or clear that guidance as the player adjusts.

Feedback needs to remain stable across noisy frames. Use temporal confirmation and repeat limits so that prompts do not flicker or overwhelm the player. Initial recognition thresholds and tolerances must be tuned through actual webcam trials.

## Flexible recognition and action interfaces

Prefer configurable gesture definitions and action mappings over a single block of logic that mixes poses, spells, and effects.

The main boundaries should carry information such as:

- **Tracking sample:** timestamp, landmark positions, coordinate convention, and tracking quality.
- **Movement features:** normalized spatial measurements and temporal movement history.
- **Gesture evaluation:** gesture identifier, attempt state, match score, and diagnostic results for individual conditions.
- **Gesture event:** an accepted recognition event with enough identity and timing information to prevent duplicate activation.
- **Game command:** the action requested by the input mapping, validated against the current game state.
- **Feedback state:** tracking status, gesture progress, correction cues, and action outcomes for presentation.

A held pose must not automatically fire an action every frame. Gesture definitions and mappings should make activation, release, repetition, and any timing requirements explicit. Continuous movement controls can be added through a separate input interface if the gameplay needs them.

## Proposed project structure

This is a logical target, not a requirement to create every directory immediately. Browser-specific `src/`, `public/`, and future `tests/` directories belong inside `web/` in the current repository; the tree below describes their intended organization alongside shared documentation.

```text
/
├── README.md                 # Project vision, requirements, and current direction
├── docs/
│   ├── architecture.md       # Detailed interfaces and system boundaries
│   ├── gestures.md           # Gesture experiments, definitions, and correction rules
│   └── decisions.md          # Confirmed choices and their rationale
├── public/
│   └── assets/               # Static assets needed by the selected implementation
├── src/
│   ├── app/                  # Startup, session lifecycle, and screen flow
│   ├── camera/               # Webcam access and stream lifecycle
│   ├── vision/               # Tracking provider adapters and landmark types
│   ├── movement/             # Normalization, smoothing, and derived features
│   ├── gestures/             # Definitions, evaluators, attempt state, and diagnostics
│   ├── input/                # Gesture-to-command mapping
│   ├── game/                 # Simulation, scenario state, and gameplay rules
│   ├── presentation/         # Rendering, effects, HUD, and coaching interface
│   ├── config/               # Tunable gestures, mappings, and gameplay parameters
│   └── debug/                # Development overlays and recognition inspection
└── tests/
    └── fixtures/             # Synthetic landmark sequences for recognition checks
```

Keep correction diagnostics close to gesture evaluation so that recognition and coaching use the same conditions. Presentation should translate those diagnostics into player-facing instructions.

Do not introduce a server merely to support the initial single-player prototype. If multiplayer is adopted, add a server and shared message contracts when their responsibilities become concrete.

## First playable milestone

The first milestone should prove the complete interaction loop with a small, coherent scenario:

1. The player opens the game, enables the webcam, and receives positioning guidance.
2. A short introduction or practice phase teaches the chosen experimental gestures.
3. The player uses several distinct gestures in a bounded magic-combat encounter with a clear objective.
4. Tracking and action feedback make it obvious that movement is controlling the game.
5. Near-correct attempts produce specific coaching, and corrected attempts can succeed.
6. The encounter reaches a clear ending and offers a restart.

The encounter format, gestures, spell behavior, and end conditions remain design decisions. This milestone defines completeness without selecting them prematurely.

## Development and validation approach

First establish reliable tracking and visible movement feedback. Then prototype gesture interpretation and error mode together, connect them to a small playable scenario, and tune the experience through webcam playtesting.

Validation should cover successful gestures, near misses with expected corrections, unrelated movements, ambiguous attempts, held poses, and tracking loss. Synthetic landmark sequences can make recognition checks repeatable; real webcam trials are still needed to assess comfort, framing, lighting, and response time.

Plan for permission denial, model-loading failures, temporary tracking loss, and camera disconnection. The player should see clear status and a recovery path. Track latency across capture, inference, recognition, and presentation, then set performance targets based on the intended devices.

## Privacy and possible multiplayer

Process webcam frames and recognize gestures locally in the player's browser. Raw camera footage should not need to leave the device for gameplay. Any future recording or diagnostic upload would require a separate, explicit design decision and player consent.

If multiplayer is implemented, keep local vision processing and send only the commands or events needed for shared play. The server can own the authoritative shared game state and validate commands against game rules. A server receiving commands alone cannot verify the underlying physical gesture; account for that limitation when choosing competitive mechanics.

## Guidance for future development

Preserve the defining loop: **webcam input → movement recognition → game action → immediate feedback**. Treat specific corrective feedback as essential to the experience. Keep the gesture vocabulary and gameplay configurable, and record settled decisions as the concept evolves.

## Visual design references

### Animation workshop

Run `npm run dev` in `web/`, then open `/asset-preview.html` (also linked from login).
The workshop previews both wizards' idle, casting, and dodge frames over an extracted
arena. It offers play/pause, restart, speed selection, single-frame inspection, and
optional repetition of one-shot clips. Playback starts paused.

`npm run assets:extract` generates 36 transparent character SVG frames, 20 spell-effect frames, an arena SVG,
and `public/assets/game/manifest.json`. Development and production builds run this
automatically. Generated files are ignored; the original design boards remain the source.
The preview page is included in the production build.

See [the extraction contract](docs/visual-assets.md#generated-game-assets) for dimensions,
timings, frame indices, and source-art limitations.

### Local practice duel

The game has its own route, `/battle.html`. The root page is login only; successful
sign-in (or restoring a session) navigates to battle. The battle page uses a wide
arena with a compact camera panel, stacking the camera underneath on small screens.
Artwork loading times out after 15 seconds and offers a reload link on failure.

After API-backed sign-in, the courtyard renders both wizards with live health bars.
The player's duel name comes from the signed-in login. The local opponent is labeled
`Computer (AI)`; the duel accepts an opponent username for a future player match.
The tracking panel has a Spellbook popout explaining the available rune shapes and effects. Players cast through the camera; Pause and Restart remain visible duel controls.
Webcam `spell-cast` events trigger Berik's actions: triangle → Fireball, circle → Shield,
zigzag → Lightning, one continuous hourglass → Twin Flare, square or rectangle →
Time Lock, and a straight line → Spark. The Spellbook shows all six shapes.

`src/duel/demo-duel.ts` contains isolated local demo rules (100 health, 20 fireball
damage, 15 lightning damage, 45 Twin Flare damage, 7 Spark damage, 900 ms cast
cooldown, and a 4.3-second one-hit shield). Time Lock reveals the enemy spell
and adds 1.5 seconds to an attack that is charging, or to the next attack if
none is charging.
`duel-view.ts` loads assets and renders these rules. A backend integration should
replace the local model with authoritative server state. The opponent attempts a
spell after a short opening delay and alternates fireball and lightning. Each
attempt has a 15% chance to fizzle without a projectile. His charge lasts at
least 3 seconds before release, giving the player time to draw and release a
shield. The charge warning hides the spell identity until Time Lock reveals it.
A defensive shield can bypass an offensive cooldown during an incoming attack.
Logout resets the duel; hidden pages pause it.
The practice duel ends at zero health and offers Restart duel.

Pause freezes the duel clock, projectiles, shields, and cooldowns; webcam spell
events are ignored by the duel while paused. The readiness meter shows when the
next cast is available, and the winner overlay offers a clear ending. Asset-load
errors provide a reload link. The workshop's **Asset collection → Spell effects**
option inspects all fireball, shield, and lightning frames with the same playback
and frame-selection controls used for characters.

The duel-screen, character, animation, and effects reference boards live in [`web/public/assets/design/`](web/public/assets/design/). See [`docs/visual-assets.md`](docs/visual-assets.md) for their contents, UI composition, production constraints, runtime status, and the expected frame-export workflow.
