export type Spell = 'fireball' | 'shield' | 'lightning' | 'twin-flare' | 'time-lock' | 'spark';
export type Side = 0 | 1;
export const CAST_COOLDOWN_MS = 900;
export const ENEMY_WINDUP_MS = 3000;
const SHIELD_DURATION_MS = 4300;
export const TIME_LOCK_DELAY_MS = 1500;
export const ENEMY_MISCAST_CHANCE = 0.15;
export interface Fighter { health: number; shieldUntil: number; castAt: number; shieldAt: number; slowNextAttack: boolean; revealNextAttack: boolean; }
export interface Attack { side: Side; spell: Exclude<Spell, 'shield' | 'time-lock'>; startedAt: number; releaseAt: number; impactAt: number; announcedRelease: boolean; slowed: boolean; revealed: boolean; }

const ATTACK_DAMAGE: Record<Attack['spell'], number> = {
  fireball: 20,
  lightning: 15,
  'twin-flare': 45,
  spark: 7,
};

const ATTACK_TRAVEL_MS: Record<Attack['spell'], number> = {
  fireball: 800,
  lightning: 500,
  'twin-flare': 1000,
  spark: 200,
};

/** Local preview rules only. Replace this model with authoritative server snapshots. */
export class DemoDuel {
  fighters: [Fighter, Fighter] = [this.fighter(), this.fighter()];
  attacks: Attack[] = [];
  impacts: { side: Side; spell: Spell; at: number; blocked: boolean }[] = [];
  message = 'Practice duel ready. Draw a rune to cast.';
  winner: Side | undefined;
  lastEnemyMiscastAt = -Infinity;
  private participants: [string, string] = ['Player', 'Computer (AI)'];

  constructor(private readonly random: () => number = Math.random) {}

  setParticipants(playerName: string, opponentName = 'Computer (AI)'): void {
    this.participants = [playerName, opponentName];
  }

  name(side: Side): string { return this.participants[side]; }

  private fighter(): Fighter { return { health: 100, shieldUntil: 0, castAt: -Infinity, shieldAt: -Infinity, slowNextAttack: false, revealNextAttack: false }; }

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
      fighter.shieldUntil = now + SHIELD_DURATION_MS;
      this.message = `${this.name(side)} raises a shield.`;
    } else if (spell === 'time-lock') {
      const target: Side = side === 0 ? 1 : 0;
      const pending = this.attacks.find((attack) => attack.side === target && attack.impactAt > now);
      if (pending) {
        pending.revealed = true;
        if (pending.releaseAt > now && !pending.slowed) {
          pending.releaseAt += TIME_LOCK_DELAY_MS;
          pending.impactAt += TIME_LOCK_DELAY_MS;
          pending.slowed = true;
        } else {
          this.fighters[target].slowNextAttack = true;
          this.fighters[target].revealNextAttack = true;
        }
      } else {
        this.fighters[target].slowNextAttack = true;
        this.fighters[target].revealNextAttack = true;
      }
      this.message = pending
        ? `${this.name(side)} reveals ${pending.spell} with Time Lock.`
        : `${this.name(side)} casts Time Lock. The next opponent spell will be revealed and delayed.`;
    } else {
      if (side === 1 && this.random() < ENEMY_MISCAST_CHANCE) {
        this.lastEnemyMiscastAt = now;
        this.message = `${this.name(side)} fumbles the spell. The attack fizzles!`;
        return true;
      }
      const slowed = fighter.slowNextAttack;
      const revealed = fighter.revealNextAttack;
      fighter.slowNextAttack = false;
      fighter.revealNextAttack = false;
      const windup = (side === 1 ? Math.max(ENEMY_WINDUP_MS, releaseDelay)
        : spell === 'twin-flare' ? Math.max(1500, releaseDelay) : spell === 'spark' ? Math.min(120, releaseDelay) : releaseDelay)
        + (slowed ? TIME_LOCK_DELAY_MS : 0);
      this.attacks.push({ side, spell, startedAt: now, releaseAt: now + windup,
        impactAt: now + windup + ATTACK_TRAVEL_MS[spell], announcedRelease: false, slowed, revealed });
      this.message = side === 1
        ? revealed ? `${this.name(side)} is charging ${spell}. Draw a circle and open your palm to shield!`
          : `${this.name(side)} is charging a spell. Draw a circle and open your palm to shield!`
        : `${this.name(side)} casts ${spell}.`;
    }
    return true;
  }

  update(now: number): void {
    this.impacts = this.impacts.filter((impact) => now - impact.at < 400);
    for (const attack of this.attacks) {
      if (attack.side === 1 && !attack.announcedRelease && attack.releaseAt <= now && attack.impactAt > now) {
        attack.announcedRelease = true;
        this.message = attack.revealed
          ? `${this.name(attack.side)} released ${attack.spell}. Shield before impact!`
          : `${this.name(attack.side)} released a spell. Shield before impact!`;
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
      else fighter.health = Math.max(0, fighter.health - ATTACK_DAMAGE[attack.spell]);
      this.impacts.push({ side: target, spell: attack.spell, at: now, blocked });
      this.message = blocked ? 'Shield absorbed the attack.' : `${this.name(target)} takes a hit.`;
      if (fighter.health === 0) {
        this.winner = attack.side;
        this.attacks = [];
        this.message = `${this.name(attack.side)} wins the practice duel. Restart to play again.`;
      }
    }
  }

  reset(): void {
    this.fighters = [this.fighter(), this.fighter()];
    this.attacks = [];
    this.impacts = [];
    this.winner = undefined;
    this.lastEnemyMiscastAt = -Infinity;
    this.message = 'Practice duel ready. Draw a rune to cast.';
  }
}

/** Visual mapping for the demo; existing network spell IDs remain unchanged. */
export function demoSpell(spellId: string): Spell | undefined {
  switch (spellId) {
    case 'rune.triangle': return 'fireball';
    case 'rune.circle': return 'shield';
    case 'rune.lightning': return 'lightning';
    case 'rune.hourglass': return 'twin-flare';
    case 'rune.square': return 'time-lock';
    case 'rune.line': return 'spark';
    default: return undefined;
  }
}
