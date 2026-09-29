# Webcam Magic Game

> A browser magic game where the player's body is the controller, powered by real-time computer vision.

## Purpose of this document

This README records the project's vision, requirements, and proposed architecture for future development. An initial browser hand-tracking prototype is available in `web/`; the game and gesture system are still at the planning stage.

The central interaction is fixed. Gameplay details and technology choices remain open. Update this document as decisions are made, and distinguish confirmed decisions from experiments.

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

`npm run setup` downloads Google's pretrained `hand_landmarker.task` model and copies the WebAssembly runtime from the installed MediaPipe package. Both are served locally by the app. The generated assets are ignored by Git; rerun setup after installing or updating dependencies. Players do not need Node.js, Python, or a local installation.

The initial files are:

- [`web/src/main.ts`](web/src/main.ts): camera lifecycle, frame processing, and the landmark overlay.
- [`web/src/vision/hand-tracker.ts`](web/src/vision/hand-tracker.ts): MediaPipe initialization and tracking configuration.
- [`web/src/input/process-hands.ts`](web/src/input/process-hands.ts): custom gesture and open-palm release state, with corrective-feedback data.
- [`web/src/drawing/path-recorder.ts`](web/src/drawing/path-recorder.ts): normalized index-fingertip strokes recorded until a deliberate release.
- [`web/src/shapes/shape-evaluator.ts`](web/src/shapes/shape-evaluator.ts): tolerant topology, turn, closure, direction, proportion, and circle-radial matching with shape corrections.
- [`web/src/ui/cast-result.ts`](web/src/ui/cast-result.ts): testable presentation states for successful, near-miss, failed, and cancelled casts.
- [`web/index.html`](web/index.html) and [`web/src/style.css`](web/src/style.css): the basic tracking screen.

The preview is mirrored, while the landmark data passed to `processHands` uses the original camera coordinates. Results also arrive when no hands are detected. Handedness is a model classification, not a persistent identity for a hand across frames.

The first custom casting gesture is a raised index finger. `processHands` checks that the index extends above the hand while the middle, ring, and pinky fingers are curled. The pose must remain stable for four frames before `justStarted` is emitted. When the pose ends, the stroke enters a pending release state; the user must show all five fingers in a stable, camera-facing palm for four frames to emit `justReleased`. A casting hand is highlighted in gold and labeled in the readout. Diagnostic fields provide concrete corrections for both casting and release poses.

While casting, the index fingertip writes a smoothed gold path on a dedicated canvas over the webcam preview. Strokes are normalized to the video dimensions and recorded independently for each hand. The path remains visible while the player is asked to show their palm, then is evaluated against broad topology, corner, closure, direction, proportion, and circle-radial features for the sample triangle, circle, and lightning templates. Exact tracing is not required: small endpoint gaps and overshoots remain eligible for a closed shape, while lightning needs clearly separated endpoints and its alternating turns. Unsupported shapes, such as a square before a square template exists, are reported as unrecognized instead of being mislabeled as a triangle or lightning. A persistent result card clearly reports **SPELL CAST**, **ALMOST**, **CAST FAILED**, or **CAST CANCELLED** with a correction when needed; tracking loss, camera stop, and release timeout cancel the pending attempt.

This first prototype uses CPU inference on the main thread. It establishes the input pipeline, deliberate release gesture, and configurable shape matching; a broader gesture vocabulary, combat, and a playable scenario are not implemented yet. Move inference to a worker if it interferes with rendering as the game grows.

Run `npm test` and `npm run build` from `web/` to validate gesture logic and produce `web/dist/`. Run `npm run preview` to inspect that build locally. The existing Python scaffold is independent of this browser prototype.

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
