interface SpellGuideEntry {
  name: string;
  glyph: string;
  gesture: string;
  effect: string;
}

const SPELLS: readonly SpellGuideEntry[] = [
  { name: 'Fireball', glyph: '△', gesture: 'Draw a triangle', effect: 'Traveling attack · 20 damage' },
  { name: 'Shield', glyph: '○', gesture: 'Draw a circle', effect: 'Block the next incoming hit' },
  { name: 'Lightning', glyph: 'ϟ', gesture: 'Draw a zigzag', effect: 'Quick strike · 15 damage' },
  { name: 'Twin Flare', glyph: '⧖', gesture: 'Start at center; draw top, then bottom triangle in one stroke', effect: 'Slow, powerful attack · 45 damage' },
  { name: 'Time Lock', glyph: '□', gesture: 'Draw a square or rectangle', effect: 'Reveal and delay the opponent’s attack by 1.5 seconds' },
  { name: 'Spark', glyph: '━', gesture: 'Draw one straight line', effect: 'Fast, light attack · 7 damage' },
];

export function mountSpellbook(root: HTMLElement, online = false): { dispose(): void } {
  const toggle = root.querySelector<HTMLButtonElement>('#spellbook-toggle')!;
  const closeButton = root.querySelector<HTMLButtonElement>('#spellbook-close')!;
  const panel = root.querySelector<HTMLElement>('#spellbook-panel')!;
  const list = root.querySelector<HTMLUListElement>('#spellbook-list')!;
  const count = root.querySelector<HTMLElement>('#spellbook-count')!;
  const abort = new AbortController();

  const availableSpells = online ? SPELLS.slice(0, 3) : SPELLS;
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
