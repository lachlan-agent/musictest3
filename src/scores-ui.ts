/**
 * The Scores panel: name and save the working document, open a saved one,
 * export and import. A popover like the settings panel; main.ts owns the
 * library and the document and does the actual work.
 */

import { fmtDate, type LibraryEntry } from './library.js';
import type { PageSize } from './export/pdf.js';

export interface ScoresOptions {
  container: HTMLElement;
  /** The working document's name and, when it was opened from the library, its entry id. */
  current(): { name: string; libId: string | null; dirty: boolean };
  library(): LibraryEntry[];
  rename(name: string): void;
  save(asCopy: boolean): void;
  fresh(): void;
  open(entry: LibraryEntry): void;
  renameEntry(entry: LibraryEntry, name: string): void;
  deleteEntry(entry: LibraryEntry): void;
  exportJs(): void;
  importJs(file: File): void;
  exportPdf(size: PageSize): void;
  pageSize(): PageSize;
  setPageSize(size: PageSize): void;
}

export class ScoresPanel {
  readonly #options: ScoresOptions;
  readonly #element: HTMLElement;
  #open = false;

  constructor(options: ScoresOptions) {
    this.#options = options;
    this.#element = options.container;
    this.#element.hidden = true;

    document.addEventListener('pointerdown', (event) => {
      if (!this.#open) return;
      const target = event.target as Node;
      if (this.#element.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-scores-toggle]')) return;
      this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.#open) {
        event.preventDefault();
        this.close();
      }
    });
  }

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
    const scroll = this.#element.scrollTop;
    this.#element.replaceChildren(
      el('h2', { class: 'panel-title', text: 'Scores' }),
      this.#currentField(),
      this.#fileField(),
      this.#savedField(),
    );
    this.#element.scrollTop = scroll;
  }

  #currentField(): HTMLElement {
    const { name, libId, dirty } = this.#options.current();
    const input = el('input', { class: 'name-input', type: 'text', placeholder: 'Score name', maxlength: '64', spellcheck: 'false' }) as HTMLInputElement;
    input.value = name;
    input.addEventListener('change', () => this.#options.rename(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.#options.rename(input.value);
        this.#options.save(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        // The global shortcut saves next; it must see the name as typed.
        this.#options.rename(input.value);
      }
    });

    const state = libId ? (dirty ? 'unsaved changes' : 'saved') : 'unsaved';
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, [el('span', { text: 'Current ' }), el('span', { class: 'field-state', text: state })]),
      input,
      el('div', { class: 'inline inline-end' }, [
        button('Save', 'Keep a named snapshot in this browser (Ctrl/⌘ + S)', () => this.#options.save(false)),
        button('Save copy', 'Save as a new entry (Ctrl/⌘ + Shift + S)', () => this.#options.save(true)),
        button('New', 'Start a blank score', () => this.#options.fresh()),
      ]),
      el('div', { class: 'field-note', text: 'Your work is autosaved as you type either way; saving keeps a named copy, with its window layout.' }),
    ]);
  }

  #fileField(): HTMLElement {
    const file = el('input', { type: 'file', accept: '.js,.mjs,.txt,text/javascript', hidden: '' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      const picked = file.files?.[0];
      if (picked) this.#options.importJs(picked);
      file.value = '';
    });

    const size = el('select', { class: 'select-inline', title: 'Page size' }) as HTMLSelectElement;
    for (const [id, label] of [['a4', 'A4'], ['letter', 'Letter']] as Array<[PageSize, string]>) {
      const o = el('option', { text: label }) as HTMLOptionElement;
      o.value = id;
      o.selected = id === this.#options.pageSize();
      size.append(o);
    }
    size.addEventListener('change', () => this.#options.setPageSize(size.value as PageSize));

    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label', text: 'File' }),
      el('div', { class: 'inline' }, [
        button('Export .js', 'Download every tab as one runnable .js file, helpers first', () => this.#options.exportJs()),
        button('Import .js', 'Open a .js file: one exported from here (tabs restored) or any script defining main(api)', () => file.click()),
        file,
      ]),
      el('div', { class: 'inline', style: 'margin-top: 8px' }, [
        button('Export PDF', 'Engrave the score onto pages and download a PDF', () => this.#options.exportPdf(size.value as PageSize)),
        size,
      ]),
      el('div', { class: 'field-note', text: 'The PDF is rendered at print resolution with the title block on the first page; a system never splits across pages.' }),
    ]);
  }

  #savedField(): HTMLElement {
    const library = this.#options.library();
    const { libId } = this.#options.current();
    const list = el('div', { class: 'score-list' });
    if (!library.length) {
      list.append(el('div', { class: 'field-note', text: 'Nothing saved yet. Name the score above and press Save.' }));
    }
    for (const entry of [...library].sort((a, b) => b.updated - a.updated)) {
      const row = el('div', { class: `score-row${entry.id === libId ? ' current' : ''}`, title: `Open "${entry.name}"` });
      const bars = entry.doc.tabs.length;
      const meta = `${bars === 1 ? 'main only' : `${bars} tabs`} · ${fmtDate(entry.updated)}`;
      const main = el('div', { class: 'sr-main' }, [
        el('div', { class: 'sr-name', text: entry.name }),
        el('div', { class: 'sr-meta', text: meta }),
      ]);
      const rename = el('button', { class: 'sr-btn', type: 'button', text: '✎', title: 'Rename' });
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        const typed = prompt('Rename score', entry.name);
        if (typed === null || !typed.trim()) return;
        this.#options.renameEntry(entry, typed.trim());
      });
      const del = el('button', { class: 'sr-btn sr-danger', type: 'button', text: '✕', title: 'Delete' });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${entry.name}" from this browser?`)) return;
        this.#options.deleteEntry(entry);
      });
      row.append(main, el('div', { class: 'sr-actions' }, [rename, del]));
      row.addEventListener('click', () => this.#options.open(entry));
      list.append(row);
    }
    return el('div', { class: 'field' }, [
      el('span', { class: 'field-label' }, [el('span', { text: 'Saved ' }), el('span', { class: 'field-state', text: library.length ? String(library.length) : '' })]),
      list,
    ]);
  }
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'btn', type: 'button', text: label, title }) as HTMLButtonElement;
  b.addEventListener('click', onClick);
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
