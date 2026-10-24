/**
 * The settings panel.
 *
 * Built from the theme, font, instrument and example registries rather than
 * hand-written markup, so adding a theme in `themes.css` plus a line in
 * `theme.ts` is all it takes to have it appear here.
 */

import { INSTRUMENTS } from './audio/player.js';
import { EXAMPLES } from './js/examples.js';
import {
  FONT_STACKS,
  isTouchScreen,
  MAX_FONT_SIZE,
  MAX_SPEED,
  MAX_ZOOM,
  MIN_FONT_SIZE,
  MIN_SPEED,
  MIN_ZOOM,
  type Keymap,
  type Leading,
  type RunMode,
  type ScorePaper,
  type Settings,
  type WindowKind,
  WINDOW_KINDS,
  GLASS_MODES,
  MAX_FROST,
  type GlassMode,
} from './settings.js';
import { THEMES, themeById, type Theme } from './theme.js';

export interface PanelOptions {
  container: HTMLElement;
  get(): Settings;
  /**
   * Applies a change. `rerender: false` leaves the panel's DOM alone, for
   * sliders mid-drag — rebuilding the panel would drop the pointer.
   */
  update(patch: Partial<Settings>, rerender?: boolean): void;
  loadExample(id: string): void;
  format(): void;
  reset(): void;
  /** Opens another window showing `kind`. */
  newWindow(kind: WindowKind): void;
  /** Windows, editor and split back to the default arrangement. */
  resetLayout(): void;
}

export class SettingsPanel {
  readonly #options: PanelOptions;
  readonly #element: HTMLElement;
  #open = false;
  #themesOpen = false;
  #example = EXAMPLES[0]!.id;
  #windowKind: WindowKind = 'score';

