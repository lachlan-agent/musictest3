export type Voice = 'treble' | 'bass';

export type ClefMode = 'grand' | 'treble' | 'bass';

export type BarType = 'single' | 'double' | 'end' | 'repeatBegin' | 'repeatEnd';

/** Half-open range into some source; `from` doubles as the event's id. */
export interface Span {
  from: number;
  to: number;
}

/** One sounding (or silent) event on one staff. */
export interface NoteEvent {
  /** VexFlow key strings, low to high. Empty for a rest. */
  keys: string[];
  duration: string;
  dots: number;
  rest: boolean;
  /**
   * Identity for playback highlighting: the renderer tags the note's SVG group
   * with `span.from`, and the player reports it at each onset. -1 = untracked.
   */
  span: Span;
  attrs: Record<string, unknown>;
}

export interface Measure {
  /** 0-based position in the piece. Treble and bass measures share the index. */
  index: number;
  voice: Voice;
  keySig: string | null;
  timeSig: string;
  events: NoteEvent[];
  /** Barline that closes this measure. */
  barType: BarType;
  /** `|:` seen before this measure — it opens a repeated section. */
  beginRepeat: boolean;
  /** Total written length in whole-note units. */
  units: number;
  /** Bar capacity implied by `timeSig`, in whole-note units. */
  capacity: number;
}

export interface ScoreMeta {
  title: string | null;
  tempo: number | null;
  clefMode: ClefMode;
  keySig: string | null;
  timeSig: string;
  /** Fixed measures per system; null = auto-fit. */
  barsPerLine: number | null;
  /** Floor on a measure's engraved width. */
  minBarWidth: number | null;
}

export interface Score {
  meta: ScoreMeta;
  /** Parallel arrays, padded so both have `measureCount` entries. */
  treble: Measure[];
  bass: Measure[];
  measureCount: number;
}

export const EMPTY_SCORE: Score = {
  meta: {
    title: null, tempo: null, clefMode: 'grand', keySig: null, timeSig: '4/4',
    barsPerLine: null, minBarWidth: null,
  },
  treble: [],
  bass: [],
  measureCount: 0,
};
