import { sampleAnimation, type AssetManifest, type EffectClip } from '../assets/animation';
import { DemoDuel, demoSpell, type Side, type Spell } from './demo-duel';
import type { SpellCastPayload } from '../spells/spell-resolver';
import './duel.css';

export function mountDuel(root: HTMLElement): { reset(): void; dispose(): void } {
  const model = new DemoDuel();
  const abort = new AbortController();
  const base = `${import.meta.env.BASE_URL}assets/game/`;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  canvas.parentElement!.style.backgroundImage = `url("${base}arena.svg")`;
  const ctx = canvas.getContext('2d')!;
  const status = root.querySelector<HTMLElement>('[data-duel-status]')!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
  const images = new Map<string, HTMLImageElement>();
  let manifest: AssetManifest | undefined;
  let frameId = 0;
  let clock = 0;
  let previous = performance.now();
  let disposed = false;
  let paused = false;
  const pauseButton = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const readiness = root.querySelector<HTMLProgressElement>('[data-readiness]')!;
  const readyLabel = root.querySelector<HTMLElement>('[data-ready-label]')!;
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!;
  const visible = () => !document.hidden && root.getClientRects().length > 0;
  const announce = () => {
    if (status.textContent !== model.message) status.textContent = model.message;
    model.fighters.forEach((fighter, index) => {
      root.querySelector<HTMLProgressElement>(`[data-health="${index}"]`)!.value = fighter.health;
      root.querySelector<HTMLElement>(`[data-health-label="${index}"]`)!.textContent = `${fighter.health} / 100`;
    });
    const ready = Math.min(900, Math.max(0, clock - model.fighters[0].castAt));
    readiness.value = ready;
    const label = model.winner !== undefined ? 'Duel finished' : paused ? 'Paused' : ready === 900 ? 'Ready' : 'Recovering…';
    if (readyLabel.textContent !== label) readyLabel.textContent = label;
    buttons.forEach((button) => {
      const side = button.dataset.side === '1' ? 1 : 0;
      button.disabled = !manifest || (button.hasAttribute('data-spell') && (paused || model.winner !== undefined || clock - model.fighters[side].castAt < 900));
    });
    pauseButton.disabled = !manifest || model.winner !== undefined;
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    pauseButton.setAttribute('aria-pressed', String(paused));
    overlay.hidden = !paused && model.winner === undefined;
    root.querySelector<HTMLElement>('[data-overlay-title]')!.textContent = model.winner !== undefined
      ? `${model.winner === 0 ? 'Berik' : 'Alisher'} wins` : 'Duel paused';
    root.querySelector<HTMLElement>('[data-overlay-detail]')!.textContent = model.winner !== undefined
      ? 'Choose Restart duel to practice again.' : 'Choose Resume when you are ready.';
  };
  const cast = (side: Side, spell: Spell) => {
    if (!manifest || !visible() || paused) return;
    const clip = manifest.clips.find((value) => value.character === (side === 0 ? 'berik' : 'alisher') && value.state === 'cast')!;
    const eventFrame = clip.events.find((event) => event.name === 'projectile-release')!.frame;
    const delay = clip.frames.slice(0, eventFrame).reduce((sum, frame) => sum + frame.durationMs, 0);
    if (!model.cast(side, spell, clock, delay) && model.winner === undefined) model.message = 'Finish the current cast before casting again.';
    announce();
  };
  buttons.forEach((button) => {
    button.disabled = true;
    button.addEventListener('click', () => {
      if (button.hasAttribute('data-reset')) { model.reset(); paused = false; announce(); }
      else if (button.hasAttribute('data-pause')) { paused = !paused; announce(); }
      else cast(button.dataset.side === '1' ? 1 : 0, button.dataset.spell as Spell);
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
      const age = clock - fighter.castAt;
      const clip = !sampleAnimation(castClip, age).finished && Number.isFinite(age)
        ? castClip : manifest!.clips.find((value) => value.character === character && value.state === 'idle')!;
      const sample = sampleAnimation(clip, clip.state === 'idle' ? clock : age);
      const x = side === 0 ? 320 : 1140;
      sprite(clip.frames[sample.frame].path, x, 436, clip.width, clip.height, clip.pivot, 3, side === 1);
      if (fighter.shieldUntil > clock) effect('shield', age, x, 330, false, 4);
    }
    for (const attack of model.attacks) {
      if (clock < attack.releaseAt) continue;
      const t = (clock - attack.releaseAt) / (attack.impactAt - attack.releaseAt);
      const x = attack.side === 0 ? 430 + t * 640 : 1030 - t * 640;
      effect(attack.spell, clock - attack.releaseAt, x, 330, attack.side === 1);
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
      if (!paused) { clock += Math.min(now - previous, 100); model.update(clock); }
      draw(); announce();
    }
    previous = now;
    frameId = requestAnimationFrame(tick);
  };
  void (async () => {
    const response = await fetch(`${base}manifest.json`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) throw new Error('Could not load duel assets. Run npm run assets:extract and reload.');
    const loaded: AssetManifest = await response.json();
    if (loaded.version !== 1 || !loaded.effects?.length) throw new Error('Duel assets need regeneration. Run npm run assets:extract.');
    await Promise.all([loaded.arena, ...loaded.clips.flatMap((clip) => clip.frames.map((frame) => frame.path)), ...loaded.effects.flatMap((clip) => clip.frames.map((frame) => frame.path))].map(async (path) => {
      const image = new Image(); image.src = base + path;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`Image loading timed out: ${path}`)), 15000);
        image.decode().then(() => { clearTimeout(timer); resolve(); }, (error: unknown) => { clearTimeout(timer); reject(error); });
      });
      images.set(path, image);
    }));
    if (disposed) return;
    manifest = loaded; announce(); draw(); previous = performance.now(); frameId = requestAnimationFrame(tick);
  })().catch(() => {
    if (!disposed) {
      status.textContent = 'The arena is temporarily unavailable.';
      root.querySelector<HTMLElement>('[data-load-error]')!.hidden = false;
    }
  });
  return {
    reset() { model.reset(); clock = 0; paused = false; announce(); },
    dispose() { disposed = true; abort.abort(); cancelAnimationFrame(frameId); },
  };
}
