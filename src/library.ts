/**
 * The score library: named snapshots of the document, kept in this browser.
 *
 * The working document autosaves as you type (workspace.ts); saving here keeps
 * a copy under a name, the way shader-editor's shader list does. An entry holds
 * the tabs and the window layout they were arranged in.
 */

import type { Settings } from './settings.js';
import type { Tab } from './workspace.js';

/** The layout fields a document carries with it. */
export type SavedLayout = Pick<Settings, 'split' | 'swapped' | 'editorFloating' | 'editorRect' | 'windows'>;

export interface SavedDocument {
  version: 1;
  tabs: Tab[];
  active: string;
  layout?: SavedLayout;
}

export interface LibraryEntry {
  id: string;
  name: string;
  updated: number;
  doc: SavedDocument;
}

const STORE = 'musictest3.library.v1';

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(isEntry);
  } catch {
    return [];
  }
}

/** False when storage refused (quota, private mode): the caller keeps its old list. */
export function persistLibrary(library: LibraryEntry[]): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

export function isSavedDocument(x: unknown): x is SavedDocument {
  const d = x as Partial<SavedDocument> | null;
  return (
    !!d && typeof d === 'object' && d.version === 1 && Array.isArray(d.tabs) &&
    d.tabs.every((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.text === 'string') &&
    typeof d.active === 'string'
  );
}

function isEntry(x: unknown): x is LibraryEntry {
  const e = x as Partial<LibraryEntry> | null;
  return !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.updated === 'number' && isSavedDocument(e.doc);
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** "14:02" today, "Oct 3" otherwise. */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
