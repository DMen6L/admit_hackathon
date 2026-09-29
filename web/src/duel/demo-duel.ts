export type Spell = 'fireball' | 'shield' | 'lightning';
export type Side = 0 | 1;
export const CAST_COOLDOWN_MS = 900;
export const ENEMY_WINDUP_MS = 2200;
export interface Fighter { health: number; shieldUntil: number; castAt: number; shieldAt: number; }
export interface Attack { side: Side; spell: Exclude<Spell, 'shield'>; startedAt: number; releaseAt: number; impactAt: number; announcedRelease: boolean; }

/** Local preview rules only. Replace this model with authoritative server snapshots. */
export class DemoDuel {
  fighters: [Fighter, Fighter] = [this.fighter(), this.fighter()];
  attacks: Attack[] = [];
  impacts: { side: Side; spell: Spell; at: number; blocked: boolean }[] = [];
  message = 'Practice duel ready. Cast a spell or try the demo controls.';
  winner: Side | undefined;
  private fighter(): Fighter { return { health: 100, shieldUntil: 0, castAt: -Infinity, shieldAt: -Infinity }; }

  canCast(side: Side, spell: Spell, now: number): boolean {
    if (this.winner !== undefined) return false;
    const fighter = this.fighters[side];
    if (spell === 'shield') {
      const incoming = side === 0 && this.attacks.some((attack) => attack.side === 1 && attack.impactAt > now);
      return now - fighter.shieldAt >= CAST_COOLDOWN_MS
        && (incoming || now - fighter.castAt >= CAST_COOLDOWN_MS);
    }
    return now - fighter.castAt >= CAST_COOLDOWN_MS
      && !this.attacks.some((attack) => attack.side === side && attack.impactAt > now);
  }

  cast(side: Side, spell: Spell, now: number, releaseDelay = side === 0 ? 240 : ENEMY_WINDUP_MS): boolean {
    if (!this.canCast(side, spell, now)) return false;
    const fighter = this.fighters[side];
    fighter.castAt = now;
    if (spell === 'shield') {
      fighter.shieldAt = now;
      fighter.shieldUntil = now + 3500;
      this.message = `${side === 0 ? 'Berik' : 'Alisher'} raises a shield.`;
    } else {
      const windup = side === 1 ? Math.max(ENEMY_WINDUP_MS, releaseDelay) : releaseDelay;
      this.attacks.push({ side, spell, startedAt: now, releaseAt: now + windup,
        impactAt: now + windup + (spell === 'fireball' ? 800 : 500), announcedRelease: false });
      this.message = side === 1
        ? `Alisher is charging ${spell}. Draw a circle and open your palm to shield!`
        : `Berik casts ${spell}.`;
    }
    return true;
  }

  update(now: number): void {
    this.impacts = this.impacts.filter((impact) => now - impact.at < 400);
    for (const attack of this.attacks) {
      if (attack.side === 1 && !attack.announcedRelease && attack.releaseAt <= now && attack.impactAt > now) {
        attack.announcedRelease = true;
        this.message = `Alisher released ${attack.spell}. Shield before impact!`;
      }
    }
    const arrived = this.attacks.filter((attack) => attack.impactAt <= now).sort((a, b) => a.impactAt - b.impactAt);
    this.attacks = this.attacks.filter((attack) => attack.impactAt > now);
    for (const attack of arrived) {
      if (this.winner !== undefined) break;
      const target: Side = attack.side === 0 ? 1 : 0;
      const fighter = this.fighters[target];
      const blocked = fighter.shieldUntil > attack.impactAt;
      if (blocked) fighter.shieldUntil = 0;
      else fighter.health = Math.max(0, fighter.health - (attack.spell === 'fireball' ? 20 : 15));
      this.impacts.push({ side: target, spell: attack.spell, at: now, blocked });
      this.message = blocked ? 'Shield absorbed the attack.' : `${target === 0 ? 'Berik' : 'Alisher'} takes a hit.`;
      if (fighter.health === 0) {
        this.winner = attack.side;
        this.attacks = [];
        this.message = `${attack.side === 0 ? 'Berik' : 'Alisher'} wins the practice duel. Restart to play again.`;
      }
    }
  }

  reset(): void {
    this.fighters = [this.fighter(), this.fighter()];
    this.attacks = [];
    this.impacts = [];
    this.winner = undefined;
    this.message = 'Practice duel ready. Cast a spell or try the demo controls.';
  }
}

/** Visual mapping for the demo; existing network spell IDs remain unchanged. */
export function demoSpell(spellId: string): Spell | undefined {
  switch (spellId) {
    case 'rune.triangle': return 'fireball';
    case 'rune.circle': return 'shield';
    case 'rune.lightning': return 'lightning';
    default: return undefined;
  }
}
