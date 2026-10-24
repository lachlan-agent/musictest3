/**
 * Editor, score and playback preferences.
 *
 * These live in `localStorage`: they are a few hundred bytes, and reading them
 * synchronously before first paint is what keeps the app from flashing the
 * wrong theme on load (see the inline script in index.html).
 */

import { DEFAULT_PLAYBACK, INSTRUMENTS } from './audio/player.js';
import { DEFAULT_DARK, DEFAULT_LIGHT, THEMES } from './theme.js';
import { copyRect, isRect, type FloatRect, type WindowSpec as SharedWindowSpec } from './shared/windows.js';

export type Leading = 'tight' | 'normal' | 'loose';
export type Keymap = 'default' | 'vim';
/** How the engraved page is coloured. */
export type ScorePaper = 'paper' | 'themed' | 'dimmed';
/** When the script re-runs after an edit. */
export type RunMode = 'live' | 'pause' | 'manual';

export { copyRect, isRect, type FloatRect };

/** What a window shows. */
export type WindowKind = 'score' | 'console' | 'reference';
export const WINDOW_KINDS: Array<[WindowKind, string]> = [
  ['score', 'Score'],
  ['console', 'Console'],
  ['reference', 'Reference'],
];
export const isWindowKind = (v: unknown): v is WindowKind => WINDOW_KINDS.some(([k]) => k === v);

export type WindowSpec = SharedWindowSpec<WindowKind>;

/** The floating editor's background: see applyEditorGlass in main.ts. */
export type GlassMode = 'solid' | 'tint' | 'clear' | 'glass';
export const GLASS_MODES: Array<[GlassMode, string]> = [
  ['solid', 'Solid'],
  ['tint', 'Tint'],
  ['clear', 'Clear'],
  ['glass', 'Glass'],
];
export const isGlassMode = (v: unknown): v is GlassMode => GLASS_MODES.some(([m]) => m === v);
export const MAX_FROST = 40;

export type PdfPage = 'a4' | 'letter';

export const DOCKED_SCORE = (): WindowSpec => ({ kind: 'score', docked: true, rect: { x: 0, y: 0, w: 0, h: 0 } });

export interface Settings {
  /** A theme id, or `"system"` to follow the operating system. */
  theme: string;
  /** Used when `theme` is `"system"`. */
  lightTheme: string;
  darkTheme: string;

  fontFamily: string;
  fontSize: number;
  leading: Leading;

  keymap: Keymap;
  lineNumbers: boolean;
  wrap: boolean;
  activeLine: boolean;
  closeBrackets: boolean;
  autocomplete: boolean;
  folding: boolean;
  tabSize: 2 | 4;
  runMode: RunMode;

  scorePaper: ScorePaper;
  scoreZoom: number;
  showHeading: boolean;
  /** Measures per system when the score doesn't fix it; 0 = fit to width. */
  barsPerLine: number;
  /** Fraction of the window the editor takes, side by side or stacked. */
  split: number;
  /** Editor on the right, windows on the left. */
  swapped: boolean;
  /** The editor pane undocked into a floating window, and where it sits. */
  editorFloating: boolean;
  editorRect: FloatRect | null;
  /** The windows: docked ones stack beside the editor, the rest float. */
  windows: WindowSpec[];
  /** The undocked editor's background, its opacity (tint and glass) and blur (glass). */
  editorGlass: GlassMode;
  glassTint: number;
  glassFrost: number;
  /** Page size for the PDF export. */
  pdfPage: PdfPage;
  /** The zoom strip in a score window's bar, unfolded. */
  scoreTools: boolean;

  instrument: string;
  volume: number;
  speed: number;
  reverb: number;
  loop: boolean;
  humanize: boolean;
  highlightNotes: boolean;
  followPlayback: boolean;
}

