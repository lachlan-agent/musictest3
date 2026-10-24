import * as VF from 'vexflow';

import { diatonicOf, parseKey, resolveKeySignature } from '../music/pitch.js';
import { barCapacity, durationCode, isValidTimeSignature, unitsWithDots } from '../music/rhythm.js';
import type { ClefMode, Measure, NoteEvent, Score, Voice } from '../model/types.js';

// The document is a plain script that must define `main(api)`; whatever Score
// it returns is engraved and played. The api hands over small builders (note/
// chord/rest/score) plus the whole VexFlow namespace for anyone who wants to go
// off-road — but the contract is always: main returns the score.

export interface JsApi {
  /** note('c/4', 'q'), note('c/4', 4), or note('c/4', '8.', { dots: 1 }) */
  note(key: string, duration?: string | number, opts?: { dots?: number }): NoteEvent;
  /** chord(['c/4','e/4','g/4'], 'h') */
  chord(keys: string[], duration?: string | number, opts?: { dots?: number }): NoteEvent;
  rest(duration?: string | number, opts?: { dots?: number }): NoteEvent;
  /**
   * Assemble the final Score. Each staff is either measures (arrays of events)
   * or one flat event list, which gets barred automatically by the time signature.
   */
  score(
    meta: { title?: string; key?: string; time?: string; tempo?: number; clef?: ClefMode },
    staves: { treble?: NoteEvent[][] | NoteEvent[]; bass?: NoteEvent[][] | NoteEvent[] },
  ): Score;
  /** The full VexFlow module, for direct experimentation. */
  VF: typeof VF;
}

/** One console call made while the script ran. */
export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

const LOG_LEVELS: LogEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug'];
/** Tempos outside this range are taken as typos and pulled back in. */
const MIN_TEMPO = 10;
const MAX_TEMPO = 600;
/** Past this many lines a run is looping, not logging. */
const MAX_LOGS = 500;

export interface JsRunResult {
  score: Score | null;
  /** Everything the script printed through `console`, in order. */
  logs: LogEntry[];
  error: string | null;
  /** Source the error was thrown from, when the engine says. */
  file: string | null;
  /** 1-based line within that source. */
  line: number | null;
}

/** One editor tab's worth of script. */
export interface JsSource {
  id: string;
  text: string;
}

/**
 * `new Function` wraps the body in two header lines plus our "use strict"
 * line, so engine-reported line numbers run three ahead of the document.
 */
const HEADER_LINES = 3;

/** Best-effort: dig the throwing line out of a V8 / SpiderMonkey / JSC stack. */
function errorLine(err: unknown): number | null {
  const stack = err instanceof Error ? err.stack ?? '' : '';
  const m = /(?:<anonymous>|> Function):(\d+):\d+/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - HEADER_LINES;
  return line >= 1 ? line : null;
}

/** Where each source starts in the joined script: 1-based first line and line count. */
interface Segment {
  id: string;
  start: number;
  lines: number;
}

/** Maps a line of the joined script back to the tab it came from. */
function locate(segments: Segment[], line: number | null): { file: string | null; line: number | null } {
  if (line == null) return { file: null, line: null };
  for (const s of segments) {
    if (line >= s.start && line < s.start + s.lines) return { file: s.id, line: line - s.start + 1 };
  }
  return { file: null, line: null };
}

const NO_SPAN = { from: -1, to: -1 };

/** A dotted note past two dots has no length table and no place on the stave. */
const MAX_DOTS = 2;

/**
 * The id a sounding event gets from its place in the score, which playback
 * uses to light up the engraved note. Given per position rather than per
 * object, one event reused in several bars lights each of them, and a note
 * that stays put across a re-run keeps its id, so a pass already under way
 * goes on highlighting the right notes.
 */
function spanId(voice: Voice, measure: number, index: number): number {
  return (voice === 'bass' ? 1 << 28 : 0) + measure * 4096 + Math.min(index, 4095);
}

