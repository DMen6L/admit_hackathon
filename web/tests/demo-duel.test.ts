import { describe, expect, it } from 'vitest';
import { DemoDuel, ENEMY_MISCAST_CHANCE, ENEMY_WINDUP_MS, demoSpell } from '../src/duel/demo-duel';

describe('local practice duel', () => {
  it('uses the signed-in username and accepts an opponent username for future player duels', () => {
    const duel = new DemoDuel(() => 1);
    duel.setParticipants('mage_42');
    expect(duel.name(0)).toBe('mage_42');
    expect(duel.name(1)).toBe('Computer (AI)');
    duel.cast(0, 'shield', 0);
    expect(duel.message).toContain('mage_42');
    duel.setParticipants('mage_42', 'rival_7');
    expect(duel.name(1)).toBe('rival_7');
    duel.cast(1, 'fireball', 1000);
    expect(duel.message).toContain('rival_7');
    duel.reset();
    expect(duel.name(1)).toBe('rival_7');
  });

  it('damages only on impact and resolves each projectile once', () => {
    const duel = new DemoDuel(() => 1);
    expect(duel.cast(0, 'fireball', 0)).toBe(true);
    expect(duel.cast(0, 'fireball', 10)).toBe(false);
    duel.update(1039);
    expect(duel.fighters[1].health).toBe(100);
    duel.update(1040);
    duel.update(2000);
    expect(duel.fighters[1].health).toBe(80);
  });
  it('consumes shields at impact, including when a render frame is skipped', () => {
    const duel = new DemoDuel(() => 1);
    duel.cast(1, 'shield', 0);
    duel.cast(0, 'fireball', 1000);
    duel.update(4000);
    expect(duel.fighters[1].health).toBe(100);
    expect(duel.fighters[1].shieldUntil).toBe(0);
  });
  it.each(['fireball', 'lightning'] as const)('telegraphs enemy %s long enough to react', (spell) => {
    const duel = new DemoDuel(() => 1);
    expect(duel.cast(1, spell, 100, 100)).toBe(true);
    const attack = duel.attacks[0];
    expect(ENEMY_WINDUP_MS).toBe(3000);
    expect(attack.releaseAt - attack.startedAt).toBe(ENEMY_WINDUP_MS);
    expect(duel.cast(1, spell, 1000)).toBe(false);
    duel.update(attack.releaseAt - 1);
    expect(duel.fighters[0].health).toBe(100);
    expect(duel.message).toContain('charging');
    duel.update(attack.releaseAt);
    expect(duel.message).toContain('released');
    expect(duel.cast(0, 'shield', attack.releaseAt + 100)).toBe(true);
    duel.update(attack.impactAt);
    expect(duel.fighters[0].health).toBe(100);
    expect(duel.fighters[0].shieldUntil).toBe(0);
  });
  it('allows one defensive shield while an attack spell is cooling down', () => {
    const duel = new DemoDuel(() => 1);
    duel.cast(0, 'fireball', 1000);
    duel.cast(1, 'lightning', 1100);
    expect(duel.canCast(0, 'shield', 1200)).toBe(true);
    expect(duel.cast(0, 'shield', 1200)).toBe(true);
    expect(duel.cast(0, 'shield', 1300)).toBe(false);
    duel.update(4600);
    expect(duel.fighters[0].health).toBe(100);
  });
  it('keeps an early reactive shield active through the full fireball warning and travel', () => {
    const duel = new DemoDuel();
    duel.cast(1, 'fireball', 100);
    duel.cast(0, 'shield', 100);
    duel.update(3900);
    expect(duel.fighters[0].health).toBe(100);
  });
  it('does not block attacks after shield expiration', () => {
    const duel = new DemoDuel(() => 1);
    duel.cast(1, 'shield', 0);
    duel.cast(0, 'fireball', 4300);
    duel.update(6000);
    expect(duel.fighters[1].health).toBe(80);
  });
  it('ends the duel and clears effects and cooldowns on restart', () => {
    const duel = new DemoDuel(() => 1);
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
    expect(demoSpell('rune.hourglass')).toBe('twin-flare');
    expect(demoSpell('rune.square')).toBe('time-lock');
    expect(demoSpell('rune.line')).toBe('spark');
    expect(demoSpell('unknown')).toBeUndefined();
  });

  it('gives the hourglass a slow heavy impact and the line a quick light hit', () => {
    const duel = new DemoDuel(() => 1);
    expect(duel.cast(0, 'twin-flare', 0)).toBe(true);
    const heavyImpact = duel.attacks[0].impactAt;
    expect(heavyImpact).toBeGreaterThan(2000);
    duel.update(heavyImpact);
    expect(duel.fighters[1].health).toBe(55);
    expect(duel.cast(0, 'spark', heavyImpact + 1)).toBe(true);
    const sparkImpact = duel.attacks[0].impactAt;
    expect(sparkImpact - heavyImpact).toBeLessThan(500);
    duel.update(sparkImpact);
    expect(duel.fighters[1].health).toBe(48);
  });

  it('slows a charging attack or the next attack when the square is cast early', () => {
    const duel = new DemoDuel(() => 1);
    expect(duel.cast(0, 'time-lock', 0)).toBe(true);
    expect(duel.fighters[1].slowNextAttack).toBe(true);
    expect(duel.cast(1, 'fireball', 1000)).toBe(true);
    expect(duel.attacks[0].releaseAt - duel.attacks[0].startedAt).toBe(ENEMY_WINDUP_MS + 1500);
    expect(duel.fighters[1].slowNextAttack).toBe(false);
    const firstImpact = duel.attacks[0].impactAt;
    expect(duel.cast(0, 'time-lock', 1200)).toBe(true);
    expect(duel.attacks[0].impactAt).toBe(firstImpact);
    expect(duel.fighters[1].slowNextAttack).toBe(true);

    const fresh = new DemoDuel(() => 1);
    fresh.cast(1, 'lightning', 100);
    const originalImpact = fresh.attacks[0].impactAt;
    expect(fresh.cast(0, 'time-lock', 300)).toBe(true);
    expect(fresh.attacks[0].impactAt).toBe(originalImpact + 1500);
    expect(fresh.attacks[0].slowed).toBe(true);
  });

  it('keeps enemy spell identity hidden until Time Lock reveals it', () => {
    const duel = new DemoDuel(() => 1);
    duel.cast(1, 'fireball', 0);
    expect(duel.attacks[0].revealed).toBe(false);
    expect(duel.message).not.toContain('fireball');
    duel.update(ENEMY_WINDUP_MS);
    expect(duel.message).not.toContain('fireball');

    const next = new DemoDuel(() => 1);
    next.cast(1, 'lightning', 0);
    next.cast(0, 'time-lock', 100);
    expect(next.attacks[0].revealed).toBe(true);
    expect(next.message).toContain('lightning');
    next.update(next.attacks[0].releaseAt);
    expect(next.message).toContain('lightning');

    const queued = new DemoDuel(() => 1);
    queued.cast(0, 'time-lock', 0);
    queued.cast(1, 'fireball', 1000);
    expect(queued.attacks[0].revealed).toBe(true);

    const inFlight = new DemoDuel(() => 1);
    inFlight.cast(1, 'fireball', 0);
    const impactAt = inFlight.attacks[0].impactAt;
    inFlight.update(ENEMY_WINDUP_MS);
    inFlight.cast(0, 'time-lock', ENEMY_WINDUP_MS + 100);
    expect(inFlight.attacks[0].revealed).toBe(true);
    expect(inFlight.attacks[0].impactAt).toBe(impactAt);
    expect(inFlight.fighters[1].revealNextAttack).toBe(true);
  });

  it('lets an enemy attack fizzle once per attempted cast without spending Time Lock', () => {
    let roll = 0;
    const duel = new DemoDuel(() => { const result = roll; roll = 1; return result; });
    duel.cast(0, 'time-lock', 0);
    expect(duel.cast(1, 'fireball', 1000)).toBe(true);
    expect(duel.attacks).toHaveLength(0);
    expect(duel.lastEnemyMiscastAt).toBe(1000);
    expect(duel.message).toContain('fizzles');
    expect(duel.fighters[1].slowNextAttack).toBe(true);
    expect(duel.canCast(1, 'lightning', 1500)).toBe(false);
    expect(duel.cast(1, 'lightning', 2000)).toBe(true);
    expect(duel.attacks[0].slowed).toBe(true);
    expect(duel.attacks[0].revealed).toBe(true);
    expect(duel.attacks[0].spell).toBe('lightning');
  });

  it('applies the 15% miscast chance only to Alisher', () => {
    expect(ENEMY_MISCAST_CHANCE).toBe(0.15);
    const duel = new DemoDuel(() => 0);
    expect(duel.cast(0, 'fireball', 0)).toBe(true);
    expect(duel.attacks).toHaveLength(1);
    expect(duel.cast(1, 'lightning', 0)).toBe(true);
    expect(duel.attacks).toHaveLength(1);
    expect(duel.lastEnemyMiscastAt).toBe(0);
  });
});