export const FONT_STACKS: Array<{ id: string; name: string; note: string; stack: string; google?: string }> = [
  {
    id: 'system',
    name: 'System monospace',
    note: 'Whatever your OS uses for code',
    stack: 'ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, monospace',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    note: 'Fetched from Google Fonts once, then cached',
    stack: '"JetBrains Mono", ui-monospace, monospace',
    google: 'JetBrains+Mono:wght@400;600',
  },
  {
    id: 'fira',
    name: 'Fira Code',
    note: 'Fetched from Google Fonts — with ligatures',
    stack: '"Fira Code", ui-monospace, monospace',
    google: 'Fira+Code:wght@400;600',
  },
  {
    id: 'plex',
    name: 'IBM Plex Mono',
    note: 'Fetched from Google Fonts',
    stack: '"IBM Plex Mono", ui-monospace, monospace',
    google: 'IBM+Plex+Mono:wght@400;600',
  },
  {
    id: 'source',
    name: 'Source Code Pro',
    note: 'Fetched from Google Fonts',
    stack: '"Source Code Pro", ui-monospace, monospace',
    google: 'Source+Code+Pro:wght@400;600',
  },
  {
    id: 'space',
    name: 'Space Mono',
    note: 'Fetched from Google Fonts — quirky retro',
    stack: '"Space Mono", ui-monospace, monospace',
    google: 'Space+Mono:wght@400;700',
  },
  {
    id: 'iosevka',
    name: 'Iosevka',
    note: 'If installed — narrow, fits more',
    stack: 'Iosevka, "Iosevka Term", ui-monospace, monospace',
  },
];

export const LEADING_VALUES: Record<Leading, number> = {
  tight: 1.35,
  normal: 1.6,
  loose: 1.85,
};

export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 24;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 2;

/** Whether the main pointer is a finger, which usually means no hardware keyboard. */
export function isTouchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  lightTheme: DEFAULT_LIGHT,
  darkTheme: DEFAULT_DARK,

  fontFamily: 'system',
  fontSize: 13,
  leading: 'normal',

  // Modal editing through a soft keyboard with no Escape key is a trap.
  keymap: isTouchScreen() ? 'default' : 'vim',
  lineNumbers: true,
  wrap: true,
  activeLine: true,
  closeBrackets: true,
  autocomplete: true,
  folding: false,
  tabSize: 2,
  runMode: 'live',

  scorePaper: 'paper',
  scoreZoom: 1,
  showHeading: true,
  barsPerLine: 0,
  split: 0.44,
  swapped: false,
  editorFloating: false,
  editorRect: null,
  windows: [DOCKED_SCORE()],
  editorGlass: 'solid',
  glassTint: 0.6,
  glassFrost: 8,
  pdfPage: 'a4',
  scoreTools: false,

  instrument: DEFAULT_PLAYBACK.instrument,
  volume: DEFAULT_PLAYBACK.volume,
  speed: DEFAULT_PLAYBACK.speed,
  reverb: DEFAULT_PLAYBACK.reverb,
  loop: DEFAULT_PLAYBACK.loop,
  humanize: DEFAULT_PLAYBACK.humanize,
  highlightNotes: true,
  followPlayback: true,
};

export const SETTINGS_KEY = 'musictest3.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return sanitize({ ...DEFAULT_SETTINGS });
    const stored = JSON.parse(raw) as Partial<Settings>;
    // Merged over the defaults so that settings added in a later version
    // don't leave an older stored object missing keys.
    return sanitize({ ...DEFAULT_SETTINGS, ...stored });
  } catch {
    return sanitize({ ...DEFAULT_SETTINGS });
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota. Preferences are a convenience, so
    // losing them must not interrupt editing.
  }
}

