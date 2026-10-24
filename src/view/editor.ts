import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentLess, insertTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintGutter, setDiagnostics as cmSetDiagnostics, type Diagnostic as CMDiagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { vim, Vim } from '@replit/codemirror-vim';

import type { Settings } from '../settings.js';
import { jsCompletionExtension } from './jsComplete.js';

/** A problem to underline, in document offsets. */
export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

/** The settings the editor itself reacts to. */
export type EditorConfig = Pick<
  Settings,
  'keymap' | 'lineNumbers' | 'wrap' | 'activeLine' | 'closeBrackets' | 'autocomplete' | 'folding' | 'tabSize'
> & { dark: boolean };

/**
 * Reconfigurable parts of the editor.
 *
 * Colours and typography are driven by CSS custom properties instead, so a
 * theme or font change needs no reconfiguration at all — only the extensions
 * that add or remove behaviour live in compartments.
 */
const slots = {
  keymap: new Compartment(),
  lineNumbers: new Compartment(),
  wrap: new Compartment(),
  activeLine: new Compartment(),
  closeBrackets: new Compartment(),
  autocomplete: new Compartment(),
  folding: new Compartment(),
  tabSize: new Compartment(),
  dark: new Compartment(),
};

/**
 * Syntax roles mapped onto the `--tok-*` variables from styles.css, so every
 * theme colours JavaScript without its own highlight style.
 */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: 'var(--tok-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tok-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tok-function)' },
  { tag: t.definition(t.variableName), color: 'var(--tok-definition)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--tok-property)' },
  { tag: [t.className, t.typeName, t.namespace], color: 'var(--tok-type)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--tok-punctuation)' },
  { tag: [t.regexp, t.escape], color: 'var(--tok-escape)' },
  { tag: t.invalid, color: 'var(--tok-error)' },
]);

export interface EditorHandle {
  view: EditorView;
  /** Id of the document on show. */
  readonly current: string;
  text(): string;
  /**
   * Shows document `id`, creating it from `doc` the first time. Each document
   * keeps its own undo history, selection and scroll position.
   */
  open(id: string, doc: string): void;
  /** Forgets a document's saved state (its tab was closed). */
  drop(id: string): void;
  /** A whole new document: every parked state is dropped, `id` starts fresh from `doc`. */
  reset(id: string, doc: string): void;
  configure(config: EditorConfig): void;
  setDiagnostics(items: EditorDiagnostic[]): void;
  /** Replaces the whole document as one undoable edit. */
  replace(doc: string): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  /** Id of the first document, as later passed to open(). */
  id: string;
  doc: string;
  config: EditorConfig;
  onChange(text: string): void;
  /** Fires on cursor movement as well as edits, for the status bar. */
  onSelectionChange(line: number, column: number): void;
  /** Extra bindings that win over everything else (run, play, settings). */
  keys: Array<{ key: string; run: () => boolean }>;
  /** Names defined in the other tabs, offered as completions. */
  symbols(): Completion[];
  /** `:format` in vim mode (and Shift+Alt+F): tidy the document. */
  onFormat(): void;
}

function slotValues(config: EditorConfig, symbols: () => Completion[]): Record<keyof typeof slots, Extension> {
  const unit = ' '.repeat(config.tabSize);
  return {
    // vim() must come first, or normal-mode keys leak through to the default keymap.
    keymap: config.keymap === 'vim' ? vim({ status: true }) : [],
    lineNumbers: config.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    wrap: config.wrap ? EditorView.lineWrapping : [],
    activeLine: config.activeLine ? highlightActiveLine() : [],
    closeBrackets: config.closeBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    autocomplete: config.autocomplete
      ? [autocompletion({ icons: false }), keymap.of(completionKeymap), jsCompletionExtension(symbols)]
      : [],
    folding: config.folding ? [foldGutter(), keymap.of(foldKeymap)] : [],
    tabSize: [EditorState.tabSize.of(config.tabSize), indentUnit.of(unit)],
    // Carries no styling of its own — the stylesheet owns every surface — but
    // CodeMirror uses the flag to pick defaults for anything not covered.
    dark: EditorView.theme({}, { dark: config.dark }),
  };
}

export function createEditor(opts: EditorOptions): EditorHandle {
  let config = opts.config;
  const initial = slotValues(config, opts.symbols);
  const extensions: Extension[] = [
    slots.keymap.of(initial.keymap),
    Prec.highest(keymap.of(opts.keys)),
    slots.lineNumbers.of(initial.lineNumbers),
    slots.folding.of(initial.folding),
    lintGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    javascript(),
    syntaxHighlighting(highlight),
    slots.activeLine.of(initial.activeLine),
    slots.closeBrackets.of(initial.closeBrackets),
    slots.autocomplete.of(initial.autocomplete),
    slots.tabSize.of(initial.tabSize),
    slots.wrap.of(initial.wrap),
    slots.dark.of(initial.dark),
    // Tab would otherwise escape to the browser's focus traversal. Tab types
    // an indent at the cursor (indents the block when a range is selected),
    // Shift-Tab dedents; completion acceptance still wins via its own keymap.
    keymap.of([
      { key: 'Tab', run: insertTab, shift: indentLess },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
      if (u.docChanged || u.selectionSet) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        opts.onSelectionChange(line.number, head - line.from + 1);
      }
    }),
  ];

  const view = new EditorView({ doc: opts.doc, parent: opts.parent, extensions });
  // `:format` (short `:form`), the way shader-editor has it; global to the vim
  // extension, but there is exactly one editor.
  Vim.defineEx('format', 'form', () => opts.onFormat());

  /** Parked documents. The one on show lives in the view, not here. */
  const parked = new Map<string, { state: EditorState; scroll: number }>();
  let current = opts.id;

  const reconfigure = (): void => {
    // Reconfiguring is cheap and idempotent, so there is no point working
    // out which compartments actually changed.
    const values = slotValues(config, opts.symbols);
    view.dispatch({
      effects: (Object.keys(slots) as Array<keyof typeof slots>).map((k) =>
        slots[k].reconfigure(values[k]),
      ),
    });
  };

  return {
    view,
    get current() {
      return current;
    },
    text: () => view.state.doc.toString(),
    open(id, doc) {
      if (id === current) return;
      parked.set(current, { state: view.state, scroll: view.scrollDOM.scrollTop });
      const saved = parked.get(id);
      parked.delete(id);
      current = id;
      view.setState(saved?.state ?? EditorState.create({ doc, extensions }));
      // A parked state still carries the settings it was parked with.
      reconfigure();
      view.scrollDOM.scrollTop = saved?.scroll ?? 0;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      opts.onSelectionChange(line.number, head - line.from + 1);
    },
    drop(id) {
      parked.delete(id);
    },
    reset(id, doc) {
      parked.clear();
      current = id;
      view.setState(EditorState.create({ doc, extensions }));
      reconfigure();
      opts.onSelectionChange(1, 1);
    },
    configure(next) {
      config = next;
      reconfigure();
    },
    replace(doc) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
    },
    setDiagnostics(items) {
      const len = view.state.doc.length;
      const mapped: CMDiagnostic[] = items
        .map((d) => ({
          from: clamp(d.from, 0, len),
          to: clamp(Math.max(d.to, d.from + 1), 0, len),
          severity: d.severity,
          message: d.message,
        }))
        .filter((d) => d.from <= d.to)
        .sort((a, b) => a.from - b.from);
      view.dispatch(cmSetDiagnostics(view.state, mapped));
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
