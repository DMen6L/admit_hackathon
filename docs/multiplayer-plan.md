# Multiplayer execution plan

## Goal and first playable scope

Ship a two-player, browser-to-browser duel through one authoritative server. Each player signs in, one creates a private room, the other joins with its code, and both see the same health, cast warning, shield, impact, and winner. Keep `/battle.html` practice playable while online mode is built. The browser continues to process webcam frames and recognize gestures locally; the server receives only spell commands, never video or landmarks.

The deployment uses PostgreSQL for recovery snapshots, seats, and ordered room events. During a duel, one API process keeps the authoritative match in memory and advances it without database work on the timer tick. This first release runs one Railway API instance; coordination across replicas is deferred. No public matchmaking, spectator mode, chat, account rankings, or persistent match history beyond room events is included in this slice.

## Ownership and parallel work

| Area | Owner / file boundary | Deliverable |
| --- | --- | --- |
| Shared protocol | Agree before parallel work; `docs/multiplayer-plan.md` plus `web/src/multiplayer/protocol.ts` | Versioned message names, fields, errors, timing, and examples. Changes require both sides to review. |
| Backend game | Backend teammate; `src/admit_hackathon/api/multiplayer/`, API route registration, Python tests | Authenticated rooms, authoritative rules, server clock, ordered snapshots, reconnect and cleanup. No frontend file edits. |
| Game frontend | Game frontend teammate; `web/src/multiplayer/`, battle page online UI and CSS, frontend tests | Room lobby, connection states, rendering from snapshots, local cast adapter, reconnect and latency display. No backend rule edits. |
| Recognition/assets | Gesture and asset owner; existing `web/src/input/`, `web/src/shapes/`, `web/src/assets/` | Keep `spell-cast` event stable; tune gesture latency using labeled captures; add distinct artwork poses. No protocol changes. |
| Integration | One owner after both branches land | Two-browser smoke test, network fault tests, deployment configuration, final balance pass. |

Existing uncommitted recognition tuning in the worktree must be preserved during branch work. Prefer separate branches/worktrees for parallel agents and have each agent own the listed paths.

## Transport and authority

1. Browser uses the existing access token to call `POST /api/rooms` (create) or `POST /api/rooms/{code}/join`. Room codes are short, random, uppercase, and rate limited before a public deployment. A room has exactly two authenticated user IDs; the same account cannot occupy both seats.
2. Browser opens `WS /ws/rooms/{code}`. Its **first** message is `{ "type": "authenticate", "token": "..." }`. Do not place tokens in the URL, logs, or shared room code. The server checks the token and room membership before it sends game state. Enforce a short authentication timeout and reject unexpected origins in production.
3. Client sends only `{ "type": "cast", "v": 1, "seq": 7, "spellId": "rune.circle" }` and occasional ping. `seq` increases per connection. The server checks seat ownership, allowed spell IDs, cooldown, match phase, and duplicate/out-of-order commands. Shape confidence is diagnostic data only; it does **not** authorize damage.
4. Server sends a `state` snapshot with protocol version, monotonically increasing revision, server timestamp, phase, seats, health, cooldown deadline, active warning/projectile/impact events, and winner. Clients ignore older revisions. Send state on meaningful transitions; do not stream every animation frame.
5. Server time determines cast acceptance, windup, shield duration, impact, and damage. A client may play a short tentative hand animation immediately, but health and results always come from server state. No client-side damage timer is authoritative.

## Gameplay timing and lag strategy

Start with the current practice balance: 100 health, fireball 20 damage, lightning 15, 900 ms offensive cooldown, 3-second visible warning, fireball 800 ms travel, lightning 500 ms travel, and one-hit shield long enough to cover an early reaction. Tune only after webcam playtests. For the first network slice, both players may cast attack and shield spells; defensive shield may bypass an offensive cooldown during an incoming attack while retaining its own cooldown.

- Broadcast a warning as soon as a valid attack is accepted, including its spell and `releaseAt`/`impactAt` server times. Both clients render the rune immediately using their own animation clock.
- Measure client/server clock offset with ping/pong and use it for countdowns. Smooth clock offset instead of jumping the warning bar. Use local `requestAnimationFrame` for visuals; WebSocket carries commands and event snapshots, not 60 FPS positions.
- Keep a small visual interpolation delay (roughly 80-120 ms) for remote animation, but never delay the warning itself. Start local cast feedback immediately; reconcile it against accept/reject from the server.
- Design for at least 150 ms RTT and bursty Wi-Fi. A 3-second warning provides most of the reaction budget. Measure p50/p95 command-to-warning latency, warning-to-shield success, RTT, reconnect time, and missed casts. Do not claim “lag free” from unit tests alone.
- Use server sequence/revision numbers so a delayed packet cannot revert health or replay a spell. Cap message size and command rate. No raw camera or pose stream crosses the network.