export function sanitize(settings: Settings): Settings {
  const font = FONT_STACKS.some((f) => f.id === settings.fontFamily);
  const instrument = INSTRUMENTS.some((i) => i.id === settings.instrument);
  const theme = (id: unknown, kind?: 'light' | 'dark'): boolean =>
    THEMES.some((t) => t.id === id && (!kind || t.kind === kind));
  return {
    ...settings,
    theme: settings.theme === 'system' || theme(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    lightTheme: theme(settings.lightTheme, 'light') ? settings.lightTheme : DEFAULT_LIGHT,
    darkTheme: theme(settings.darkTheme, 'dark') ? settings.darkTheme : DEFAULT_DARK,
    fontFamily: font ? settings.fontFamily : DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(Math.round(settings.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
    leading: settings.leading in LEADING_VALUES ? settings.leading : DEFAULT_SETTINGS.leading,
    keymap: settings.keymap === 'vim' || settings.keymap === 'default' ? settings.keymap : DEFAULT_SETTINGS.keymap,
    lineNumbers: bool(settings.lineNumbers, DEFAULT_SETTINGS.lineNumbers),
    wrap: bool(settings.wrap, DEFAULT_SETTINGS.wrap),
    activeLine: bool(settings.activeLine, DEFAULT_SETTINGS.activeLine),
    closeBrackets: bool(settings.closeBrackets, DEFAULT_SETTINGS.closeBrackets),
    autocomplete: bool(settings.autocomplete, DEFAULT_SETTINGS.autocomplete),
    folding: bool(settings.folding, DEFAULT_SETTINGS.folding),
    tabSize: settings.tabSize === 4 ? 4 : 2,
    runMode: RUN_MODES.includes(settings.runMode) ? settings.runMode : DEFAULT_SETTINGS.runMode,
    scorePaper: SCORE_PAPERS.includes(settings.scorePaper) ? settings.scorePaper : DEFAULT_SETTINGS.scorePaper,
    showHeading: bool(settings.showHeading, DEFAULT_SETTINGS.showHeading),
    scoreZoom: round(clamp(settings.scoreZoom, MIN_ZOOM, MAX_ZOOM), 2),
    barsPerLine: clamp(Math.round(settings.barsPerLine), 0, 12),
    split: clamp(settings.split, 0.15, 0.85),
    swapped: settings.swapped === true,
    editorFloating: settings.editorFloating === true,
    editorRect: isRect(settings.editorRect) ? copyRect(settings.editorRect) : null,
    windows: sanitizeWindows(settings.windows),
    editorGlass: isGlassMode(settings.editorGlass) ? settings.editorGlass : 'solid',
    glassTint: round(clamp(settings.glassTint, 0, 1), 2),
    glassFrost: clamp(Math.round(settings.glassFrost), 0, MAX_FROST),
    pdfPage: settings.pdfPage === 'letter' ? 'letter' : 'a4',
    scoreTools: settings.scoreTools === true,
    instrument: instrument ? settings.instrument : DEFAULT_SETTINGS.instrument,
    volume: clamp(settings.volume, 0, 1),
    speed: round(clamp(settings.speed, MIN_SPEED, MAX_SPEED), 2),
    reverb: clamp(settings.reverb, 0, 1),
    loop: bool(settings.loop, DEFAULT_SETTINGS.loop),
    humanize: bool(settings.humanize, DEFAULT_SETTINGS.humanize),
    highlightNotes: bool(settings.highlightNotes, DEFAULT_SETTINGS.highlightNotes),
    followPlayback: bool(settings.followPlayback, DEFAULT_SETTINGS.followPlayback),
  };
}

const RUN_MODES: RunMode[] = ['live', 'pause', 'manual'];
const SCORE_PAPERS: ScorePaper[] = ['paper', 'themed', 'dimmed'];

/** Storage may hold anything; only a real boolean counts. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The layout fields alone, back to how a fresh install looks. */
export const DEFAULT_LAYOUT: Pick<Settings, 'split' | 'swapped' | 'editorFloating' | 'editorRect' | 'windows'> = {
  split: DEFAULT_SETTINGS.split,
  swapped: false,
  editorFloating: false,
  editorRect: null,
  windows: [DOCKED_SCORE()],
};


/** Whatever came out of storage, coerced into valid window specs (possibly none). */
function sanitizeWindows(raw: unknown): WindowSpec[] {
  if (!Array.isArray(raw)) return [DOCKED_SCORE()];
  const out: WindowSpec[] = [];
  for (const w of raw as Array<Partial<WindowSpec> | null>) {
    if (!w || !isWindowKind(w.kind)) continue;
    out.push({ kind: w.kind, docked: w.docked === true, rect: isRect(w.rect) ? copyRect(w.rect) : { x: 0, y: 0, w: 0, h: 0 } });
  }
  return out;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function fontById(id: string): (typeof FONT_STACKS)[number] {
  return FONT_STACKS.find((font) => font.id === id) ?? FONT_STACKS[0]!;
}

/** Pushes the typographic settings onto the document as custom properties. */
export function applyTypography(settings: Settings): void {
  const font = fontById(settings.fontFamily);
  if (font.google) loadGoogleFont(font.google);
  const root = document.documentElement.style;
  root.setProperty('--editor-font', font.stack);
  root.setProperty('--editor-size', `${settings.fontSize}px`);
  root.setProperty('--editor-leading', String(LEADING_VALUES[settings.leading]));
}

const requested = new Set<string>();

/** Adds the stylesheet for a web font the first time it is picked. */
function loadGoogleFont(family: string): void {
  if (requested.has(family)) return;
  requested.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.append(link);
}