function event(
  keys: string[],
  duration: string | number = 'q',
  opts?: { dots?: number },
  rest = false,
): NoteEvent {
  const raw = String(duration);
  const dur = durationCode(raw.replace(/\.+$/, '')) ?? null;
  if (!dur) throw new Error(`bad duration "${raw}" — expected 1 2 4 8 16 32 (or w h q)`);
  const dots = opts?.dots ?? (raw.match(/\.+$/)?.[0].length ?? 0);
  if (!Number.isInteger(dots) || dots < 0 || dots > MAX_DOTS) {
    throw new Error(`bad dots in "${raw}" — at most ${MAX_DOTS} dots`);
  }

  // Mirror the DSL parser: lowercase (playback's pitch parser demands it),
  // chord members sorted low-to-high (VexFlow stacks noteheads by order), and
  // accidentals recorded in attrs.acc — the renderer prints glyphs only from
  // there. A natural has no letter form, so it drops out of the key string
  // and survives as the 'n' modifier alone.
  const members = keys.map((k) => {
    const key = String(k).trim().toLowerCase();
    const p = parseKey(key);
    if (!p) throw new Error(`bad pitch "${k}" — expected e.g. 'c/4', 'eb/3', 'f#/5'`);
    return { key: p.acc === 'n' ? `${p.letter}/${p.octave}` : key, acc: p.acc };
  });
  members.sort((a, b) => diatonicOf(a.key) - diatonicOf(b.key));

  const acc = members.map((m) => m.acc);
  return {
    keys: members.map((m) => m.key),
    duration: dur,
    dots,
    rest,
    span: NO_SPAN,   // given its id by score(), from where it lands
    attrs: acc.some(Boolean) ? { acc } : {},
  };
}

function isEvent(x: unknown): x is NoteEvent {
  return typeof x === 'object' && x !== null && typeof (x as NoteEvent).duration === 'string'
    && Array.isArray((x as NoteEvent).keys);
}

/**
 * A staff may arrive as measures (NoteEvent[][]) or as one flat event list;
 * a flat list is auto-barred: events accumulate until the bar is full, then a
 * new measure opens. Notes are never split across the barline.
 */
function toMeasureRows(rows: unknown, voice: Voice, capacity: number): NoteEvent[][] {
  if (!Array.isArray(rows)) throw new Error(`${voice} must be an array`);
  if (rows.length === 0 || Array.isArray(rows[0])) return rows as NoteEvent[][];
  if (!rows.every(isEvent)) {
    throw new Error(`${voice} must contain events from note()/chord()/rest() or arrays of them`);
  }
  const measures: NoteEvent[][] = [[]];
  let used = 0;
  for (const e of rows as NoteEvent[]) {
    const u = unitsWithDots(e.duration, e.dots);
    if (used > 0 && used + u > capacity + 1e-9) {
      measures.push([]);
      used = 0;
    }
    measures[measures.length - 1].push(e);
    used += u;
  }
  return measures;
}

/** Rejects anything that is not an event, and fills the fields a hand-built one may lack. */
function checkEvent(x: unknown, voice: Voice, measure: number, index: number): NoteEvent {
  const where = `event ${index + 1} of measure ${measure + 1} of ${voice}`;
  if (!isEvent(x)) throw new Error(`${where} is not an event; build it with note(), chord() or rest()`);
  if (!x.keys.every((k) => typeof k === 'string')) throw new Error(`${where} has a pitch that is not a string`);
  if (!durationCode(x.duration)) throw new Error(`${where} has a bad duration "${x.duration}"`);
  const dots = typeof x.dots === 'number' && Number.isInteger(x.dots) && x.dots >= 0 ? Math.min(MAX_DOTS, x.dots) : 0;
  const attrs = x.attrs && typeof x.attrs === 'object' ? x.attrs : {};
  const rest = x.rest === true || x.keys.length === 0;
  const id = spanId(voice, measure, index);
  const span = rest ? NO_SPAN : { from: id, to: id };
  if (dots === x.dots && span === x.span && attrs === x.attrs && rest === x.rest) return x;
  // A copy: the script may hold this object and place it again elsewhere.
  return { ...x, dots, span, attrs, rest };
}

function buildMeasures(
  rows: NoteEvent[][],
  voice: Voice,
  keySig: string | null,
  timeSig: string,
  count: number,
): Measure[] {
  const capacity = barCapacity(timeSig);
  const out: Measure[] = [];
  for (let i = 0; i < count; i++) {
    const raw: unknown = rows[i] ?? [event([], 'w', undefined, true)];
    if (!Array.isArray(raw)) throw new Error(`measure ${i + 1} of ${voice} is not an array`);
    // A measure written by hand (not through note()/chord()/rest()) must
    // still be sound before it is drawn or played: the engraver and the
    // player read every field, and an error there would land outside the
    // script's own error handling, after the score was taken as good.
    const events = raw.map((e, j) => checkEvent(e, voice, i, j));
    const units = events.reduce((s, e) => s + unitsWithDots(e.duration, e.dots), 0);
    out.push({
      index: i, voice, keySig, timeSig, events,
      barType: i === count - 1 ? 'end' : 'single',
      beginRepeat: false, units, capacity,
    });
  }
  return out;
}

