// Code formatting, on Prettier. The formatter and its parser are loaded the
// first time they are asked for (about half a megabyte), so the app itself
// stays quick to start.

import type { EditorView } from '@codemirror/view';
import type { Plugin } from 'prettier';
import type * as Standalone from 'prettier/standalone';

export interface FormatSettings {
  tabSize: number;
}

interface Loaded {
  formatWithCursor: typeof Standalone.formatWithCursor;
  plugins: Plugin[];
}

let loading: Promise<Loaded> | null = null;

function prettier(): Promise<Loaded> {
  loading ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ]).then(([standalone, babel, estree]) => ({
    formatWithCursor: standalone.formatWithCursor,
    plugins: [babel as unknown as Plugin, estree as unknown as Plugin],
  }));
  return loading;
}

/**
 * Formats the whole document as one undoable edit, keeping the cursor on the
 * code it was on. Resolves false when nothing changed; throws on a syntax
 * error, with Prettier's message (which names the line).
 */
export async function formatDocument(view: EditorView, settings: FormatSettings): Promise<boolean> {
  const startDoc = view.state.doc;
  const source = startDoc.toString();
  const cursor = view.state.selection.main.head;
  const p = await prettier();
  const result = await p.formatWithCursor(source, {
    parser: 'babel',
    plugins: p.plugins,
    cursorOffset: cursor,
    tabWidth: settings.tabSize,
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
  });
  // Both awaits can outlast a keystroke or a tab switch (the view then holds
  // another document); the result describes the text as it was, so it must
  // not land on anything else.
  if (!view.state.doc.eq(startDoc)) {
    throw new Error('the document changed while formatting; try again');
  }
  if (result.formatted === source) return false;
  view.dispatch({
    changes: { from: 0, to: source.length, insert: result.formatted },
    selection: { anchor: Math.max(0, Math.min(result.cursorOffset, result.formatted.length)) },
    scrollIntoView: true,
    userEvent: 'format',
  });
  return true;
}
