import type { MatchState } from '../multiplayer/protocol';
import { demoSpell, type Spell } from '../duel/demo-duel';
import { opponentSoundDelayMs } from './sound-timing';

/** Defensive spells take effect immediately; attack sounds wait for projectile release. */
export function confirmedSpellSounds(previous: MatchState | undefined, next: MatchState): Spell[] {
  if (!previous) return [];
  const sounds: Spell[] = [];
  for (const cast of next.casts) {
    if (!previous.casts.some((value) => value.id === cast.id)) {
      const spell = demoSpell(cast.spellId);
      if (spell === 'shield' || spell === 'time-lock') sounds.push(spell);
    }
  }
  return sounds;
}

/** Opponent sounds require an observed warning and a short visual gap after release. */
export function releasedAttackSounds(state: MatchState, now: number, played: Set<string>,
  warned: ReadonlySet<string>, localSeat: number): { spell: Spell; remainingMs: number }[] {
  const sounds: { spell: Spell; remainingMs: number }[] = [];
  for (const attack of state.attacks) {
    const key = `${attack.seat}:${attack.startedAtMs}`;
    if (played.has(key) || now <= attack.releaseAtMs || now >= attack.impactAtMs) continue;
    if (attack.seat !== localSeat) {
      if (!warned.has(key)) { played.add(key); continue; }
      if (now < attack.releaseAtMs + opponentSoundDelayMs(attack.releaseAtMs, attack.impactAtMs)) continue;
    }
    played.add(key);
    const spell = demoSpell(attack.spellId);
    if (spell) sounds.push({ spell, remainingMs: attack.impactAtMs - now });
  }
  return sounds;
}
