import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import * as VF from 'vexflow';

// LSP-style completions for the editor: the api surface with
// signatures and docs, and the whole VexFlow namespace behind `VF.`.
// lang-javascript's own sources (keywords, snippets, locals) stay active;
// these merge in through the language's autocomplete facet.

const API_MEMBERS: Completion[] = [
  snippetCompletion("note('${c/4}', '${q}')", {
    label: 'note',
    type: 'function',
    detail: "(key, duration?, { dots? }?) → NoteEvent",
    info: "note('c/4', 'q') — one pitch. Duration codes: 1 2 4 8 16 32 or w h q; trailing dots allowed ('4.').",
    boost: 3,
  }),
  snippetCompletion("chord(['${c/4}', '${e/4}'], '${h}')", {
    label: 'chord',
    type: 'function',
    detail: "(keys[], duration?, { dots? }?) → NoteEvent",
    info: "chord(['c/4','e/4','g/4'], 'h') — several pitches sounding together.",
    boost: 3,
  }),
  snippetCompletion("rest('${q}')", {
    label: 'rest',
    type: 'function',
    detail: "(duration?, { dots? }?) → NoteEvent",
    info: "rest('q') — silence. Same duration spellings as note().",
    boost: 3,
  }),
  snippetCompletion("score({ ${title: ''}, key: '${C}', time: '${4/4}', tempo: ${100} }, { treble: [${}], bass: [${}] })", {
    label: 'score',
    type: 'function',
    detail: '(meta, { treble?, bass? }) → Score',
    info: "score({ title, key, time, tempo, clef }, { treble: [[...events]], bass: [[...]] }) — assemble the Score that main() must return. Each staff is an array of measures; each measure an array of events.",
    boost: 3,
  }),
  {
    label: 'VF',
    type: 'namespace',
    detail: 'the VexFlow module',
    info: 'Every VexFlow export (StaveNote, Formatter, Beam, …) for direct experimentation.',
    boost: 2,
  },
];

/** The VexFlow namespace, classified once at module load. */
const VF_MEMBERS: Completion[] = Object.keys(VF)
  .sort()
  .map((name) => {
    const value = (VF as Record<string, unknown>)[name];
    const type =
      typeof value === 'function'
        ? /^[A-Z]/.test(name) ? 'class' : 'function'
        : typeof value === 'object' && value !== null ? 'namespace'
        : 'constant';
    return { label: name, type };
  });

const MAIN_SNIPPET: Completion = snippetCompletion(
  "function main({ score, note, chord, rest }) {\n\t${}\n\treturn score({ time: '4/4' }, { treble: [${}] });\n}",
  {
    label: 'main',
    type: 'function',
    detail: 'entry point — must return the score',
    info: 'The document must define main(api); whatever score it returns is engraved and played.',
    boost: 1,
  },
);

export function jsApiCompletions(context: CompletionContext): CompletionResult | null {
  // Member access first: "api.", "VF.", "api.VF." (partial member may follow).
  const member = context.matchBefore(/[\w$]+(?:\.[\w$]*)+/);
  if (member) {
    const lastDot = member.text.lastIndexOf('.');
    const path = member.text.slice(0, lastDot);
    const from = member.from + lastDot + 1;
    if (path === 'api') return { from, options: API_MEMBERS };
    if (path === 'VF' || path === 'api.VF') return { from, options: VF_MEMBERS };
    return null; // someone else's object — leave it to the default sources
  }

  const word = context.matchBefore(/[\w$]+/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;
  // Builders are usually destructured out of `api`, so offer them as bare
  // names too, alongside the main() scaffold.
  return {
    from,
    options: [...API_MEMBERS, MAIN_SNIPPET],
    validFor: /^[\w$]*$/,
  };
}

/** Top-level names other tabs define, since the local scope source can't see them. */
function tabCompletions(symbols: () => Completion[]) {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.matchBefore(/\.[\w$]*$/)) return null;
    const word = context.matchBefore(/[\w$]+/);
    if (!word && !context.explicit) return null;
    return { from: word ? word.from : context.pos, options: symbols(), validFor: /^[\w$]*$/ };
  };
}

/**
 * Top-level declarations in a script: functions, classes and const/let/var
 * names at column 0. A regex rather than a parse, so a half-typed tab still
 * offers whatever it can.
 */
export function topLevelSymbols(text: string, file: string): Completion[] {
  const out: Completion[] = [];
  const re = /^(?:async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(re)) {
    const kind = m[1]!.startsWith('function') ? 'function' : m[1] === 'class' ? 'class' : 'variable';
    out.push({ label: m[2]!, type: kind, detail: `from ${file}`, boost: 1 });
  }
  return out;
}

/** Attach the api completions, names from other tabs, plus runtime-global
 * completions (Map, Math, JSON, Array, … and their members, read off the
 * live globalThis). */
export function jsCompletionExtension(symbols: () => Completion[]): Extension {
  return [
    javascriptLanguage.data.of({ autocomplete: jsApiCompletions }),
    javascriptLanguage.data.of({ autocomplete: tabCompletions(symbols) }),
    javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(globalThis) }),
  ];
}
