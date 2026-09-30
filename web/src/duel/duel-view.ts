import { sampleAnimation, type AssetManifest, type EffectClip } from '../assets/animation';
import { CAST_COOLDOWN_MS, DemoDuel, demoSpell, spellName, type Attack, type Side, type Spell } from './demo-duel';
import type { SpellCastPayload } from '../spells/spell-resolver';
import { spellAudio } from '../audio/spell-audio';
import { opponentSoundDelayMs } from '../audio/sound-timing';
import type { BackgroundMusic } from '../audio/background-music';
import './duel.css';

export function mountDuel(root: HTMLElement, music: BackgroundMusic): { setParticipants(playerName: string, opponentName?: string): void; reset(): void; dispose(): void } {
  const model = new DemoDuel();
  const abort = new AbortController();
  const base = `${import.meta.env.BASE_URL}assets/game/`;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  canvas.parentElement!.style.backgroundImage = `url("${base}arena.svg")`;
  const ctx = canvas.getContext('2d')!;
  const status = root.querySelector<HTMLElement>('[data-duel-status]')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-pause], [data-reset], [data-spell]')];
  const images = new Map<string, HTMLImageElement>();
  let manifest: AssetManifest | undefined;
  let frameId = 0;
  let clock = 0;
  let previous = performance.now();
  let disposed = false;
  let paused = false;
  let nextEnemyCastAt = 3500;
  let enemyCastIndex = 0;
  let ownAttackReleaseAt = -Infinity;
  const playedAttackReleases = new WeakSet<Attack>();
  const warnedEnemyAttacks = new WeakSet<Attack>();
  const pauseButton = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const readiness = root.querySelector<HTMLProgressElement>('[data-readiness]')!;
  const readyLabel = root.querySelector<HTMLElement>('[data-ready-label]')!;
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!;
  const threat = root.querySelector<HTMLElement>('[data-threat]')!;
  const threatRune = root.querySelector<HTMLElement>('[data-threat-rune]')!;
  const threatLabel = root.querySelector<HTMLElement>('[data-threat-label]')!;
  const threatPhase = root.querySelector<HTMLElement>('[data-threat-phase]')!;
  const threatProgress = root.querySelector<HTMLProgressElement>('[data-threat-progress]')!;
  const visible = () => !document.hidden && root.getClientRects().length > 0;
  const renderParticipants = () => {
    for (const side of [0, 1] as const) {
      root.querySelectorAll<HTMLElement>(`[data-player-name="${side}"]`).forEach((element) => {
        element.textContent = model.name(side);
      });
    }
    canvas.setAttribute('aria-label', `${model.name(0)} и ${model.name(1)} применяют заклинания на арене`);
  };
  const announce = () => {
    music.setActive(Boolean(manifest) && !paused && model.winner === undefined && visible());
    if (status.textContent !== model.message) status.textContent = model.message;
    model.fighters.forEach((fighter, index) => {
      root.querySelector<HTMLProgressElement>(`[data-health="${index}"]`)!.value = fighter.health;
      root.querySelector<HTMLElement>(`[data-health-label="${index}"]`)!.textContent = `${fighter.health} / 100`;
    });
    const ready = Math.min(CAST_COOLDOWN_MS, Math.max(0, clock - model.fighters[0].castAt));
    readiness.value = ready;
    const incoming = model.attacks.find((attack) => attack.side === 1 && attack.impactAt > clock);
    const label = model.winner !== undefined ? 'Дуэль завершена' : paused ? 'Пауза'
      : incoming && model.canCast(0, 'shield', clock) ? 'Щит готов' : ready === CAST_COOLDOWN_MS ? 'Готово' : 'Восстановление…';
    if (readyLabel.textContent !== label) readyLabel.textContent = label;
    buttons.forEach((button) => {
      button.disabled = !manifest || (button.hasAttribute('data-spell') &&
        (paused || !model.canCast(0, button.dataset.spell as Spell, clock)));
    });
    threat.hidden = !incoming || clock >= incoming.releaseAt;
    if (incoming) {
      const charging = clock < incoming.releaseAt;
      if (incoming.revealed) threat.dataset.spell = incoming.spell;
      else delete threat.dataset.spell;
      threat.classList.toggle('is-incoming', !charging);
      threatRune.textContent = incoming.revealed ? incoming.spell === 'fireball' ? '△' : 'ϟ' : '?';
      threatLabel.textContent = incoming.revealed ? `${model.name(1)}: ${spellName(incoming.spell)}` : `${model.name(1)} готовит заклинание`;
      threatPhase.textContent = charging ? 'Зарядка — нарисуйте круг для щита!' : 'Атака близко — ставьте щит!';
      threatProgress.max = incoming.releaseAt - incoming.startedAt;
      threatProgress.value = charging ? Math.min(threatProgress.max, clock - incoming.startedAt) : threatProgress.max;
    }
    pauseButton.disabled = !manifest || model.winner !== undefined;
    pauseButton.textContent = paused ? 'Продолжить' : 'Пауза';
    pauseButton.setAttribute('aria-pressed', String(paused));
    overlay.hidden = !paused && model.winner === undefined;
    root.querySelector<HTMLElement>('[data-overlay-title]')!.textContent = model.winner !== undefined
      ? `${model.name(model.winner)} побеждает` : 'Дуэль на паузе';
    root.querySelector<HTMLElement>('[data-overlay-detail]')!.textContent = model.winner !== undefined
      ? 'Нажмите «Начать заново», чтобы сыграть ещё раз.' : 'Нажмите «Продолжить», когда будете готовы.';
  };
  const cast = (side: Side, spell: Spell) => {
    if (!manifest || !visible() || paused) return;
    const clip = manifest.clips.find((value) => value.character === (side === 0 ? 'berik' : 'alisher') && value.state === 'cast')!;
    const eventFrame = clip.events.find((event) => event.name === 'projectile-release')!.frame;
    const delay = clip.frames.slice(0, eventFrame).reduce((sum, frame) => sum + frame.durationMs, 0);
    if (model.cast(side, spell, clock, delay)) {
      if (side === 0) ownAttackReleaseAt = model.attacks.find((attack) => attack.side === 0 && attack.startedAt === clock)?.releaseAt ?? -Infinity;
      if (spell === 'shield' || spell === 'time-lock') spellAudio.play(spell);
      if (side === 1 || spell === 'time-lock') {
        const enemyAttack = model.attacks.find((attack) => attack.side === 1);
        if (enemyAttack) nextEnemyCastAt = enemyAttack.impactAt + 3200;
        else if (side === 1) nextEnemyCastAt = clock + 3200;
      }
    } else if (model.winner === undefined) model.message = 'Завершите текущее заклинание, прежде чем начать новое.';
    announce();
  };
  buttons.forEach((button) => {
    button.disabled = true;
    button.addEventListener('click', () => {
      if (button.hasAttribute('data-reset')) { model.reset(); clock = 0; nextEnemyCastAt = 3500; enemyCastIndex = 0; ownAttackReleaseAt = -Infinity; paused = false; announce(); }
      else if (button.hasAttribute('data-pause')) { paused = !paused; announce(); }
      else if (button.dataset.spell) cast(0, button.dataset.spell as Spell);
    }, { signal: abort.signal });
  });
  window.addEventListener('spell-cast', ((event: CustomEvent<SpellCastPayload>) => {
    const spell = demoSpell(event.detail.spellId);
    if (spell) cast(0, spell);
  }) as EventListener, { signal: abort.signal });

  const sprite = (path: string, x: number, y: number, width: number, height: number, pivot: { x: number; y: number }, scale: number, flip = false) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -scale : scale, scale);
    ctx.drawImage(images.get(path)!, -pivot.x, -pivot.y, width, height); ctx.restore();
  };
  const effect = (id: string, elapsed: number, x: number, y: number, flip = false, scale = 3) => {
    const clip: EffectClip = manifest!.effects.find((value) => value.id === id)!;
    const frame = Math.min(clip.frames.length - 1, Math.floor(Math.max(0, elapsed) / 80));
    sprite(clip.frames[frame].path, x, y, clip.width, clip.height, clip.pivot, scale, flip);
  };
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(images.get(manifest!.arena)!, 0, 0, 1460, 476);
    for (const side of [0, 1] as const) {
      const fighter = model.fighters[side];
      const character = side === 0 ? 'berik' : 'alisher';
      const castClip = manifest!.clips.find((value) => value.character === character && value.state === 'cast')!;
      const enemyAttack = side === 1 ? model.attacks.find((attack) => attack.side === 1 && attack.releaseAt > clock) : undefined;
      const castDuration = castClip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      const age = enemyAttack ? clock - (enemyAttack.releaseAt - castDuration) : clock - fighter.castAt;
      const released = side === 0 && ownAttackReleaseAt > -Infinity && clock >= ownAttackReleaseAt;
      const clip = !released && age >= 0 && !sampleAnimation(castClip, age).finished && Number.isFinite(age)
        ? castClip : manifest!.clips.find((value) => value.character === character && value.state === 'idle')!;
      const sample = sampleAnimation(clip, clip.state === 'idle' ? clock : age);
      const x = side === 0 ? 320 : 1140;
      sprite(clip.frames[sample.frame].path, x, 436, clip.width, clip.height, clip.pivot, 3, side === 1);
      if (fighter.shieldUntil > clock) effect('shield', clock - fighter.shieldAt, x, 330, false, 4);
      if (fighter.slowNextAttack || model.attacks.some((attack) => attack.side === side && attack.slowed)) {
        ctx.save();
        ctx.strokeStyle = '#c9a8ff';
        ctx.shadowColor = '#a16cff';
        ctx.shadowBlur = 22;
        ctx.lineWidth = 5;
        ctx.strokeRect(x - 94, 145, 188, 222);
        ctx.restore();
      }
    }
    const chargingAttack = model.attacks.find((attack) => attack.side === 1 && clock < attack.releaseAt);
    if (chargingAttack) {
      warnedEnemyAttacks.add(chargingAttack);
      const charge = (clock - chargingAttack.startedAt) / (chargingAttack.releaseAt - chargingAttack.startedAt);
      const color = !chargingAttack.revealed ? '#b9c8df'
        : chargingAttack.spell === 'fireball' ? '#ffba74' : '#d6baff';
      ctx.save();
      ctx.globalAlpha = .65 + .35 * Math.sin(clock / 130) ** 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 + charge * 24;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(1140, 128, 48 + charge * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = 'bold 82px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chargingAttack.revealed ? chargingAttack.spell === 'fireball' ? '△' : 'ϟ' : '?', 1140, 127);
      ctx.restore();
    }
    if (clock - model.lastEnemyMiscastAt < 650) {
      const progress = (clock - model.lastEnemyMiscastAt) / 650;
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.strokeStyle = '#c4d1e1';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(1140, 260, 24 + progress * 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const attack of model.attacks) {
      if (clock < attack.releaseAt) continue;
      const t = (clock - attack.releaseAt) / (attack.impactAt - attack.releaseAt);
      const x = attack.side === 0 ? 430 + t * 640 : 1030 - t * 640;
      const effectId = attack.spell === 'twin-flare' ? 'fireball' : attack.spell === 'spark' ? 'lightning' : attack.spell;
      const scale = attack.spell === 'twin-flare' ? 5 : attack.spell === 'spark' ? 2 : 3;
      effect(effectId, clock - attack.releaseAt, x, 330, attack.side === 1, scale);
      if (!paused && clock > attack.releaseAt && !playedAttackReleases.has(attack)) {
        if (attack.side === 1 && !warnedEnemyAttacks.has(attack)) { playedAttackReleases.add(attack); continue; }
        if (attack.side === 1 && clock < attack.releaseAt + opponentSoundDelayMs(attack.releaseAt, attack.impactAt)) continue;
        playedAttackReleases.add(attack);
        spellAudio.play(attack.spell, attack.impactAt - clock);
      }
    }
    for (const impact of model.impacts) {
      // The board contains no distinct impact burst: use an explicit procedural ring.
      const t = (clock - impact.at) / 400;
      ctx.strokeStyle = impact.blocked ? '#67d8ff' : '#ffd166';
      ctx.globalAlpha = 1 - t; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(impact.side === 0 ? 320 : 1140, 330, 20 + t * 65, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  };
  const tick = (now: number) => {
    if (visible()) {
      if (!paused) {
        clock += Math.min(now - previous, 100);
        model.update(clock);
        if (manifest && model.winner === undefined && clock >= nextEnemyCastAt && model.canCast(1, 'fireball', clock)) {
          cast(1, enemyCastIndex++ % 2 === 0 ? 'fireball' : 'lightning');
        }
      }
      draw(); announce();
    }
    previous = now;
    frameId = requestAnimationFrame(tick);
  };
  void (async () => {
    const response = await fetch(`${base}manifest.json`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error('Не удалось загрузить ресурсы дуэли. Выполните npm run assets:extract и перезагрузите страницу.');
    const loaded: AssetManifest = await response.json();
    if (loaded.version !== 1 || !loaded.effects?.length) throw new Error('Ресурсы дуэли нужно создать заново. Выполните npm run assets:extract.');
    await Promise.all([loaded.arena, ...loaded.clips.flatMap((clip) => clip.frames.map((frame) => frame.path)), ...loaded.effects.flatMap((clip) => clip.frames.map((frame) => frame.path))].map(async (path) => {
      const image = new Image(); image.src = base + path;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`Превышено время загрузки изображения: ${path}`)), 15000);
        image.decode().then(() => { clearTimeout(timer); resolve(); }, (error: unknown) => { clearTimeout(timer); reject(error); });
      });
      images.set(path, image);
    }));
    if (disposed) return;
    manifest = loaded; announce(); draw(); previous = performance.now(); frameId = requestAnimationFrame(tick);
  })().catch(() => {
    if (!disposed) {
      status.textContent = 'Арена временно недоступна.';
      root.querySelector<HTMLElement>('[data-load-error]')!.hidden = false;
    }
  });
  return {
    setParticipants(playerName, opponentName) { model.setParticipants(playerName, opponentName); renderParticipants(); announce(); },
    reset() { model.reset(); clock = 0; nextEnemyCastAt = 3500; enemyCastIndex = 0; ownAttackReleaseAt = -Infinity; paused = false; announce(); },
    dispose() { disposed = true; music.setActive(false); abort.abort(); cancelAnimationFrame(frameId); },
  };
}
