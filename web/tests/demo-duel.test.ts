import { describe, expect, it } from 'vitest';
import { DemoDuel, demoSpell } from '../src/duel/demo-duel';

describe('local practice duel', () => {
  it('damages only on impact and resolves each projectile once', () => {
    const duel = new DemoDuel();
    expect(duel.cast(0, 'fireball', 0)).toBe(true);
    expect(duel.cast(0, 'fireball', 10)).toBe(false);
    duel.update(1039);
    expect(duel.fighters[1].health).toBe(100);
    duel.update(1040);
    duel.update(2000);
    expect(duel.fighters[1].health).toBe(80);
  });
  it('consumes shields at impact, including when a render frame is skipped', () => {
    const duel = new DemoDuel();
    duel.cast(1, 'shield', 0);
    duel.cast(0, 'fireball', 1000);
    duel.update(4000);
    expect(duel.fighters[1].health).toBe(100);
    expect(duel.fighters[1].shieldUntil).toBe(0);
  });
  it('does not block attacks after shield expiration', () => {
    const duel = new DemoDuel();
    duel.cast(1, 'shield', 0);
    duel.cast(0, 'fireball', 3000);
    duel.update(5000);
    expect(duel.fighters[1].health).toBe(80);
  });
  it('ends the duel and clears effects and cooldowns on restart', () => {
    const duel = new DemoDuel();
    for (let i = 0; i < 5; i++) { duel.cast(0, 'fireball', i * 2000); duel.update(i * 2000 + 1040); }
    expect(duel.winner).toBe(0);
    expect(duel.cast(1, 'lightning', 12000)).toBe(false);
    duel.reset();
    expect(duel.winner).toBeUndefined();
    expect(duel.fighters.map((fighter) => fighter.health)).toEqual([100, 100]);
    expect(duel.impacts).toEqual([]);
    expect(duel.cast(0, 'lightning', 0)).toBe(true);
  });
  it('maps only known existing spell IDs into demo visuals', () => {
    expect(demoSpell('rune.triangle')).toBe('fireball');
    expect(demoSpell('rune.circle')).toBe('shield');
    expect(demoSpell('rune.lightning')).toBe('lightning');
    expect(demoSpell('unknown')).toBeUndefined();
  });
});
