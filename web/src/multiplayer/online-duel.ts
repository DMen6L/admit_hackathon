import { sampleAnimation, type AssetManifest, type EffectClip } from '../assets/animation';
import type { ApiAuthService } from '../auth/auth-service';
import type { SpellCastPayload } from '../spells/spell-resolver';
import { RoomClient } from './room-client';
import type { MatchState } from './protocol';

const WINDUP_MS = 3000;
const CAST_COOLDOWN_MS = 900;

/** Server snapshots own health and results; this module only animates their deadlines. */
export function mountOnlineDuel(root: HTMLElement, code: string, auth: ApiAuthService): { reset(): void; dispose(): void } {
  const abort = new AbortController();
  const canvas = root.querySelector<HTMLCanvasElement>('.duel-stage canvas')!;
  const ctx = canvas.getContext('2d')!;
  const status = root.querySelector<HTMLElement>('[data-duel-status]')!;
  const overlay = root.querySelector<HTMLElement>('[data-overlay]')!;
  const threat = root.querySelector<HTMLElement>('[data-threat]')!;
  const images = new Map<string, HTMLImageElement>();
  const base = `${import.meta.env.BASE_URL}assets/game/`;
  let manifest: AssetManifest | undefined;
  let state: MatchState | undefined;
  let seat = 0;
  let client: RoomClient | undefined;
  let frameId = 0;
  let disposed = false;
  let connected = false;
  root.setAttribute('aria-label', 'Online duel');
  const roomPanel = document.querySelector<HTMLElement>('[data-room-panel]')!;
  roomPanel.hidden = false;
  roomPanel.querySelector<HTMLElement>('[data-room-code]')!.textContent = code;
  roomPanel.querySelector<HTMLButtonElement>('[data-copy-room]')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      status.textContent = 'Invite link copied. Send it to your friend.';
    } catch {
      status.textContent = `Copy unavailable. Share room code ${code} instead.`;
    }
  }, { signal: abort.signal });
  document.querySelector<HTMLElement>('.game-header .eyebrow')!.textContent = `Wizard Duel / Online room ${code}`;
  root.querySelector<HTMLElement>('[data-duel-help]')!.textContent = 'Watch the other player’s rune. Draw a circle and open your palm to shield before impact. Your casts and health are checked by the server.';
  root.querySelector<HTMLElement>('.duel-head b')!.textContent = 'LIVE VS';
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-side], [data-pause], [data-reset]')) button.hidden = true;
  root.querySelector<HTMLElement>('[data-load-error]')!.hidden = true;
  status.textContent = `Joining room ${code}…`;

  const playerButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-spell]:not([data-side])')];
  const announce = (now: number) => {
    if (!state) return;
    for (const index of [0, 1]) {
      const player = state.players[index];
      const name = player?.displayName || player?.login || 'Waiting for friend';
      root.querySelectorAll<HTMLElement>(`[data-player-name="${index}"]`).forEach((element) => { element.textContent = name; });
      root.querySelector<HTMLProgressElement>(`[data-health="${index}"]`)!.value = player?.health ?? 0;
      root.querySelector<HTMLElement>(`[data-health-label="${index}"]`)!.textContent = player ? `${player.health} / 100` : '—';
    }
    const me = state.players[seat];
    const incoming = state.attacks.find((attack) => attack.seat !== seat && attack.impactAtMs > now);
    const ready = me ? Math.min(CAST_COOLDOWN_MS, Math.max(0, now - (me.castReadyAtMs - CAST_COOLDOWN_MS))) : 0;
    root.querySelector<HTMLProgressElement>('[data-readiness]')!.value = ready;
    root.querySelector<HTMLElement>('[data-ready-label]')!.textContent = incoming && me && now >= me.shieldReadyAtMs
      ? 'Shield ready' : ready >= CAST_COOLDOWN_MS ? 'Ready' : 'Recovering…';
    for (const button of playerButtons) {
      const defensive = button.dataset.spell === 'shield' && incoming && me && now >= me.shieldReadyAtMs;
      button.disabled = !connected || state.phase !== 'active' || (!defensive && ready < CAST_COOLDOWN_MS);
    }
    threat.hidden = !incoming;
    if (incoming) {
      const charging = now < incoming.releaseAtMs;
      threat.classList.toggle('is-incoming', !charging);
      threat.classList.toggle('enemy-left', incoming.seat === 0);
      threat.dataset.spell = incoming.spellId === 'rune.triangle' ? 'fireball' : 'lightning';
      root.querySelector<HTMLElement>('[data-threat-rune]')!.textContent = incoming.spellId === 'rune.triangle' ? '△' : 'ϟ';
      root.querySelector<HTMLElement>('[data-threat-label]')!.textContent = `${state.players[incoming.seat].login}: ${incoming.spellId === 'rune.triangle' ? 'fireball' : 'lightning'}`;
      root.querySelector<HTMLElement>('[data-threat-phase]')!.textContent = charging ? 'Charging — draw a circle to shield!' : 'Incoming — shield now!';
      root.querySelector<HTMLProgressElement>('[data-threat-progress]')!.value = charging
        ? Math.max(0, Math.min(WINDUP_MS, now - incoming.startedAtMs)) : WINDUP_MS;
    }
    overlay.hidden = state.phase === 'active';
    root.querySelector<HTMLElement>('[data-overlay-title]')!.textContent = state.phase === 'waiting'
      ? 'Waiting for opponent' : state.winner === null ? 'Draw' : state.winner === seat ? 'You win' : 'Opponent wins';
    root.querySelector<HTMLElement>('[data-overlay-detail]')!.textContent = state.phase === 'waiting'
      ? `Share room code ${code}. The duel starts when both players connect.` : 'Return to the lobby to choose another duel.';
  };
  const sprite = (path: string, x: number, y: number, width: number, height: number, pivot: { x: number; y: number }, scale: number, flip = false) => {
    const image = images.get(path);
    if (!image) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(flip ? -scale : scale, scale);
    ctx.drawImage(image, -pivot.x, -pivot.y, width, height); ctx.restore();
  };
  const effect = (id: string, elapsed: number, x: number, y: number, flip = false, scale = 3) => {
    const clip: EffectClip | undefined = manifest?.effects.find((value) => value.id === id);
    if (!clip) return;
    const frame = Math.min(clip.frames.length - 1, Math.floor(Math.max(0, elapsed) / 80));
    sprite(clip.frames[frame].path, x, y, clip.width, clip.height, clip.pivot, scale, flip);
  };
  const draw = (now: number) => {
    if (!manifest || !state) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const arena = images.get(manifest.arena);
    if (arena) ctx.drawImage(arena, 0, 0, canvas.width, canvas.height);
    for (const side of [0, 1] as const) {
      const castClip = manifest.clips.find((clip) => clip.character === (side === 0 ? 'berik' : 'alisher') && clip.state === 'cast');
      const idleClip = manifest.clips.find((clip) => clip.character === (side === 0 ? 'berik' : 'alisher') && clip.state === 'idle');
      if (!castClip || !idleClip) continue;
      const attack = state.attacks.find((value) => value.seat === side && now <= value.releaseAtMs);
      const castDuration = castClip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
      const age = attack ? now - (attack.releaseAtMs - castDuration) : Infinity;
      const clip = age >= 0 && age < castDuration ? castClip : idleClip;
      const frame = sampleAnimation(clip, clip === idleClip ? now : age).frame;
      const x = side === 0 ? 320 : 1140;
      sprite(clip.frames[frame].path, x, 436, clip.width, clip.height, clip.pivot, 3, side === 1);
      if (state.players[side]?.shieldUntilMs > now) effect('shield', now, x, 330, false, 4);
      if (attack && now < attack.releaseAtMs) {
        ctx.save(); ctx.fillStyle = attack.spellId === 'rune.triangle' ? '#ffba74' : '#d6baff';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 32; ctx.font = 'bold 82px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(attack.spellId === 'rune.triangle' ? '△' : 'ϟ', x, 150); ctx.restore();
      }
    }
    for (const attack of state.attacks) {
      if (now < attack.releaseAtMs) continue;
      const t = Math.min(1, (now - attack.releaseAtMs) / (attack.impactAtMs - attack.releaseAtMs));
      effect(attack.spellId === 'rune.triangle' ? 'fireball' : 'lightning', now - attack.releaseAtMs,
        attack.seat === 0 ? 430 + t * 640 : 1030 - t * 640, 330, attack.seat === 1);
    }
    for (const impact of state.impacts) {
      const age = now - impact.atMs;
      if (age < 0 || age >= 700) continue;
      ctx.save(); ctx.globalAlpha = 1 - age / 700; ctx.strokeStyle = impact.blocked ? '#67d8ff' : '#ffd166';
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(impact.seat === 0 ? 320 : 1140, 330, 20 + age / 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  };
  const tick = () => {
    if (!disposed) {
      const now = client?.serverNow() ?? Date.now();
      if (!document.hidden) { announce(now); draw(now); }
      frameId = requestAnimationFrame(tick);
    }
  };
  tick();
  const sendCast = (spellId: string) => {
    if (!['rune.triangle', 'rune.circle', 'rune.lightning'].includes(spellId)) {
      status.textContent = 'This spell is available in training mode only. Online duels currently use fireball, shield, and lightning.';
      return;
    }
    if (!client?.cast(spellId)) status.textContent = 'Not connected yet. Wait for both players.';
  };
  for (const button of playerButtons) button.addEventListener('click', () => {
    sendCast(button.dataset.spell === 'fireball' ? 'rune.triangle' : button.dataset.spell === 'shield' ? 'rune.circle' : 'rune.lightning');
  }, { signal: abort.signal });
  window.addEventListener('spell-cast', ((event: CustomEvent<SpellCastPayload>) => sendCast(event.detail.spellId)) as EventListener, { signal: abort.signal });

  void (async () => {
    const token = auth.accessToken();
    if (!token) throw new Error('Your session expired. Sign in again.');
    const response = await fetch(`${auth.apiBaseUrl()}/api/rooms/${code}/join`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: abort.signal,
    });
    const body = await response.json() as { seat?: number; detail?: string };
    if (!response.ok || (body.seat !== 0 && body.seat !== 1)) throw new Error(body.detail ?? 'Could not join this room.');
    seat = body.seat;
    client = new RoomClient(auth.apiBaseUrl(), code, token, {
      onState(next) {
        connected = true;
        state = next;
        status.textContent = next.phase === 'waiting' ? `Room ${code} · waiting for opponent`
          : next.phase === 'finished' ? 'Match finished.' : 'Online duel active. Draw a rune and release your spell.';
      },
      onStatus(message) { connected = false; status.textContent = message; },
      onError(message) { if (message.includes('access expired')) connected = false; status.textContent = message; },
    });
    client.connect();
    const art = await fetch(`${base}manifest.json`, { signal: abort.signal });
    if (!art.ok) throw new Error('Could not load duel artwork.');
    manifest = await art.json() as AssetManifest;
    await Promise.all([manifest.arena, ...manifest.clips.flatMap((clip) => clip.frames.map((frame) => frame.path)),
      ...manifest.effects.flatMap((clip) => clip.frames.map((frame) => frame.path))].map(async (path) => {
      const image = new Image(); image.src = base + path; await image.decode(); images.set(path, image);
    }));
  })().catch((error: unknown) => {
    if (!disposed && (error as Error).name !== 'AbortError') status.textContent = error instanceof Error ? error.message : 'Online duel unavailable.';
  });
  return {
    reset() {},
    dispose() { disposed = true; abort.abort(); client?.dispose(); cancelAnimationFrame(frameId); },
  };
}
