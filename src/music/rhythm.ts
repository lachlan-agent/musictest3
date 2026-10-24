// Rhythm math. All lengths are in whole-note units: w = 1, q = 0.25.
// A bar's capacity is num/den of its time signature (4/4 -> 1).
// Ported from musicTest/src/rhythm.ts — pure, no DOM, no VexFlow.

/** VexFlow duration codes, longest first (fillRests depends on the order). */
export const DURATIONS = ['w', 'h', 'q', '8', '16', '32'] as const;

export const DOT_FACTOR = [1, 1.5, 1.75];

const DUR_UNITS: Record<string, number> = {
  w: 1, h: 1 / 2, q: 1 / 4, '8': 1 / 8, '16': 1 / 16, '32': 1 / 32,
};

/** DSL duration spellings ("4", "8.", "h") -> VexFlow duration code. */
const DUR_ALIAS: Record<string, string> = {
  '1': 'w', '2': 'h', '4': 'q', '8': '8', '16': '16', '32': '32',
  w: 'w', h: 'h', q: 'q',
};

export const EPS = 1e-9;

/** Translate a DSL duration token to a VexFlow code, or null if unknown. */
export function durationCode(raw: string): string | null {
  return DUR_ALIAS[raw] ?? null;
}

export function unitsOf(dur: string): number {
  return DUR_UNITS[dur] ?? 0;
}

export function unitsWithDots(dur: string, dots: number): number {
  const f = DOT_FACTOR[Math.max(0, Math.min(2, dots | 0))] ?? 1;
  return unitsOf(dur) * f;
}

/** Bar length in whole-note units for a time signature string. */
export function barCapacity(timeSignature: string | null): number {
  const ts = (timeSignature ?? '4/4').trim();
  if (ts === 'C') return 1;      // common time = 4/4
  if (ts === 'C|') return 0.5;   // cut time = 2/2
  const [n, d] = ts.split('/').map(Number);
  return n > 0 && d > 0 ? n / d : 1;
}

/** `{ numBeats, beatValue }` for a VexFlow Voice. */
export function voiceTime(timeSignature: string): { numBeats: number; beatValue: number } {
  const ts = timeSignature.trim();
  if (ts === 'C') return { numBeats: 4, beatValue: 4 };
  if (ts === 'C|') return { numBeats: 2, beatValue: 2 };
  const [n, d] = ts.split('/').map(Number);
  return n > 0 && d > 0 ? { numBeats: n, beatValue: d } : { numBeats: 4, beatValue: 4 };
}

export function isValidTimeSignature(ts: string): boolean {
  if (ts === 'C' || ts === 'C|') return true;
  const m = /^(\d+)\/(\d+)$/.exec(ts);
  if (!m) return false;
  const n = +m[1];
  const d = +m[2];
  return n > 0 && d > 0 && DUR_ALIAS[String(d)] !== undefined;
}

/** Greedy decomposition of a gap into rest durations, largest first. */
export function fillRests(gap: number): string[] {
  const out: string[] = [];
  let rem = gap;
  for (const dur of DURATIONS) {
    const val = unitsOf(dur);
    while (rem + EPS >= val) {
      out.push(dur);
      rem -= val;
    }
  }
  return out;
}
