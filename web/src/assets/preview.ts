import './preview.css';
import { sampleAnimation, type AssetManifest, type AnimationClip } from './animation';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing preview element: ${id}`);
  return result as T;
}

async function start(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/game/`;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error('Asset manifest unavailable. Run npm run assets:extract.');
  const manifest: AssetManifest = await response.json();
  if (manifest.version !== 1 || manifest.clips.length !== 6) throw new Error('Unsupported asset manifest.');
  await Promise.all([manifest.arena, ...manifest.clips.flatMap((clip) => clip.frames.map((frame) => frame.path)), ...manifest.effects.flatMap((clip) => clip.frames.map((frame) => frame.path))].map(async (path) => {
    const image = new Image();
    image.src = base + path;
    await image.decode();
  }));

  const character = element<HTMLSelectElement>('character');
  const animation = element<HTMLSelectElement>('animation');
  const speed = element<HTMLSelectElement>('speed');
  const repeat = element<HTMLInputElement>('repeat');
  const actor = element<HTMLImageElement>('actor');
  const opponent = element<HTMLImageElement>('opponent');
  const play = element<HTMLButtonElement>('play');
  const frames = element('frames');
  let clip: AnimationClip = manifest.clips[0];
  let elapsed = 0;
  let playing = false;
  let previousTime = performance.now();
  let displayedFrame = -1;
  let frameId = 0;

  const setPlaying = (value: boolean) => {
    playing = value;
    play.textContent = value ? 'Pause' : 'Play';
  };
  const display = (index: number) => {
    if (displayedFrame === index) return;
    displayedFrame = index;
    actor.src = base + clip.frames[index].path;
    element<HTMLAnchorElement>('download').href = actor.src;
    const events = clip.events.filter((event) => event.frame === index).map((event) => event.name);
    element('frame-info').textContent = `Frame ${index + 1} / ${clip.frames.length} · ${clip.frames[index].durationMs} ms${events.length ? ` · ${events.join(', ')}` : ''}`;
    for (const [position, button] of [...frames.children].entries()) button.setAttribute('aria-pressed', String(position === index));
  };
  const selectClip = () => {
    const isEffect = character.value === 'effects';
    if (isEffect) {
      const effect = manifest.effects.find((value) => value.id === animation.value)!;
      clip = { ...effect, character: 'effects', state: effect.id, loop: false, uniquePoses: 0, events: [] };
    } else clip = manifest.clips.find((value) => value.character === character.value && value.state === animation.value)!;
    elapsed = 0;
    displayedFrame = -1;
    setPlaying(false);
    actor.style.width = `${clip.width / 1460 * 300}%`;
    actor.style.transform = `translate(-${clip.pivot.x / clip.width * 100}%, -${clip.pivot.y / clip.height * 100}%)`;
    actor.style.left = isEffect ? '50%' : '23%';
    actor.style.top = isEffect ? '60%' : '91%';
    actor.alt = isEffect ? `${clip.id} effect frame` : `${clip.character} ${clip.state} pose`;
    opponent.hidden = isEffect;
    const other = manifest.clips.find((value) => value.character !== clip.character && value.state === 'idle')!;
    opponent.src = base + other.frames[0].path;
    opponent.style.width = actor.style.width;
    opponent.style.transform = `translate(-${(1 - other.pivot.x / other.width) * 100}%, -${other.pivot.y / other.height * 100}%) scaleX(-1)`;
    element('clip-info').textContent = `${clip.frames.length} frames · ${clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0)} ms · ${clip.width} × ${clip.height} · pivot (${clip.pivot.x}, ${clip.pivot.y})`;
    element('pose-note').textContent = isEffect
      ? 'Original effect frames on transparent canvases. 80 ms per frame is a preview timing choice. The fireball canvas includes its full trail.'
      : clip.uniquePoses === 1
      ? 'The source board repeats one identical pose in all six frames. Playback is intentionally still; additional idle artwork is needed for visible motion.'
      : `${clip.uniquePoses} unique poses across ${clip.frames.length} frames. Repeated poses are preserved exactly as illustrated in the source board.`;
    frames.replaceChildren();
    clip.frames.forEach((frame, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Inspect frame ${index + 1}, ${frame.durationMs} milliseconds`);
      const image = new Image();
      image.src = base + frame.path;
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = `${index + 1} · ${frame.durationMs} ms`;
      button.append(image, label);
      button.addEventListener('click', () => {
        setPlaying(false);
        elapsed = clip.frames.slice(0, index).reduce((sum, value) => sum + value.durationMs, 0);
        display(index);
      });
      frames.append(button);
    });
    display(0);
  };
  character.addEventListener('change', () => {
    const choices = character.value === 'effects'
      ? [['fireball', 'Fireball'], ['shield', 'Shield'], ['lightning', 'Lightning']]
      : [['idle', 'Idle'], ['cast', 'Cast fireball'], ['dodge', 'Dodge']];
    animation.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
    selectClip();
  });
  animation.addEventListener('change', selectClip);
  play.addEventListener('click', () => {
    if (sampleAnimation(clip, elapsed).finished) elapsed = 0;
    setPlaying(!playing);
  });
  element('restart').addEventListener('click', () => { elapsed = 0; display(0); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
  const tick = (time: number) => {
    if (playing) {
      elapsed += (time - previousTime) * Number(speed.value);
      const sample = sampleAnimation({ ...clip, loop: clip.loop || repeat.checked }, elapsed);
      display(sample.frame);
      if (sample.finished) setPlaying(false);
    }
    previousTime = time;
    frameId = requestAnimationFrame(tick);
  };
  document.querySelector<HTMLElement>('.arena')!.style.backgroundImage = `url("${base + manifest.arena}")`;
  selectClip();
  element('workshop').hidden = false;
  element('load-status').textContent = 'Character and spell workshop · 57 extracted SVG assets · transparent frames';
  frameId = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(frameId));
  window.addEventListener('pageshow', (event) => { if (event.persisted) { previousTime = performance.now(); frameId = requestAnimationFrame(tick); } });
  import.meta.hot?.dispose(() => cancelAnimationFrame(frameId));
}

void start().catch((error: unknown) => {
  element('load-status').textContent = error instanceof Error ? error.message : 'Artwork could not load.';
  element('load-retry').hidden = false;
});
