# Guided casting tutorial

The lobby links to `/tutorial.html`. The tutorial is a separate, local-only practice route: it does not create a multiplayer room, change duel statistics, or send camera frames to the server.

## Linear lesson

1. Spark (line): learn to trace and release a cast.
2. Fireball (triangle): learn a closed attack rune.
3. Shield (circle): learn the defensive rune without time pressure.
4. Lightning (zigzag): learn an open rune with turns.
5. Time Lock (square): learn the control spell.
6. Twin Flare (two joined triangles): learn the advanced attack.
7. Defense drill: read an incoming fireball telegraph and cast Shield before the three-second charge expires.

Only a confirmed recognition of the current rune advances the lesson. Wrong runes, near misses, short strokes, missing hand poses, and timeout have specific recovery messages; they never silently advance. A Continue action separates lessons so the next instruction is read before drawing. The defense drill can be retried indefinitely. Completion returns the player to the lobby or training match.

The six runes above are the six currently implemented spells. The seventh lesson is a reaction exercise, not an invented seventh spell. Both webcam hand tracking and pointer/touch drawing feed the same production shape evaluator, so a camera is optional but the recognition standard remains the same.

## Verification

- Unit-test progression, wrong-spell feedback, near misses, and defense timeout.
- Run TypeScript checking, frontend tests, and production build.
- Confirm the lobby entry and tutorial route load and remain usable without camera permission.
