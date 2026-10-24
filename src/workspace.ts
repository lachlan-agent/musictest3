import { JS_SEED, type JsSource } from './js/runtime.js';

// The document is a set of tabs sharing one scope. The main tab holds main(api)
// and can't be closed or renamed; every other tab is a helper file whose
// top-level definitions are visible to all the rest.

export const MAIN_TAB = 'main';

export interface Tab {
  id: string;
  name: string;
  text: string;
}

export interface Workspace {
  tabs: Tab[];
  active: string;
  /** What the document is called; "Untitled" until named. */
  name: string;
  /** The library entry it was opened from or last saved to, if any. */
  libId: string | null;
}

export const UNTITLED = 'Untitled';

const STORE = 'musictest3.workspace.v1';
/** The single-document key from before tabs; read once to migrate. */
const LEGACY_DOC = 'musictest3.doc.js';

const MAX_NAME = 40;

export const HELPER_SEED = `// Top-level definitions here are visible in every tab.
// Helper tabs run before main.js, left to right.

`;

export function freshWorkspace(text = JS_SEED): Workspace {
  return { tabs: [{ id: MAIN_TAB, name: 'main.js', text }], active: MAIN_TAB, name: UNTITLED, libId: null };
}

export function loadWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return repair(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_DOC);
    if (legacy != null) return freshWorkspace(legacy);
  } catch {
    // Unreadable storage or a corrupt entry: start over rather than fail to boot.
  }
  return freshWorkspace();
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(ws));
  } catch {
    // Quota or private mode: the text is still in the editor.
  }
}

/** Whatever came out of storage, coerced into a workspace with exactly one main tab. */
function repair(value: unknown): Workspace {
  const raw = (value as Partial<Workspace>)?.tabs;
  const tabs: Tab[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (typeof t?.id !== 'string' || typeof t.text !== 'string' || seen.has(t.id)) continue;
    seen.add(t.id);
    tabs.push({ id: t.id, name: typeof t.name === 'string' && t.name ? t.name : t.id, text: t.text });
  }
  const mainAt = tabs.findIndex((t) => t.id === MAIN_TAB);
  const main = mainAt >= 0 ? tabs.splice(mainAt, 1)[0]! : freshWorkspace().tabs[0]!;
  main.name = 'main.js';
  tabs.unshift(main);
  const { active, name, libId } = (value as Partial<Workspace>) ?? {};
  return {
    tabs,
    active: tabs.some((t) => t.id === active) ? active! : MAIN_TAB,
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : UNTITLED,
    libId: typeof libId === 'string' ? libId : null,
  };
}

/** Any object with tabs, as a workspace: a library entry or an import. */
export function workspaceFrom(value: unknown): Workspace {
  return repair(value);
}

/** Helper tabs left to right, then main, so main's top-level code sees every helper. */
export function evaluationOrder(ws: Workspace): JsSource[] {
  const helpers = ws.tabs.filter((t) => t.id !== MAIN_TAB);
  const main = ws.tabs.find((t) => t.id === MAIN_TAB)!;
  return [...helpers, main].map((t) => ({ id: t.id, text: t.text }));
}

/** Trims a user-typed name, adds `.js` when there is no extension, and keeps it unique. */
export function cleanName(ws: Workspace, wanted: string, self?: string): string {
  let name = wanted.trim().replace(/[\s/\\]+/g, '-').slice(0, MAX_NAME) || 'helpers';
  if (!/\.\w+$/.test(name)) name += '.js';
  const taken = new Set(ws.tabs.filter((t) => t.id !== self).map((t) => t.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const [, stem, ext] = /^(.*?)(\.\w+)$/.exec(name)!;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const BUNDLE_MARK = /^\/\/ ==== (.+?) ====\n\n?/m;

/**
 * A bundle back into tabs: the `// ==== name ====` sections an export writes,
 * with `main.js` as the main tab. Any other script becomes the main tab alone.
 */
export function unbundle(text: string): Workspace {
  text = text.replace(/\r\n?/g, '\n');
  const parts = text.split(/^(?=\/\/ ==== .+? ====$)/m).filter((p) => p.trim());
  if (parts.length < 2 || !BUNDLE_MARK.test(parts[0]!)) return freshWorkspace(text);
  const tabs: Tab[] = [];
  let main: Tab | null = null;
  for (const part of parts) {
    const m = BUNDLE_MARK.exec(part);
    if (!m) continue;
    const name = m[1]!.trim();
    const body = part.slice(m[0].length).replace(/\n+$/, '\n');
    if (name === 'main.js' && !main) main = { id: MAIN_TAB, name, text: body };
    else tabs.push({ id: newTabId(), name, text: body });
  }
  const ws = freshWorkspace(main?.text ?? '');
  ws.tabs.push(...tabs);
  return ws;
}

/** Every tab joined into one runnable file, in evaluation order. */
export function bundle(ws: Workspace): string {
  const order = evaluationOrder(ws);
  if (order.length === 1) return order[0]!.text;
  return order
    .map((s) => {
      const name = ws.tabs.find((t) => t.id === s.id)!.name;
      return `// ==== ${name} ====\n\n${s.text.replace(/\n*$/, '\n')}`;
    })
    .join('\n');
}
