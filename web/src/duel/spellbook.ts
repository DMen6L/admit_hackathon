interface SpellGuideEntry {
  name: string;
  glyph: string;
  gesture: string;
  effect: string;
}

const SPELLS: readonly SpellGuideEntry[] = [
  { name: 'Огненный шар', glyph: '△', gesture: 'Нарисуйте треугольник', effect: 'Атака · 20 урона' },
  { name: 'Щит', glyph: '○', gesture: 'Нарисуйте круг', effect: 'Блокирует следующий удар' },
  { name: 'Молния', glyph: 'ϟ', gesture: 'Нарисуйте зигзаг', effect: 'Быстрый удар · 15 урона' },
  { name: 'Двойное пламя', glyph: '⧖', gesture: 'Начните в центре; одним движением нарисуйте верхний и нижний треугольники', effect: 'Мощная атака · 45 урона' },
  { name: 'Остановка времени', glyph: '□', gesture: 'Нарисуйте квадрат или прямоугольник', effect: 'Задерживает текущую или следующую атаку соперника на 1,5 секунды' },
  { name: 'Искра', glyph: '━', gesture: 'Нарисуйте одну прямую линию', effect: 'Быстрая атака · 7 урона' },
];

export function mountSpellbook(root: HTMLElement): { dispose(): void } {
  const toggle = root.querySelector<HTMLButtonElement>('#spellbook-toggle')!;
  const closeButton = root.querySelector<HTMLButtonElement>('#spellbook-close')!;
  const panel = root.querySelector<HTMLElement>('#spellbook-panel')!;
  const list = root.querySelector<HTMLUListElement>('#spellbook-list')!;
  const count = root.querySelector<HTMLElement>('#spellbook-count')!;
  const abort = new AbortController();

  const availableSpells = SPELLS;
  count.textContent = String(availableSpells.length);
  list.replaceChildren(...availableSpells.map(({ name, glyph, gesture, effect }) => {
    const item = document.createElement('li');
    const symbol = document.createElement('span');
    symbol.className = 'spellbook-list__glyph';
    symbol.textContent = glyph;
    symbol.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = name;
    const instruction = document.createElement('span');
    instruction.textContent = gesture;
    const description = document.createElement('small');
    description.textContent = effect;
    copy.append(title, instruction, description);
    item.append(symbol, copy);
    return item;
  }));

  const setOpen = (open: boolean, returnFocus = false) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.focus();
    else if (returnFocus) toggle.focus();
  };

  toggle.addEventListener('click', () => setOpen(panel.hasAttribute('hidden')), { signal: abort.signal });
  closeButton.addEventListener('click', () => setOpen(false, true), { signal: abort.signal });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target as Node) && !toggle.contains(event.target as Node)) setOpen(false);
  }, { signal: abort.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false, true);
  }, { signal: abort.signal });

  return { dispose: () => abort.abort() };
}