export const jsApi: JsApi = {
  note: (key, duration, opts) => event([key], duration, opts),
  chord: (keys, duration, opts) => event([...keys], duration, opts),
  rest: (duration, opts) => event([], duration, opts, true),
  score(meta, staves) {
    const keySig = meta.key ? resolveKeySignature(meta.key) : null;
    if (meta.key && !keySig) throw new Error(`unknown key "${meta.key}"`);
    const tempo = meta.tempo == null ? null : Number(meta.tempo);
    if (tempo !== null && !(Number.isFinite(tempo) && tempo > 0)) throw new Error(`bad tempo ${String(meta.tempo)} — expected beats per minute`);
    const title = meta.title == null ? null : String(meta.title);
    const timeSig = meta.time ?? '4/4';
    if (!isValidTimeSignature(timeSig)) throw new Error(`bad time signature "${timeSig}"`);

    const capacity = barCapacity(timeSig);
    const treble = toMeasureRows(staves.treble ?? [], 'treble', capacity);
    const bass = toMeasureRows(staves.bass ?? [], 'bass', capacity);
    const count = Math.max(treble.length, bass.length);
    const clefMode: ClefMode =
      meta.clef ?? (bass.length && !treble.length ? 'bass' : treble.length && !bass.length ? 'treble' : 'grand');

    return {
      meta: {
        title,
        tempo: tempo === null ? null : Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo)),
        clefMode,
        keySig,
        timeSig,
        barsPerLine: null,
        minBarWidth: null,
      },
      treble: buildMeasures(treble, 'treble', keySig, timeSig, count),
      bass: buildMeasures(bass, 'bass', keySig, timeSig, count),
      measureCount: count,
    };
  },
  VF,
};

/**
 * Evaluate the tabs as one script, in the order given, then run its `main(api)`
 * and validate the returned Score. All tabs share one scope, so a helper
 * defined in one tab is visible everywhere; top-level code runs top to bottom,
 * which is why the caller passes helper tabs ahead of the main one.
 */
export function runJs(sources: JsSource[]): JsRunResult {
  const segments: Segment[] = [];
  let start = 1;
  for (const source of sources) {
    const lines = source.text.split('\n').length;
    segments.push({ id: source.id, start, lines });
    start += lines;
  }
  const body = sources.map((s) => s.text).join('\n');
  const logs: LogEntry[] = [];
  const fail = (error: string, line: number | null = null): JsRunResult => ({
    score: null, logs, error, ...locate(segments, line),
  });

  // The script runs synchronously, so console can be swapped out for its
  // duration: what it prints lands in `logs` (and still reaches devtools).
  const original = new Map(LOG_LEVELS.map((level) => [level, console[level]] as const));
  for (const level of LOG_LEVELS) {
    console[level] = (...args: unknown[]): void => {
      if (logs.length < MAX_LOGS) logs.push({ level, text: args.map(describe).join(' ') });
      original.get(level)!.apply(console, args);
    };
  }

  try {
    const factory = new Function(
      'api',
      `"use strict";\n${body}\n;return typeof main === 'function' ? main : undefined;`,
    );
    const main = factory(jsApi) as ((api: JsApi) => unknown) | undefined;
    if (!main) return fail('define a function main(api) that returns the score');

    const result = main(jsApi) as Score | undefined;
    if (!result || !Array.isArray(result.treble) || !Array.isArray(result.bass)
        || typeof result.measureCount !== 'number' || !result.meta) {
      return fail('main() must return a score; build one with api.score(...)');
    }
    return { score: result, logs, error: null, file: null, line: null };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), errorLine(err));
  } finally {
    for (const [level, fn] of original) console[level] = fn;
  }
}

/** A console argument as text: strings as they are, everything else as JSON where it can be. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  try {
    const json = JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v), 1);
    if (json !== undefined) return json.length > 2000 ? `${json.slice(0, 2000)}…` : json.replace(/\n\s*/g, ' ');
  } catch {
    // Cyclic: fall through to String().
  }
  return String(value);
}

export const JS_SEED = `// Define main(api) and return a score.
// api gives you note/chord/rest/score builders, plus api.VF — the whole
// VexFlow module — if you want to experiment directly.

function main({ score, note, chord, rest }) {
  const melody = [
    [note('c/4', 'q'), note('d/4', '8'), note('e/4', '8'), note('f/4', 'q'), rest('q')],
    [chord(['c/4', 'e/4', 'g/4'], 'h'), note('g/4', 'h')],
  ];

  // Generated accompaniment — it's just JavaScript.
  const bassline = melody.map(() =>
    ['c/3', 'g/3', 'c/4', 'g/3'].map((k) => note(k, 'q')),
  );

  return score(
    { title: 'JS Sketch', key: 'C', time: '4/4', tempo: 100 },
    { treble: melody, bass: bassline },
  );
}
`;