## Room and connection lifecycle

Room states: `waiting` (creator only) -> `active` (two authenticated seats) -> `finished` (winner or forfeit) -> expired. A room code identifies one room; reconnect is allowed only for its original user. On disconnect, keep the seat for a short grace period (target 15 seconds), then award a forfeit if active. Send clear UI states for waiting, connecting, disconnected/reconnecting, opponent left, and finished. Close stale sockets and expire idle rooms (target 30 minutes). A process restart reloads the latest persisted snapshot; clients still show a recovery action when a room has expired.

The backend uses an in-memory lock per room for deterministic command ordering. Accepted casts and gameplay milestones are persisted once to PostgreSQL, while the 50 ms timer advances the in-memory match without reloads or row locks. WebSocket peers remain local to the single API process; horizontal coordination is follow-up work.

## Delivery sequence and acceptance gates

1. **Contract and engine:** freeze protocol v1, implement pure Python match rules and clock-injected tests for simultaneous casts, shield at impact, cooldowns, duplicate commands, winner, and reset/forfeit. This is the first implementation slice.
2. **Room API and socket:** authenticated create/join, capacity and same-account checks, first-message auth, snapshot broadcast, message limits, disconnect handling. Test with two WebSocket clients and a fake DB; verify no cross-room messages.
3. **Online frontend:** room create/join UI; WebSocket adapter; adapt `spell-cast` event into v1 commands; render snapshots with existing SVG assets. Keep practice mode accessible. Test message validation, revision ordering, reconnection, and URL generation.
4. **Reliability:** reconnection with backoff and seat grace period, cleanup, connection quality indicator, server clock sync, duplicate protection, and structured metrics. Simulate 0/150/300 ms RTT and packet delay in two real browsers.
5. **Release gate:** run backend/frontend CI, two-user end-to-end smoke test on real PostgreSQL, manual webcam duel, narrow viewport check, and process restart/disconnect test. Verify the first warning appears before the defender’s reaction budget and damage is identical in both browsers.

## Initial protocol examples

Client: `{ "type": "authenticate", "token": "<access token>" }`, then `{ "type": "cast", "v": 1, "seq": 1, "spellId": "rune.triangle" }`.

Server acknowledgment: `{ "type": "cast_ack", "v": 1, "seq": 1, "spellId": "rune.triangle", "acceptedAtMs": 1710000000000, "revision": 4 }`.

Server state: `{ "type": "state", "v": 1, "revision": 4, "serverTimeMs": 1710000000000, "phase": "active", "players": [{ "seat": 0, "login": "one", "health": 100 }, { "seat": 1, "login": "two", "health": 80 }], "attacks": [{ "seat": 0, "spellId": "rune.triangle", "releaseAtMs": 1710000003000, "impactAtMs": 1710000003800 }], "winner": null }`.

Server errors: `{ "type": "error", "v": 1, "code": "cooldown", "seq": 1 }`. Other stable codes: `invalid_message`, `invalid_spell`, `not_ready`, `duplicate`, `room_full`, `unauthorized`. Authentication failure closes the socket with an application error code; it never echoes the token.

The protocol example is a baseline. Any field additions must preserve `v: 1` clients or bump `v` and update both sides together.

## Implementation status (first slice)

Implemented in this branch: pure server duel engine, private create/join API, PostgreSQL room/player/event persistence, first-message JWT room socket, revisioned snapshots, explicit cast acknowledgments, in-memory timer advancement, automatic server impacts, 15-second disconnect forfeit, a battle-page room lobby, online renderer, webcam spell adapter, clock-offset ping, and reconnect attempts. Practice mode remains separate. Automated backend and frontend tests cover the core engine, two-client socket exchange, and protocol parsing.

Current expansion: online rooms now accept all six recognized spell IDs. The server resolves Twin Flare and Spark damage, Time Lock's 1.5-second delay, shields, and three-second-or-longer attack warnings. Snapshots include recent confirmed cast IDs so both clients can play each spell's audio once without sounding a rejected command. Twin Flare and Spark reuse scaled source effects until dedicated art is available.

Still required before a public multiplayer release: real two-device webcam playtest under throttled networks, a refreshable session strategy for matches longer than the current access-token lifetime, cleanup/rate limits for abandoned or spammed rooms, production origin/host configuration, and validation with more than one API worker. These tasks are intentionally not hidden behind the first-slice UI.