  constructor(options: PanelOptions) {
    this.#options = options;
    this.#element = options.container;
    this.#element.hidden = true;

    // Clicking away or pressing Escape closes the panel, which is what every
    // popover in every other app does.
    document.addEventListener('pointerdown', (event) => {
      if (!this.#open) return;
      const target = event.target as Node;
      if (this.#element.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-panel-toggle]')) return;
      this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.#open) {
        event.preventDefault();
        this.close();
      }
    });
  }

  /** Fires after the panel opens or closes, for the toggle's aria state. */
  onToggle: ((open: boolean) => void) | null = null;

  get isOpen(): boolean {
    return this.#open;
  }

  toggle(): void {
    this.#open ? this.close() : this.open();
  }

  open(): void {
    this.#open = true;
    this.#element.hidden = false;
    this.render();
    this.#element.querySelector<HTMLElement>('button, select')?.focus();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#element.hidden = true;
    this.onToggle?.(false);
  }

  render(): void {
    if (!this.#open) return;
    const settings = this.#options.get();
    const scroll = this.#element.scrollTop;

    this.#element.replaceChildren(
      el('h2', { class: 'panel-title', text: 'Settings' }),
      this.#themeField(settings),
      this.#typeField(settings),
      this.#editorField(settings),
      this.#scoreField(settings),
      this.#layoutField(settings),
      this.#playbackField(settings),
      this.#documentField(),
    );
    // Re-rendering after every change must not jump the panel back to the top.
    this.#element.scrollTop = scroll;
  }

  #themeField(settings: Settings): HTMLElement {
    const current =
      settings.theme === 'system'
        ? { id: 'system', name: 'Match system', note: '', kind: 'dark' as const }
        : themeById(settings.theme);

    // Thirty-odd chips would bury every other setting, so the rack folds
    // away behind a summary showing the theme in use.
    const summary = el('summary', { class: 'theme-summary' }, [
      el('span', { class: 'field-label', text: 'Theme' }),
      el('span', { class: 'theme-current' }, [swatch(current), el('span', { text: current.name })]),
    ]);

    const details = el('details', { class: 'theme-picker' }, [summary]) as HTMLDetailsElement;
    details.open = this.#themesOpen;
    details.addEventListener('toggle', () => (this.#themesOpen = details.open));

    details.append(
      el('div', { class: 'rack' }, [
        chip(
          { id: 'system', name: 'Match system', note: '', kind: 'dark' },
          settings.theme === 'system',
          () => this.#options.update({ theme: 'system' }),
        ),
      ]),
    );

    for (const kind of ['light', 'dark'] as const) {
      const rack = el('div', { class: 'rack' });
      for (const theme of THEMES.filter((th) => th.kind === kind)) {
        rack.append(
          chip(theme, settings.theme === theme.id, () => this.#options.update({ theme: theme.id })),
        );
      }
      details.append(el('span', { class: 'rack-label', text: kind === 'light' ? 'Light' : 'Dark' }), rack);
    }

    const field = el('div', { class: 'field' }, [details]);

    if (settings.theme === 'system') {
      const light = themeById(settings.lightTheme).name;
      const dark = themeById(settings.darkTheme).name;
      field.append(
        el('div', {
          class: 'field-note',
          text: `Follows your operating system (hopefully): ${light} when it is light, ${dark} when it is dark. Pick a theme to change the pair.`,
        }),
      );
    }
    return field;
  }

  #typeField(settings: Settings): HTMLElement {
    const select = el('select') as HTMLSelectElement;
    for (const font of FONT_STACKS) {
      const option = el('option', { text: font.name }) as HTMLOptionElement;
      option.value = font.id;
      option.selected = font.id === settings.fontFamily;
      // Previewing each face in the dropdown saves a round of trial and error.
      option.style.fontFamily = font.stack;
      select.append(option);
    }
    select.addEventListener('change', () => this.#options.update({ fontFamily: select.value }));

    const note = FONT_STACKS.find((f) => f.id === settings.fontFamily)?.note ?? '';
    const size = settings.fontSize;
    const leading: Array<[Leading, string]> = [
      ['tight', 'Tight'],
      ['normal', 'Normal'],
      ['loose', 'Loose'],
    ];

    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Typeface' }),
      select,
      el('div', { class: 'field-note', text: note }),
      row(
        'Size',
        stepper(`${size}px`, size > MIN_FONT_SIZE, size < MAX_FONT_SIZE, (delta) =>
          this.#options.update({ fontSize: size + delta }),
        ),
      ),
      row('Line spacing', this.#choice(leading, settings.leading, (leading) => ({ leading }))),
    ]);
  }

  #editorField(settings: Settings): HTMLElement {
    const keymaps: Array<[Keymap, string]> = [
      ['default', 'Standard'],
      ['vim', 'Vim'],
    ];
    const runModes: Array<[RunMode, string]> = [
      ['live', 'Live'],
      ['pause', 'On pause'],
      ['manual', 'Manual'],
    ];
    const runNote: Record<RunMode, string> = {
      live: 'The score redraws as you type.',
      pause: 'The score redraws once you stop typing for a moment. May be better for performance on large/complex scores.',
      manual: 'The score redraws only on Ctrl/⌘ + Enter or the Run button.',
    };

    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Editor' }),
      row('Key bindings', this.#choice(keymaps, settings.keymap, (keymap) => ({ keymap }))),
      settings.keymap === 'vim'
        ? el('div', {
            class: 'field-note',
            text: isTouchScreen()
              ? 'The mode and : commands appear along the bottom of the editor. Vim needs a hardware keyboard: on-screen keyboards have no Esc key.'
              : 'The mode and : commands appear along the bottom of the editor.',
          })
        : el('span'),
      row('Update score', this.#choice(runModes, settings.runMode, (runMode) => ({ runMode }))),
      el('div', { class: 'field-note', text: runNote[settings.runMode] }),
      row(
        'Indent width',
        this.#choice(
          [
            [2, '2'],
            [4, '4'],
          ] as Array<[2 | 4, string]>,
          settings.tabSize,
          (tabSize) => ({ tabSize }),
        ),
      ),
      this.#switch('Line numbers', 'lineNumbers', settings),
      this.#switch('Wrap long lines', 'wrap', settings),
      this.#switch('Highlight current line', 'activeLine', settings),
      this.#switch('Auto-close brackets', 'closeBrackets', settings),
      this.#switch('Autocomplete', 'autocomplete', settings),
      this.#switch('Code folding', 'folding', settings),
    ]);
  }

