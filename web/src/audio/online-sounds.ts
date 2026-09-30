import type { MatchState } from '../multiplayer/protocol';
import { demoSpell, type Spell } from '../duel/demo-duel';

/** Derive cues from server-confirmed changes, never from a merely attempted cast. */
export function confirmedSpellSounds(previous: MatchState | undefined, next: MatchState): Spell[] {
  if (!previous) return [];
  const sounds: Spell[] = [];
  for (const attack of next.attacks) {
    const alreadyPresent = previous.attacks.some((value) => value.seat === attack.seat
      && value.startedAtMs === attack.startedAtMs && value.spellId === attack.spellId);
    if (!alreadyPresent) {
      const spell = demoSpell(attack.spellId);
      if (spell) sounds.push(spell);
    }
  }
  for (const player of next.players) {
    const before = previous.players.find((value) => value.seat === player.seat);
    if (before && player.shieldUntilMs > before.shieldUntilMs) sounds.push('shield');
  }
  return sounds;
}
