import { MAIN_TAB, type Workspace } from '../workspace.js';

// The strip of tabs above the editor. Stateless: main.ts owns the workspace
// and calls render() after every change; this only turns clicks into calls.

export interface TabBarOptions {
  container: HTMLElement;
  select(id: string): void;
  add(): void;
  close(id: string): void;
  rename(id: string, name: string): void;
}

export class TabBar {
  #options: TabBarOptions;
  /** Tab whose name is being edited, so a re-render keeps the input. */
  #renaming: string | null = null;
  /** Removing a focused input can fire blur; that is not the user leaving it. */
  #rendering = false;

  constructor(options: TabBarOptions) {
    this.#options = options;
    options.container.setAttribute('role', 'tablist');
    options.container.setAttribute('aria-label', 'Script files');
  }

  /** `errors` holds the ids of tabs the last run blamed. */
  render(ws: Workspace, errors: ReadonlySet<string> = new Set()): void {
    const { container } = this.#options;
    // A rebuild mid-rename (a scheduled run, say) keeps what has been typed.
    const live = container.querySelector<HTMLInputElement>('.tab-rename');
    const typed = live ? { value: live.value, start: live.selectionStart, end: live.selectionEnd } : null;
    this.#rendering = true;
    container.replaceChildren();
    this.#rendering = false;

    for (const tab of ws.tabs) {
      const active = tab.id === ws.active;
      const item = document.createElement('div');
      item.className = 'tab';
      item.dataset['id'] = tab.id;
      item.classList.toggle('active', active);
      item.classList.toggle('has-error', errors.has(tab.id));

      if (this.#renaming === tab.id) {
        item.append(this.#renameInput(tab.id, tab.name, typed?.value));
      } else {
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'tab-label';
        label.setAttribute('role', 'tab');
        label.setAttribute('aria-selected', String(active));
        label.textContent = tab.name;
        label.title =
          tab.id === MAIN_TAB
            ? 'main.js: defines main(api); runs after every helper tab'
            : `${tab.name}: double-click to rename, middle-click to close`;
        label.addEventListener('click', () => this.#options.select(tab.id));
        if (tab.id !== MAIN_TAB) {
          label.addEventListener('dblclick', () => this.#startRename(tab.id));
          label.addEventListener('auxclick', (e) => {
            if (e.button === 1) this.#options.close(tab.id);
          });
        }
        item.append(label);
      }

      if (tab.id !== MAIN_TAB) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tab-close';
        close.title = `Close ${tab.name}`;
        close.setAttribute('aria-label', `Close ${tab.name}`);
        close.textContent = '×';
        close.addEventListener('click', () => this.#options.close(tab.id));
        item.append(close);
      }
      container.append(item);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-add';
    add.title = 'New helper tab (Alt + N)';
    add.setAttribute('aria-label', 'New helper tab');
    add.textContent = '+';
    add.addEventListener('click', () => this.#options.add());
    container.append(add);

    container.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const input = container.querySelector<HTMLInputElement>('.tab-rename');
    if (input && typed) input.setSelectionRange(typed.start, typed.end);
    else input?.select();
  }

  /** Puts a tab's name into an input; called on double-click and right after add(). */
  rename(id: string, ws: Workspace): void {
    this.#renaming = id;
    this.render(ws);
  }

  #startRename(id: string): void {
    this.#renaming = id;
    // The caller's next render() would also do this, but a rename needs no
    // workspace change, so ask for the current one by selecting the tab.
    this.#options.select(id);
  }

  /** `name` is what Escape restores; `value`, when given, is what was typed so far. */
  #renameInput(id: string, name: string, value = name): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'tab-rename';
    input.value = value;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Tab name');
    input.size = Math.max(6, value.length);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      this.#renaming = null;
      this.#options.rename(id, commit ? input.value : name);
    };
    input.addEventListener('input', () => (input.size = Math.max(6, input.value.length)));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      else return;
      e.preventDefault();
    });
    input.addEventListener('blur', () => {
      if (!this.#rendering) finish(true);
    });
    queueMicrotask(() => input.focus());
    return input;
  }
}
