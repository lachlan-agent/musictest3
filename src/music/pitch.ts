// Pitch math: key strings ("c#/4") <-> diatonic indices.
// Diatonic index = octave * 7 + letter step (c=0 ... b=6); accidentals ride along.
// Ported from musicTest/src/pitch.ts — pure, no DOM, no VexFlow.

import type { NoteEvent } from '../model/types.js';

export interface ParsedKey {
  letter: string;
  acc: string;
  octave: number;
}

const KEY_RE = /^([a-g])(##|bb|#|b|n)?\/(-?\d+)$/;
const LETTERS = 'cdefgab';
const ACC_GLYPH: Record<string, string> = {
  '': '', '#': '♯', b: '♭', n: '♮', '##': '𝄪', bb: '𝄫',
};

export function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  return m ? { letter: m[1], acc: m[2] || '', octave: +m[3] } : null;
}

export function diatonicOf(key: string): number {
  const p = parseKey(key);
  if (!p) return 0;
  return p.octave * 7 + LETTERS.indexOf(p.letter);
}

export function keyFrom(diatonic: number, acc = ''): string {
  const octave = Math.floor(diatonic / 7);
  const letter = LETTERS[((diatonic % 7) + 7) % 7];
  return `${letter}${acc}/${octave}`;
}

export function prettyKey(key: string): string {
  const p = parseKey(key);
  if (!p) return key;
  return p.letter.toUpperCase() + ACC_GLYPH[p.acc] + p.octave;
}

/** Sort a chord's key strings low to high, so VexFlow stacks noteheads right. */
export function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => diatonicOf(a) - diatonicOf(b));
}

// ---- concert pitch ----------------------------------------------------

const SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACC_SEMI: Record<string, number> = { '': 0, n: 0, '#': 1, b: -1, '##': 2, bb: -2 };

/** MIDI note number for a key string ("c/4" = middle C = 60). */
export function midiOf(key: string): number | null {
  const p = parseKey(key);
  if (!p) return null;
  return (p.octave + 1) * 12 + SEMITONE[p.letter] + (ACC_SEMI[p.acc] ?? 0);
}

/** Concert frequency (Hz, A4 = 440) for a key string. */
export function freqOf(key: string): number | null {
  const m = midiOf(key);
  return m == null ? null : 440 * Math.pow(2, (m - 69) / 12);
}

// ---- key signatures ---------------------------------------------------

const SHARP_ORDER = 'fcgdaeb';
const FLAT_ORDER = 'beadgcf';

/** How many sharps (positive) or flats (negative) each major key signature has. */
export const KEY_SIG_COUNT: Record<string, number> = {
  C: 0,
  G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

/** Minor keys, mapped to the major signature they share. */
export const RELATIVE_MAJOR: Record<string, string> = {
  A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#',
  D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb', Ab: 'Cb',
};

/** Canonical spelling for a user-typed tonic: "eb" -> "Eb", "f#" -> "F#". */
export function normalizeTonic(raw: string): string | null {
  const m = /^([a-gA-G])([#b]?)$/.exec(raw);
  if (!m) return null;
  return m[1].toUpperCase() + m[2];
}

/**
 * Resolve a DSL key name ("Eb", "am", "f#m") to a VexFlow key-signature name,
 * or null if it isn't a key this app knows.
 */
export function resolveKeySignature(raw: string): string | null {
  const minor = /m(in|inor)?$/i.test(raw) && !/^[a-gA-G][#b]?$/.test(raw);
  const stem = minor ? raw.replace(/m(in|inor)?$/i, '') : raw;
  const tonic = normalizeTonic(stem);
  if (!tonic) return null;
  if (minor) return RELATIVE_MAJOR[tonic] ?? null;
  return tonic in KEY_SIG_COUNT ? tonic : null;
}

/**
 * Which letters a key signature implicitly sharps/flats, e.g. `{ f: '#', c: '#' }`
 * for D major. Consumers use this to decide which accidentals need printing.
 */
export function keySignatureAccidentals(keySig: string | null): Record<string, '#' | 'b'> {
  const n = keySig ? (KEY_SIG_COUNT[keySig] ?? 0) : 0;
  const out: Record<string, '#' | 'b'> = {};
  if (n > 0) for (let i = 0; i < n; i++) out[SHARP_ORDER[i]] = '#';
  else if (n < 0) for (let i = 0; i < -n; i++) out[FLAT_ORDER[i]] = 'b';
  return out;
}

export interface BarAccidentals {
  /** What each chord member sounds with: '', '#', 'b', '##' or 'bb'. */
  sounding: string[];
  /** The glyph printed before each member ('n' for a natural), '' for none. */
  printed: string[];
}

/**
 * Accidental state through one bar, the way a reader applies it: an
 * accidental holds for its letter and octave until the barline; a bare
 * letter takes the one carried, else the key signature's. What gets printed
 * is whatever changes that state, so a sharp the signature already has is
 * not printed again and a natural that cancels one is. Engraving and
 * playback both read this, which is what keeps them in agreement.
 *
 * A written accidental is read from the key string ("f#/4"); a natural has
 * no key form and arrives in attrs.acc alone.
 */
export function barAccidentals(events: NoteEvent[], keySig: string | null): BarAccidentals[] {
  const sig = keySignatureAccidentals(keySig);
  const state = new Map<string, string>();
  return events.map((event) => {
    const accs = Array.isArray(event.attrs.acc) ? (event.attrs.acc as unknown[]) : [];
    const sounding: string[] = [];
    const printed: string[] = [];
    event.keys.forEach((key, i) => {
      const p = parseKey(key);
      if (!p) {
        sounding.push('');
        printed.push('');
        return;
      }
      const slot = `${p.letter}/${p.octave}`;
      const current = state.get(slot) ?? sig[p.letter] ?? '';
      const fromAttrs = accs[i];
      const written = p.acc || (typeof fromAttrs === 'string' && fromAttrs in ACC_SEMI ? fromAttrs : '');
      if (!written) {
        sounding.push(current);
        printed.push('');
        return;
      }
      const next = written === 'n' ? '' : written;
      sounding.push(next);
      printed.push(next === current ? '' : written);
      state.set(slot, next);
    });
    return { sounding, printed };
  });
}