  #scoreField(settings: Settings): HTMLElement {
    const papers: Array<[ScorePaper, string]> = [
      ['paper', 'Paper'],
      ['themed', 'Themed'],
      ['dimmed', 'Dimmed'],
    ];
    const paperNote: Record<ScorePaper, string> = {
      paper: 'Black ink on cream paper, the way it prints.',
      themed: 'The engraving takes the theme’s own surface and ink.',
      dimmed: 'Paper, turned down for a dark room. Printing still uses white paper.',
    };

    const bars = el('select') as HTMLSelectElement;
    for (const n of [0, 1, 2, 3, 4, 5, 6, 8]) {
      const option = el('option', { text: n === 0 ? 'Fit to width' : `At most ${n}` }) as HTMLOptionElement;
      option.value = String(n);
      option.selected = n === settings.barsPerLine;
      bars.append(option);
    }
    bars.addEventListener('change', () => this.#options.update({ barsPerLine: Number(bars.value) }));
    bars.classList.add('select-inline');

    const zoom = settings.scoreZoom;
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Score' }),
      row('Paper', this.#choice(papers, settings.scorePaper, (scorePaper) => ({ scorePaper }))),
      el('div', { class: 'field-note', text: paperNote[settings.scorePaper] }),
      row(
        'Zoom',
        stepper(`${Math.round(zoom * 100)}%`, zoom > MIN_ZOOM, zoom < MAX_ZOOM, (delta) =>
          this.#options.update({ scoreZoom: zoom + delta * 0.1 }),
        ),
      ),
      row('Bars per line', bars),
      this.#switch('Title and tempo', 'showHeading', settings),
    ]);
  }

  #layoutField(settings: Settings): HTMLElement {
    const sides: Array<[boolean, string]> = [
      [false, 'Left'],
      [true, 'Right'],
    ];

    const kind = el('select') as HTMLSelectElement;
    for (const [id, name] of WINDOW_KINDS) {
      const option = el('option', { text: name }) as HTMLOptionElement;
      option.value = id;
      option.selected = id === this.#windowKind;
      kind.append(option);
    }
    kind.addEventListener('change', () => (this.#windowKind = kind.value as WindowKind));
    const open = button('Open', 'Open another window (Alt + W opens a score)', () =>
      this.#options.newWindow(this.#windowKind),
    );
    open.classList.remove('btn-icon');

    const glassNote: Record<GlassMode, string> = {
      solid: 'The undocked editor is opaque.',
      tint: 'Undocked, the editor’s backgrounds go translucent so a window behind shows through the code.',
      clear: 'Undocked, the editor has no background at all; only the text and its chrome are drawn.',
      glass: 'Undocked, the editor blurs whatever is behind it, like frosted glass.',
    };
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Layout' }),
      row('Editor side', this.#choice(sides, settings.swapped, (swapped) => ({ swapped }))),
      row('New window', el('div', { class: 'inline' }, [kind, open])),
      el('div', {
        class: 'field-note',
        text: 'Each window’s bar docks or undocks it. Floating windows drag by the bar and resize from any edge; edges snap to other windows (Alt to drag freely). Double-click a bar to tile it, Esc closes the front one. The editor undocks from the button beside its tabs. The layout is remembered.',
      }),
      row('Editor background', this.#choice(GLASS_MODES, settings.editorGlass, (editorGlass) => ({ editorGlass }))),
      ...(settings.editorGlass === 'tint' || settings.editorGlass === 'glass'
        ? [row('Opacity', this.#range(settings.glassTint, 0, 1, 0.05, (glassTint) => ({ glassTint })))]
        : []),
      ...(settings.editorGlass === 'glass'
        ? [row('Frost', this.#range(settings.glassFrost, 0, MAX_FROST, 1, (glassFrost) => ({ glassFrost })))]
        : []),
      el('div', { class: 'field-note', text: glassNote[settings.editorGlass] }),
      el('div', { class: 'inline inline-end' }, [
        wide(button('Reset layout', 'Back to the editor beside one docked score window', () => this.#options.resetLayout())),
      ]),
    ]);
  }

  #range(value: number, min: number, max: number, step: number, patch: (value: number) => Partial<Settings>): HTMLElement {
    const input = el('input', { class: 'slider', type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
    input.value = String(value);
    input.addEventListener('input', () => this.#options.update(patch(Number(input.value)), false));
    return input;
  }

  #playbackField(settings: Settings): HTMLElement {
    const instrument = el('select') as HTMLSelectElement;
    for (const inst of INSTRUMENTS) {
      const option = el('option', { text: inst.name }) as HTMLOptionElement;
      option.value = inst.id;
      option.selected = inst.id === settings.instrument;
      instrument.append(option);
    }
    instrument.addEventListener('change', () => this.#options.update({ instrument: instrument.value }));
    const note = INSTRUMENTS.find((i) => i.id === settings.instrument)?.note ?? '';

    const speed = settings.speed;
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Playback' }),
      instrument,
      el('div', { class: 'field-note', text: `${note}. Samples download on first play.` }),
      row('Volume', this.#slider(settings.volume, (volume) => ({ volume }))),
      row('Reverb', this.#slider(settings.reverb, (reverb) => ({ reverb }))),
      row(
        'Speed',
        stepper(`${Math.round(speed * 100)}%`, speed > MIN_SPEED, speed < MAX_SPEED, (delta) =>
          this.#options.update({ speed: nextIn(SPEEDS, speed, delta) }),
        ),
      ),
      this.#switch('Loop', 'loop', settings),
      this.#switch('Humanise timing', 'humanize', settings),
      this.#switch('Light up sounding notes', 'highlightNotes', settings),
      this.#switch('Scroll to follow', 'followPlayback', settings),
    ]);
  }

  #documentField(): HTMLElement {
    const select = el('select') as HTMLSelectElement;
    for (const example of EXAMPLES) {
      const option = el('option', { text: example.name }) as HTMLOptionElement;
      option.value = example.id;
      option.selected = example.id === this.#example;
      select.append(option);
    }
    select.addEventListener('change', () => (this.#example = select.value));

    const load = button('Load', 'Replace the document with this example (undo restores it)', () =>
      this.#options.loadExample(this.#example),
    );
    load.classList.remove('btn-icon');

    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'Document' }),
      el('div', { class: 'inline' }, [select, load]),
      el('div', { class: 'field-note', text: 'Loading an example is one edit: Ctrl/⌘ + Z brings your text back. Examples with helpers add or overwrite those tabs by name.' }),
      el('div', { class: 'inline inline-end' }, [
        wide(button('Format code', 'Tidy the current tab with Prettier (Shift + Alt + F, or :format in vim mode)', () => this.#options.format())),
        wide(button('Reset settings', 'Every setting back to its default', () => this.#options.reset())),
      ]),
    ]);
  }

  #switch(label: string, key: BooleanKeys, settings: Settings): HTMLElement {
    return row(
      label,
      toggle(settings[key], (on) => this.#options.update({ [key]: on } as Partial<Settings>)),
    );
  }

  #choice<T>(items: Array<[T, string]>, current: T, patch: (value: T) => Partial<Settings>): HTMLElement {
    return segmented(
      items.map(([value, label]) => ({
        label,
        pressed: current === value,
        onClick: () => this.#options.update(patch(value)),
      })),
    );
  }

  /** A 0–1 slider with a percentage readout. */
  #slider(value: number, patch: (value: number) => Partial<Settings>): HTMLElement {
    const input = el('input', { class: 'slider' }) as HTMLInputElement;
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(Math.round(value * 100));
    const readout = el('span', { class: 'stepper-value', text: `${input.value}%` });
    input.addEventListener('input', () => {
      readout.textContent = `${input.value}%`;
      this.#options.update(patch(Number(input.value) / 100), false);
    });
    return el('div', { class: 'stepper' }, [input, readout]);
  }
}

/** Practice tempos: fine steps below full speed, coarse ones above. */
const SPEEDS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The neighbour of `current` in a sorted list, in the direction of `delta`. */
function nextIn(values: number[], current: number, delta: number): number {
  if (delta > 0) return values.find((v) => v > current + 1e-9) ?? values[values.length - 1]!;
  return [...values].reverse().find((v) => v < current - 1e-9) ?? values[0]!;
}

type BooleanKeys = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** A theme chip: a small sheet of that theme's paper, ink and accent. */
function chip(theme: Theme, pressed: boolean, onClick: () => void): HTMLElement {
  const btn = el('button', { class: 'chip', type: 'button' }) as HTMLButtonElement;
  btn.setAttribute('aria-pressed', String(pressed));
  btn.title = theme.note ? `${theme.name} — ${theme.note}` : theme.name;

  // Setting `data-theme` on the chip re-binds the palette variables for its
  // whole subtree, so the chip paints itself in the theme it offers. The
  // "Match system" chip carries no attribute and so shows the active theme —
  // which is exactly what picking it would give you.
  if (theme.id !== 'system') btn.dataset['theme'] = theme.id;

  // Four of the theme's hues, as a tiny row of noteheads.
  const dots = el('span', { class: 'chip-dots' });
  for (const hue of ['magenta', 'orange', 'green', 'blue']) {
    dots.append(el('span', { style: `background: var(--c-${hue})` }));
  }

  btn.append(
    el('span', { class: 'chip-face' }, [el('span', { text: '♪' }), dots]),
    el('span', { class: 'chip-rule' }),
    el('span', { class: 'chip-name', text: theme.name }),
  );
  btn.addEventListener('click', onClick);
  return btn;
}

/** Four of a theme's hues in a tiny strip, for the summary line. */
function swatch(theme: Theme): HTMLElement {
  const strip = el('span', { class: 'theme-swatch' });
  if (theme.id !== 'system') strip.dataset['theme'] = theme.id;
  for (const hue of ['accent', 'c-magenta', 'c-green', 'c-orange']) {
    strip.append(el('span', { style: `background: var(--${hue})` }));
  }
  return strip;
}

function row(label: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'row' }, [el('span', { class: 'row-label', text: label }), control]);
}

function toggle(on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = el('input') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = on;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, [input, el('span', { class: 'switch-track' })]);
}

function stepper(
  value: string,
  canDecrease: boolean,
  canIncrease: boolean,
  onStep: (delta: number) => void,
): HTMLElement {
  const minus = button('−', 'Less', () => onStep(-1));
  const plus = button('+', 'More', () => onStep(1));
  minus.disabled = !canDecrease;
  plus.disabled = !canIncrease;
  return el('div', { class: 'stepper' }, [minus, el('span', { class: 'stepper-value', text: value }), plus]);
}

function segmented(items: Array<{ label: string; pressed: boolean; onClick: () => void }>): HTMLElement {
  const group = el('div', { class: 'segmented' });
  for (const item of items) {
    const element = button(item.label, item.label, item.onClick);
    element.setAttribute('aria-pressed', String(item.pressed));
    group.append(element);
  }
  return group;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', { class: 'btn btn-icon', type: 'button', text: label }) as HTMLButtonElement;
  element.title = title;
  element.addEventListener('click', onClick);
  return element;
}

function wide(b: HTMLButtonElement): HTMLButtonElement {
  b.classList.remove('btn-icon');
  return b;
}

function el(tag: string, attributes: Record<string, string> = {}, children: Element[] = []): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'text') element.textContent = value;
    else element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}
