import './preview.css';
import { sampleAnimation, type AssetManifest, type AnimationClip } from './animation';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Не найден элемент предпросмотра: ${id}`);
  return result as T;
}

async function start(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/game/`;
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) throw new Error('Список ресурсов недоступен. Выполните npm run assets:extract.');
  const manifest: AssetManifest = await response.json();
  if (manifest.version !== 1 || manifest.clips.length !== 6) throw new Error('Неподдерживаемый список ресурсов.');
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
    play.textContent = value ? 'Пауза' : 'Воспроизвести';
  };
  const display = (index: number) => {
    if (displayedFrame === index) return;
    displayedFrame = index;
    actor.src = base + clip.frames[index].path;
    element<HTMLAnchorElement>('download').href = actor.src;
    const events = clip.events.filter((event) => event.frame === index).map((event) => event.name === 'projectile-release' ? 'выпуск снаряда' : 'событие анимации');
    element('frame-info').textContent = `Кадр ${index + 1} / ${clip.frames.length} · ${clip.frames[index].durationMs} мс${events.length ? ` · ${events.join(', ')}` : ''}`;
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
    const characterName = clip.character === 'berik' ? 'Берик' : 'Алишер';
    const poseName = clip.state === 'idle' ? 'ожидание' : clip.state === 'cast' ? 'заклинание' : 'уклонение';
    actor.alt = isEffect ? 'Кадр эффекта заклинания' : `${characterName}: ${poseName}`;
    opponent.hidden = isEffect;
    const other = manifest.clips.find((value) => value.character !== clip.character && value.state === 'idle')!;
    opponent.src = base + other.frames[0].path;
    opponent.style.width = actor.style.width;
    opponent.style.transform = `translate(-${(1 - other.pivot.x / other.width) * 100}%, -${other.pivot.y / other.height * 100}%) scaleX(-1)`;
    element('clip-info').textContent = `${clip.frames.length} кадров · ${clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0)} мс · ${clip.width} × ${clip.height} · точка опоры (${clip.pivot.x}, ${clip.pivot.y})`;
    element('pose-note').textContent = isEffect
      ? 'Исходные кадры эффектов на прозрачном фоне. 80 мс на кадр выбраны для предпросмотра. След огненного шара виден полностью.'
      : clip.uniquePoses === 1
      ? 'На исходном листе во всех шести кадрах одна поза. Поэтому анимация ожидания неподвижна.'
      : `${clip.uniquePoses} уникальных поз в ${clip.frames.length} кадрах. Повторяющиеся позы сохранены по исходному рисунку.`;
    frames.replaceChildren();
    clip.frames.forEach((frame, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Просмотреть кадр ${index + 1}, ${frame.durationMs} миллисекунд`);
      const image = new Image();
      image.src = base + frame.path;
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = `${index + 1} · ${frame.durationMs} мс`;
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
      ? [['fireball', 'Огненный шар'], ['shield', 'Щит'], ['lightning', 'Молния']]
      : [['idle', 'Ожидание'], ['cast', 'Огненный шар'], ['dodge', 'Уклонение']];
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
  element('load-status').textContent = 'Мастерская персонажей и заклинаний · 57 SVG-ресурсов · прозрачные кадры';
  frameId = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(frameId));
  window.addEventListener('pageshow', (event) => { if (event.persisted) { previousTime = performance.now(); frameId = requestAnimationFrame(tick); } });
  import.meta.hot?.dispose(() => cancelAnimationFrame(frameId));
}

void start().catch((error: unknown) => {
  element('load-status').textContent = error instanceof Error ? error.message : 'Не удалось загрузить графику.';
  element('load-retry').hidden = false;
});
