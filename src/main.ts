import './styles.css';

import { Player } from './audio/player.js';
import { EXAMPLES } from './js/examples.js';
import { runJs, type LogEntry } from './js/runtime.js';
import { makePdf, PAGE_SIZES, pdfPageOf, type PageSize, type PdfPage } from './export/pdf.js';
import { loadLibrary, newId, persistLibrary, type LibraryEntry, type SavedDocument, type SavedLayout } from './library.js';
import { ScoresPanel } from './scores-ui.js';
import { EMPTY_SCORE, type Score } from './model/types.js';
import {
  applyTypography,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_ZOOM,
  MIN_ZOOM,
  sanitize,
  saveSettings,
  WINDOW_KINDS,
  type FloatRect,
  type GlassMode,
  type Settings,
  type WindowKind,
} from './settings.js';
import { SettingsPanel } from './settings-ui.js';
import { applyTheme, onSystemSchemeChange, resolveTheme, themeById } from './theme.js';
import { createEditor, type EditorConfig } from './view/editor.js';
import { topLevelSymbols } from './view/jsComplete.js';
import { REFERENCE_HTML } from './view/reference.js';
import { formatDocument } from './view/format.js';
import { renderScore, renderScorePages } from './view/stave.js';
import { TabBar } from './view/tabs.js';
import { addResizeHandles, clearRect, Floater, WindowManager, writeRect, type FloatHost, type Win } from './view/windows.js';
import {
  bundle,
  cleanName,
  evaluationOrder,
  freshWorkspace,
  HELPER_SEED,
  loadWorkspace,
  MAIN_TAB,
  newTabId,
  saveWorkspace,
  unbundle,
  UNTITLED,
  workspaceFrom,
  type Tab,
  type Workspace,
} from './workspace.js';

const el = {
  editor: must<HTMLElement>('#editor'),
  tabs: must<HTMLElement>('#tabs'),
  main: must<HTMLElement>('#main'),
  dock: must<HTMLElement>('#dock'),
  editorPane: must<HTMLElement>('#editor-pane'),
  editorBar: must<HTMLElement>('#editor-bar'),
  editorDock: must<HTMLButtonElement>('#editor-dock'),
  editorUndock: must<HTMLButtonElement>('#editor-undock'),
  toolbar: must<HTMLElement>('.toolbar'),
  statusbar: must<HTMLElement>('.statusbar'),
  newWindow: must<HTMLButtonElement>('#new-window'),
  gutter: must<HTMLElement>('#gutter'),
  status: must<HTMLElement>('#status'),
  statusScore: must<HTMLElement>('#status-score'),
  statusPosition: must<HTMLElement>('#status-position'),
  play: must<HTMLButtonElement>('#play-toggle'),
  run: must<HTMLButtonElement>('#run'),
  settingsToggle: must<HTMLButtonElement>('#settings-toggle'),
  panel: must<HTMLElement>('#settings-panel'),
  scoresToggle: must<HTMLButtonElement>('#scores-toggle'),
  scoresName: must<HTMLElement>('#scores-name'),
  scoresPanel: must<HTMLElement>('#scores-panel'),
};

let settings: Settings = loadSettings();
let workspace: Workspace = loadWorkspace();
let library: LibraryEntry[] = loadLibrary();
// A library entry no longer there (cleared in another tab, say) is just unsaved.
if (workspace.libId && !library.some((e) => e.id === workspace.libId)) workspace.libId = null;
/** Where the last run's error points, if anywhere; drawn on whichever tab it names. */
let fault: { tab: string; line: number; message: string } | null = null;
/** The last run's error, and whether an older score is still on show. */
let failure: { message: string; stale: boolean } | null = null;
/** Last score that ran cleanly. Script errors never blank the page. */
let lastGood: Score = EMPTY_SCORE;
/** What the last run printed, for the Console windows. */
let lastLogs: LogEntry[] = [];

const player = new Player();

const editor = createEditor({
  parent: el.editor,
  id: workspace.active,
  doc: activeTab().text,
  config: editorConfig(),
  symbols: () =>
    workspace.tabs
      .filter((t) => t.id !== editor.current)
      .flatMap((t) => topLevelSymbols(t.text, t.name)),
  onChange: (text) => {
    activeTab().text = text;
    saveWorkspace(workspace);
    renderScoresButton();
    // A loop keeps going and picks up the new score next pass; one-shot
    // playback stops, since what it plays no longer matches the text.
    if (!(player.playing && settings.loop)) player.stop();
    if (settings.runMode === 'manual') {
      setStatus('Edited. Ctrl/⌘ + Enter to run', 'working');
      return;
    }
    schedule(settings.runMode === 'pause' ? 700 : 150);
  },
  onSelectionChange: (line, column) => {
    el.statusPosition.textContent = `Ln ${line}, Col ${column}`;
  },
  keys: [
    { key: 'Mod-Enter', run: () => (run(), true) },
    { key: 'Shift-Mod-Enter', run: () => (togglePlay(), true) },
    { key: 'Mod-,', run: () => (panel.toggle(), true) },
    { key: 'Mod-s', run: () => (saveToLibrary(false), true) },
    { key: 'Shift-Mod-s', run: () => (saveToLibrary(true), true) },
    { key: 'Shift-Alt-f', run: () => (formatCode(), true) },
    { key: 'Alt-n', run: () => (addTab(), true) },
    { key: 'Alt-w', run: () => (openWindow(), true) },
    { key: 'Alt-[', run: () => (cycleTab(-1), true) },
    { key: 'Alt-]', run: () => (cycleTab(1), true) },
    ...Array.from({ length: 9 }, (_, i) => ({
      key: `Alt-${i + 1}`,
      run: () => {
        const tab = workspace.tabs[i];
        if (tab) selectTab(tab.id);
        return Boolean(tab);
      },
    })),
  ],
  onFormat: () => formatCode(),
});

const tabBar = new TabBar({
  container: el.tabs,
  select: selectTab,
  add: addTab,
  close: closeTab,
  rename(id, name) {
    const tab = workspace.tabs.find((t) => t.id === id);
    if (tab) tab.name = cleanName(workspace, name, id);
    saveWorkspace(workspace);
    renderTabs();
    editor.view.focus();
  },
});

const panel = new SettingsPanel({
  container: el.panel,
  get: () => settings,
  update: updateSettings,
  loadExample(id) {
    const example = EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    // Helper tabs of the same name are overwritten, others are left alone.
    for (const extra of example.tabs ?? []) {
      let tab = workspace.tabs.find((t) => t.name === extra.name);
      if (!tab) {
        tab = { id: newTabId(), name: extra.name, text: extra.source };
        workspace.tabs.push(tab);
      } else if (tab.id === editor.current) {
        editor.replace(extra.source);
      } else {
        // Parked state would otherwise resurrect the old text on switching.
        editor.drop(tab.id);
        tab.text = extra.source;
      }
    }
    selectTab(MAIN_TAB);
    editor.replace(example.source);
    saveWorkspace(workspace);
    renderTabs();
    // Manual mode would otherwise leave the old score up under the new text.
    run();
  },
  format: () => formatCode(),
  reset() {
    // The layout is arranged, not configured: a settings reset leaves it alone.
    settings = sanitize({ ...DEFAULT_SETTINGS, ...layoutOf(settings) });
    saveSettings(settings);
    applySettings();
    panel.render();
  },
  newWindow: (kind) => openWindow(kind),
  resetLayout() {
    updateSettings({ ...DEFAULT_LAYOUT, windows: DEFAULT_LAYOUT.windows.map((w) => ({ ...w, rect: { ...w.rect } })) }, false);
    applyEditorFloating(false);
    windows.load(settings.windows);
    panel.render();
  },
});
panel.onToggle = (open) => {
  el.settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) scores.close();
};

const scores = new ScoresPanel({
  container: el.scoresPanel,
  current: () => ({ name: workspace.name, libId: workspace.libId, dirty: documentDirty() }),
  library: () => library,
  rename(name) {
    workspace.name = name.trim().slice(0, 64) || UNTITLED;
    saveWorkspace(workspace);
    renderScoresButton();
  },
  save: saveToLibrary,
  fresh: newDocument,
  open(entry) {
    if (entry.id === workspace.libId && !documentDirty()) {
      scores.close();
      return;
    }
    if (!confirmDiscard()) return;
    openDocument(structuredClone(entry.doc), entry.name, entry.id);
    scores.close();
  },
  renameEntry(entry, name) {
    entry.name = name.trim().slice(0, 64) || entry.name;
    entry.updated = Date.now();
    if (entry.id === workspace.libId) workspace.name = entry.name;
    persistLibrary(library);
    saveWorkspace(workspace);
    scores.render();
    renderScoresButton();
  },
  deleteEntry(entry) {
    library = library.filter((e) => e !== entry);
    if (entry.id === workspace.libId) workspace.libId = null;   // the working copy lives on, unsaved
    persistLibrary(library);
    saveWorkspace(workspace);
    scores.render();
    renderScoresButton();
  },
  exportJs: download,
  importJs,
  exportPdf,
  pageSize: () => settings.pdfPage,
  setPageSize: (pdfPage) => updateSettings({ pdfPage }, false),
});
scores.onToggle = (open) => {
  el.scoresToggle.setAttribute('aria-expanded', String(open));
  if (open) panel.close();
};

// ---- settings ---------------------------------------------------------

function editorConfig(): EditorConfig {
  const theme = resolveTheme(settings.theme, settings.lightTheme, settings.darkTheme);
  return {
    keymap: settings.keymap,
    lineNumbers: settings.lineNumbers,
    wrap: settings.wrap,
    activeLine: settings.activeLine,
    closeBrackets: settings.closeBrackets,
    autocomplete: settings.autocomplete,
    folding: settings.folding,
    tabSize: settings.tabSize,
    dark: theme.kind === 'dark',
  };
}

function updateSettings(patch: Partial<Settings>, rerender = true): void {
  const previous = settings;
  settings = sanitize({ ...settings, ...patch });

  // Picking a theme also makes it the one "Match system" reaches for at that
  // time of day, so the automatic pair is whatever the user last chose.
  if (patch.theme && patch.theme !== 'system') {
    const chosen = themeById(patch.theme);
    if (chosen.kind === 'light') settings.lightTheme = chosen.id;
    else settings.darkTheme = chosen.id;
  }

  saveSettings(settings);
  applySettings(previous);
  if (rerender) panel.render();
}

/** Applies whatever changed, redrawing the score only when the engraving would differ. */
function applySettings(previous?: Settings): void {
  applyTheme(resolveTheme(settings.theme, settings.lightTheme, settings.darkTheme));
  applyTypography(settings);
  editor.configure(editorConfig());

  document.body.classList.toggle('paper-themed', settings.scorePaper === 'themed');
  document.body.classList.toggle('paper-dimmed', settings.scorePaper === 'dimmed');
  document.documentElement.style.setProperty('--score-zoom', String(settings.scoreZoom));
  syncScoreTools();
  el.run.hidden = settings.runMode !== 'manual';
  el.editorPane.style.flex = `0 0 ${(settings.split * 100).toFixed(2)}%`;
  el.main.classList.toggle('swapped', settings.swapped);
  applyEditorGlass(settings.editorGlass, settings.glassTint, settings.glassFrost);

  player.configure({
    instrument: settings.instrument,
    volume: settings.volume,
    speed: settings.speed,
    reverb: settings.reverb,
    loop: settings.loop,
    humanize: settings.humanize,
  });

  if (!settings.highlightNotes) clearPlayingHighlights();

  if (
    previous &&
    (previous.scoreZoom !== settings.scoreZoom ||
      previous.showHeading !== settings.showHeading ||
      previous.barsPerLine !== settings.barsPerLine)
  ) {
    draw(lastGood);
  }
  if (previous && previous.runMode === 'manual' && settings.runMode !== 'manual') run();
}

// ---- pipeline ---------------------------------------------------------

let timer = 0;

function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(run, delay);
}

/**
 * Set in localStorage for the duration of a run. The script runs on the main
 * thread, so an endless loop hangs the page, and since the workspace is saved
 * before each run a reload would run the same script and hang again. Finding
 * the flag still set at boot means the last run never returned: the script is
 * left unrun and run mode goes to Manual until the user has fixed it.
 */
const RUNNING_KEY = 'musictest3.running';

function run(): void {
  window.clearTimeout(timer);
  try { localStorage.setItem(RUNNING_KEY, '1'); } catch { /* storage unavailable: no guard */ }
  const result = runJs(evaluationOrder(workspace));
  try { localStorage.removeItem(RUNNING_KEY); } catch { /* ditto */ }

  let error = result.error;
  if (result.score) {
    // A score the engraver or the player cannot take is not a good one;
    // report it like a script error and keep the last score that worked.
    try {
      draw(result.score);
      player.update(result.score);
      lastGood = result.score;
    } catch (err) {
      error = `could not engrave the score: ${err instanceof Error ? err.message : String(err)}`;
      draw(lastGood);
    }
  } else {
    draw(lastGood);
  }
  lastLogs = result.logs;
  renderConsoles();

  fault = result.error && result.file && result.line
    ? { tab: result.file, line: result.line, message: result.error }
    : null;
  failure = error
    ? { message: error, stale: !result.score && lastGood.measureCount > 0 }
    : null;
  showFault();
  renderTabs();
}

/** Reports the last run in the status bar, and underlines the faulting line when its tab is on screen. */
function showFault(): void {
  if (failure) {
    // Say where when the error is in a tab other than the one on screen.
    const where = fault && fault.tab !== editor.current ? `${tabName(fault.tab)}, line ${fault.line}: ` : '';
    const message = `${where}${failure.message}`;
    setStatus(failure.stale ? `${message}. Showing last good score` : message, 'error');
  } else {
    setStatus('ok', 'ok');
  }
  const doc = editor.view.state.doc;
  if (!fault || fault.tab !== editor.current || fault.line > doc.lines) {
    editor.setDiagnostics([]);
    return;
  }
  const line = doc.line(fault.line);
  editor.setDiagnostics([{ from: line.from, to: line.to, severity: 'error', message: fault.message }]);
}

// ---- tabs -------------------------------------------------------------

function activeTab(): Tab {
  return workspace.tabs.find((t) => t.id === workspace.active)!;
}

function tabName(id: string): string {
  return workspace.tabs.find((t) => t.id === id)?.name ?? id;
}

function renderTabs(): void {
  tabBar.render(workspace, new Set(fault ? [fault.tab] : []));
}

function selectTab(id: string): void {
  const tab = workspace.tabs.find((t) => t.id === id);
  if (!tab) return;
  workspace.active = id;
  editor.open(id, tab.text);
  saveWorkspace(workspace);
  showFault();
  renderTabs();
  if (!el.tabs.querySelector('.tab-rename')) editor.view.focus();
}

function cycleTab(step: number): void {
  const i = workspace.tabs.findIndex((t) => t.id === workspace.active);
  const n = workspace.tabs.length;
  selectTab(workspace.tabs[(i + step + n) % n]!.id);
}

function addTab(): void {
  const tab = { id: newTabId(), name: cleanName(workspace, 'helpers'), text: HELPER_SEED };
  // New helpers go last, so they run after the ones already there.
  workspace.tabs.push(tab);
  selectTab(tab.id);
  editor.view.dispatch({ selection: { anchor: tab.text.length } });
  tabBar.rename(tab.id, workspace);
}

function closeTab(id: string): void {
  const at = workspace.tabs.findIndex((t) => t.id === id);
  const tab = workspace.tabs[at];
  if (!tab || id === MAIN_TAB) return;
  const text = id === editor.current ? editor.text() : tab.text;
  const empty = !text.trim() || text === HELPER_SEED;
  if (!empty && !window.confirm(`Close ${tab.name}? Its code is deleted.`)) return;
  if (id === workspace.active) selectTab(workspace.tabs[at - 1]!.id);
  workspace.tabs.splice(at, 1);
  editor.drop(id);
  // As for an edit: a loop picks up the new score, a one-shot play stops.
  if (!(player.playing && settings.loop)) player.stop();
  saveWorkspace(workspace);
  if (fault?.tab === id) fault = null;
  renderTabs();
  if (settings.runMode !== 'manual') run();
}

/** Engraves into every Score window; each lays its systems out for its own width. */
function draw(score: Score): void {
  for (const win of windows.of('score')) drawInto(win, score);
  describe(score);
}

function drawInto(win: Win, score: Score): void {
  const scroll = win.body.querySelector<HTMLElement>('.score-scroll');
  const page = win.body.querySelector<HTMLElement>('.score-page');
  if (!scroll || !page) return;
  // The page zooms with CSS, so lay the systems out for the width the zoomed
  // page actually has.
  const width = (scroll.clientWidth - 24) / settings.scoreZoom;
  renderScore(page, score, {
    width,
    ink: 'currentColor',
    heading: settings.showHeading,
    barsPerLine: settings.barsPerLine || null,
  });
  if (!score.measureCount) {
    const empty = document.createElement('p');
    empty.className = 'score-empty';
    empty.textContent = 'Nothing to engrave yet; return a score from main().';
    page.append(empty);
  }
}

/** Shows the last run's console output in every Console window. */
function renderConsoles(): void {
  for (const win of windows.of('console')) {
    const out = win.body.querySelector<HTMLElement>('.console');
    if (!out) continue;
    const stuck = out.scrollTop + out.clientHeight >= out.scrollHeight - 4;
    out.replaceChildren();
    if (!lastLogs.length) {
      const empty = document.createElement('div');
      empty.className = 'console-empty';
      empty.textContent = 'Nothing logged. console.log(…) in the script prints here on every run.';
      out.append(empty);
      continue;
    }
    for (const entry of lastLogs) {
      const line = document.createElement('div');
      line.className = 'console-line';
      line.dataset['level'] = entry.level;
      line.textContent = entry.text;
      out.append(line);
    }
    if (stuck) out.scrollTop = out.scrollHeight;
  }
}

function describe(score: Score): void {
  const n = score.measureCount;
  const bits = [];
  if (n) bits.push(`${n} bar${n > 1 ? 's' : ''}`);
  if (score.meta.keySig) bits.push(score.meta.keySig);
  if (n) bits.push(score.meta.timeSig);
  if (score.meta.tempo != null) bits.push(`♩ ${score.meta.tempo}`);
  el.statusScore.textContent = bits.join(' · ');
}

function setStatus(text: string, kind: 'ok' | 'error' | 'warning' | 'working'): void {
  el.status.dataset['kind'] = kind;
  el.status.textContent = text;
  el.status.title = text;
}

// ---- playback ---------------------------------------------------------

player.onStateChange = (playing) => {
  el.play.dataset['state'] = playing ? 'playing' : 'stopped';
  el.play.querySelector('.play-glyph')!.textContent = playing ? '■' : '▶';
  el.play.querySelector('.play-label')!.textContent = playing ? 'Stop' : 'Play';
  if (!playing) clearPlayingHighlights();
};

// Light up the engraved note while it sounds. The renderer tags each note's SVG
// group with its event id; treble and bass fire independently.
player.onNote = (id, durationMs) => {
  if (!settings.highlightNotes && !settings.followPlayback) return;
  const notes = document.querySelectorAll(`.score-page [data-from="${id}"]`);
  if (settings.highlightNotes) {
    for (const note of notes) {
      note.classList.add('playing');
      window.setTimeout(() => note.classList.remove('playing'), Math.max(150, durationMs));
    }
  }
  if (settings.followPlayback) for (const note of notes) followNote(note);
};

/** Scrolls a score window only when the sounding note leaves the middle of it. */
function followNote(note: Element): void {
  const scroll = note.closest<HTMLElement>('.score-scroll');
  if (!scroll) return;
  const pane = scroll.getBoundingClientRect();
  const box = note.getBoundingClientRect();
  const margin = pane.height * 0.2;
  if (box.top < pane.top + margin || box.bottom > pane.bottom - margin) {
    scroll.scrollBy({
      top: box.top - pane.top - pane.height / 3,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
}

function clearPlayingHighlights(): void {
  for (const note of document.querySelectorAll('.score-page .playing')) note.classList.remove('playing');
}

/** True while play() is waiting on samples; a second request then is ignored. */
let playStarting = false;

function togglePlay(): void {
  if (player.playing) {
    player.stop();
    return;
  }
  if (playStarting) return;
  playStarting = true;
  // First press of each instrument downloads its samples.
  el.play.disabled = true;
  el.play.dataset['state'] = 'loading';
  el.play.querySelector('.play-label')!.textContent = 'Loading…';
  player
    .play(lastGood)
    .catch(() => setStatus('Oops! Playback failed. Sound font samples unavailable?', 'error'))
    .finally(() => {
      playStarting = false;
      el.play.disabled = false;
      player.onStateChange?.(player.playing);
    });
}

// ---- chrome -----------------------------------------------------------

el.play.addEventListener('click', togglePlay);
el.run.addEventListener('click', run);
el.settingsToggle.addEventListener('click', () => panel.toggle());
el.scoresToggle.addEventListener('click', () => scores.toggle());
el.newWindow.addEventListener('click', () => openWindow());

// Shortcuts that should also work with focus outside the editor.
document.addEventListener('keydown', (e) => {
  // A panel or input that took the key (Esc, say) has closed itself already.
  if (e.defaultPrevented) return;
  if (editor.view.hasFocus) return;
  const mod = e.ctrlKey || e.metaKey;
  const inField = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (mod && e.key === ',') {
    e.preventDefault();
    panel.toggle();
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveToLibrary(e.shiftKey);
  } else if (e.altKey && e.shiftKey && !mod && e.code === 'KeyF' && !inField) {
    e.preventDefault();
    formatCode();
  } else if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) {
    const tab = workspace.tabs[Number(e.code.slice(5)) - 1];
    if (tab) {
      e.preventDefault();
      selectTab(tab.id);
    }
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) togglePlay();
    else run();
  } else if (e.altKey && !mod && e.code === 'KeyW') {
    e.preventDefault();
    openWindow();
  } else if (e.key === 'Escape' && !panel.isOpen && !scores.isOpen) {
    if (windows.closeFront()) e.preventDefault();
  }
});

onSystemSchemeChange(() => {
  if (settings.theme === 'system') applySettings();
});

// Draggable split. The stylesheet flips the panes to a column on narrow screens,
// so the divider follows whichever axis the flex container is using. Double-click
// (or double-tap) restores the default split; arrow keys nudge it.
el.gutter.addEventListener('dblclick', () => updateSettings({ split: DEFAULT_SETTINGS.split }));

el.gutter.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.02;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') updateSettings({ split: settings.split - step });
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') updateSettings({ split: settings.split + step });
  else return;
  e.preventDefault();
});

el.gutter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  el.gutter.setPointerCapture(e.pointerId);
  el.gutter.classList.add('dragging');
  document.body.classList.add('resizing');
  const parent = el.gutter.parentElement!;
  const vertical = getComputedStyle(parent).flexDirection === 'column';
  let split = settings.split;
  const move = (ev: PointerEvent): void => {
    const box = parent.getBoundingClientRect();
    let frac = vertical ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
    // Swapped, the editor sits after the divider, so it takes the other side.
    if (!vertical && settings.swapped) frac = 1 - frac;
    split = Math.min(0.85, Math.max(0.15, frac));
    el.editorPane.style.flex = `0 0 ${(split * 100).toFixed(2)}%`;
  };
  const up = (): void => {
    el.gutter.classList.remove('dragging');
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    updateSettings({ split }, false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
});

// ---- document ---------------------------------------------------------
// The working document autosaves as you type. The library keeps named
// snapshots of it (tabs and window layout), as shader-editor's shader list
// does; export/import move it as one .js file; the PDF engraves it onto pages.

function libraryEntry(): LibraryEntry | null {
  return workspace.libId ? library.find((e) => e.id === workspace.libId) ?? null : null;
}

function snapshot(): SavedDocument {
  return {
    version: 1,
    tabs: workspace.tabs.map((t) => ({ ...t })),
    active: workspace.active,
    layout: structuredClone(layoutOf(settings)),
  };
}

/** Does the working document differ from the entry it was opened from (or, unsaved, from a blank one or an example)? */
function documentDirty(): boolean {
  const entry = libraryEntry();
  const now = JSON.stringify(workspace.tabs.map((t) => [t.name, t.text]));
  if (entry) return entry.name !== workspace.name || now !== JSON.stringify(entry.doc.tabs.map((t) => [t.name, t.text]));
  const stock = [freshWorkspace().tabs.map((t) => [t.name, t.text]), ...EXAMPLES.map((e) => [['main.js', e.source], ...(e.tabs ?? []).map((t) => [t.name, t.source])])];
  return !stock.some((tabs) => now === JSON.stringify(tabs));
}

function renderScoresButton(): void {
  el.scoresName.textContent = workspace.name;
  el.scoresToggle.classList.toggle('dirty', documentDirty());
  el.scoresToggle.title = `${workspace.name}${libraryEntry() ? '' : ' (unsaved)'} — save, open, export (Ctrl/⌘ + S saves)`;
}

/** Save the working document into the library, under its own entry or a new one. */
function saveToLibrary(asCopy: boolean): void {
  let name = workspace.name.trim() || UNTITLED;
  // A copy always gets its own name; a first save of something still called
  // "Untitled" deserves a real one.
  if (asCopy || (!libraryEntry() && name === UNTITLED)) {
    const typed = prompt(asCopy ? 'Name the copy' : 'Name this score', asCopy && name !== UNTITLED ? `${name} copy` : name);
    if (typed === null) return;
    name = typed.trim().slice(0, 64) || UNTITLED;
  }
  const existing = asCopy ? null : libraryEntry();
  const entry: LibraryEntry = { id: existing?.id ?? newId(), name, updated: Date.now(), doc: snapshot() };
  // Commit to memory only once storage has taken it, so the two never disagree.
  const before = library;
  library = existing ? library.map((e) => (e === existing ? entry : e)) : [entry, ...library];
  if (!persistLibrary(library)) {
    library = before;
    setStatus('Could not save: this browser’s storage is full or blocked', 'error');
    return;
  }
  workspace.name = name;
  workspace.libId = entry.id;
  saveWorkspace(workspace);
  scores.render();
  renderScoresButton();
  setStatus(`Saved “${name}”`, 'ok');
}

/** Replace the working document: tabs, editor states, layout. */
function openDocument(doc: SavedDocument, name: string, libId: string | null): void {
  const next = workspaceFrom(doc);
  next.name = name;
  next.libId = libId;
  workspace = next;
  player.stop();   // a different piece
  editor.reset(workspace.active, activeTab().text);
  saveWorkspace(workspace);
  fault = null;
  if (doc.layout) applyLayout(doc.layout);
  renderTabs();
  renderScoresButton();
  run();
  editor.view.focus();
}

/** A document's saved window arrangement, onto the screen. */
function applyLayout(layout: SavedLayout): void {
  updateSettings(structuredClone(layout), false);
  applyEditorFloating(settings.editorFloating);
  windows.load(settings.windows);
}

function newDocument(): void {
  if (!confirmDiscard()) return;
  const ws = freshWorkspace();
  openDocument({ version: 1, tabs: ws.tabs, active: ws.active }, UNTITLED, null);
  scores.close();
}

/** Ask before throwing away unsaved work; true means go ahead. */
function confirmDiscard(): boolean {
  if (!documentDirty()) return true;
  const entry = libraryEntry();
  const what = entry ? `unsaved changes to “${entry.name}”` : `the unsaved score “${workspace.name}”`;
  return confirm(`Discard ${what}?`);
}

function importJs(file: File): void {
  file.text().then((text) => {
    if (!confirmDiscard()) return;
    const ws = unbundle(text);
    const name = file.name.replace(/\.[^.]+$/, '').trim() || UNTITLED;
    openDocument({ version: 1, tabs: ws.tabs, active: ws.active }, name, null);
    scores.close();
    setStatus(`Imported ${file.name}`, 'ok');
  }).catch(() => setStatus(`Could not read ${file.name}`, 'error'));
}

/** Engraves the score onto pages at print resolution and downloads the PDF. */
async function exportPdf(size: PageSize): Promise<void> {
  if (!lastGood.measureCount) {
    setStatus('Nothing to export: return a score from main() first', 'warning');
    return;
  }
  setStatus('Rendering PDF…', 'working');
  try {
    await document.fonts.ready;
    const page = PAGE_SIZES[size];
    // Layout units are CSS pixels (96/in); the page is in points (72/in).
    const toPx = 96 / 72;
    // One page canvas at a time: each is compressed as soon as it is drawn,
    // so a long score never holds every page as raw pixels at once.
    const pages: PdfPage[] = [];
    await renderScorePages(lastGood, {
      width: page.width * toPx,
      height: page.height * toPx,
      margin: 48,
      scale: 3,   // 288 dpi
      heading: settings.showHeading,
      barsPerLine: settings.barsPerLine || null,
      serif: getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif',
    }, async (canvas) => {
      pages.push(await pdfPageOf(canvas));
    });
    const blob = await makePdf(pages, { pageWidth: page.width, pageHeight: page.height, title: lastGood.meta.title ?? undefined });
    saveBlob(blob, `${fileStem()}.pdf`);
    setStatus(`Exported PDF, ${pages.length} page${pages.length > 1 ? 's' : ''}`, 'ok');
  } catch (err) {
    setStatus(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/** Tidies the current tab with Prettier; a syntax error is reported, not formatted. */
function formatCode(): void {
  formatDocument(editor.view, { tabSize: settings.tabSize })
    .then((changed) => {
      if (!changed) setStatus('Already formatted', 'ok');
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message.split('\n')[0]! : String(err);
      setStatus(`Format: ${message}`, 'error');
    });
}

function fileStem(): string {
  const title = String((workspace.name !== UNTITLED ? workspace.name : lastGood.meta.title) ?? '').trim() || 'score';
  return title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'score';
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves every tab as one runnable file, helpers first. */
function download(): void {
  saveBlob(new Blob([bundle(workspace)], { type: 'text/javascript' }), `${fileStem()}.js`);
}

// ---- windows ----------------------------------------------------------
// Everything beside the editor is a window (see view/windows.ts). The layout
// lives in settings: which windows exist, what each shows, docked or where it
// floats, and the same for the editor pane.

// Must match the stacking media query in styles.css.
const stacked = matchMedia('(max-width: 720px), (pointer: coarse) and (max-height: 500px)');

function saveLayout(): void {
  settings.windows = windows.specs;
  saveSettings(settings);
  pruneReflow();
}

const floater = new Floater({
  top: () => el.toolbar.getBoundingClientRect().bottom,
  bottom: () => el.statusbar.getBoundingClientRect().top,
  snapTargets: () => [el.dock, el.editorPane],
  onChange: saveLayout,
});

// Reflow a score when its window changes width; the observer watches every
// score window's scroller and remembers the width it was last drawn at.
const drawnWidth = new WeakMap<Element, number>();
const observed = new Set<Element>();
const reflow = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const w = entry.contentRect.width;
    if (Math.abs(w - (drawnWidth.get(entry.target) ?? -1)) < 8) continue;
    drawnWidth.set(entry.target, w);
    const win = windows.wins.find((x) => x.body.contains(entry.target));
    if (win) drawInto(win, lastGood);
  }
});

/** Stops watching scrollers that left the page: their window closed or changed kind. */
function pruneReflow(): void {
  for (const scroll of observed) {
    if (scroll.isConnected) continue;
    reflow.unobserve(scroll);
    observed.delete(scroll);
  }
}

const windows = new WindowManager({
  dock: el.dock,
  main: el.main,
  kinds: WINDOW_KINDS,
  floater,
  stacked,
  onChange: saveLayout,
  mount(win) {
    pruneReflow();
    switch (win.spec.kind) {
      case 'score': {
        const scroll = document.createElement('div');
        scroll.className = 'score-scroll';
        const page = document.createElement('div');
        page.className = 'score-page';
        scroll.append(page);
        win.body.append(scroll);
        reflow.observe(scroll);
        observed.add(scroll);
        drawnWidth.set(scroll, scroll.clientWidth);
        buildScoreTools(win);
        drawInto(win, lastGood);
        break;
      }
      case 'console': {
        const out = document.createElement('div');
        out.className = 'console';
        win.body.append(out);
        renderConsoles();
        break;
      }
      case 'reference': {
        const ref = document.createElement('div');
        ref.className = 'reference';
        ref.innerHTML = REFERENCE_HTML;
        win.body.append(ref);
        break;
      }
    }
  },
});

/**
 * A score window's bar controls: zoom, folded sideways behind one small
 * toggle so the bar stays quiet. One zoom for every score window.
 */
function buildScoreTools(win: Win): void {
  const strip = document.createElement('span');
  strip.className = 'win-strip';
  const toggle = tool(ICON_SLIDERS, 'Score controls: zoom', () => updateSettings({ scoreTools: !settings.scoreTools }, false));
  toggle.classList.add('win-strip-toggle');
  const body = document.createElement('span');
  body.className = 'win-strip-body';
  const seg = document.createElement('span');
  seg.className = 'win-seg';
  const out = tool('−', 'Zoom out', () => updateSettings({ scoreZoom: settings.scoreZoom - 0.1 }, false));
  out.dataset['zoom'] = 'out';
  const inn = tool('+', 'Zoom in', () => updateSettings({ scoreZoom: settings.scoreZoom + 0.1 }, false));
  inn.dataset['zoom'] = 'in';
  seg.append(out, inn);
  const readout = tool('', 'Zoom; click for 100%', () => updateSettings({ scoreZoom: 1 }, false));
  readout.classList.add('win-readout');
  body.append(seg, readout);
  strip.append(toggle, body);
  win.tools.append(strip);
  syncScoreTools();
}

function tool(html: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'win-btn';
  b.title = title;
  b.innerHTML = html;
  b.addEventListener('click', onClick);
  return b;
}

/** Every score bar's strip reflects the shared settings. */
function syncScoreTools(): void {
  for (const t of document.querySelectorAll<HTMLButtonElement>('.win-strip-toggle')) {
    t.setAttribute('aria-expanded', String(settings.scoreTools));
    t.classList.toggle('active', settings.scoreTools);
  }
  for (const body of document.querySelectorAll<HTMLElement>('.win-strip-body')) body.hidden = !settings.scoreTools;
  for (const r of document.querySelectorAll<HTMLElement>('.win-readout')) r.textContent = `${Math.round(settings.scoreZoom * 100)}%`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom="out"]')) b.disabled = settings.scoreZoom <= MIN_ZOOM;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-zoom="in"]')) b.disabled = settings.scoreZoom >= MAX_ZOOM;
}

const ICON_SLIDERS =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M1.5 3h9M1.5 6h9M1.5 9h9"/><circle cx="4" cy="3" r="1.3" fill="var(--paper-sunken)"/><circle cx="8" cy="6" r="1.3" fill="var(--paper-sunken)"/><circle cx="5" cy="9" r="1.3" fill="var(--paper-sunken)"/></svg>';

/** Another window, showing `kind`: docked if nothing is, floating otherwise. */
function openWindow(kind: WindowKind = 'score'): void {
  windows.open(kind);
}

// The editor pane undocks into a floating window with the same gestures.
const EDITOR_MIN_W = 280;
const EDITOR_MIN_H = 160;

function defaultEditorRect(): FloatRect {
  const a = floater.area();
  const w = Math.round(Math.min(Math.max(a.w * 0.45, EDITOR_MIN_W), 820));
  const h = Math.round(Math.min(Math.max(a.h * 0.85, EDITOR_MIN_H), 900));
  return { x: a.x + 8, y: a.y + 8, w, h };
}

const editorHost: FloatHost = {
  el: el.editorPane,
  bar: el.editorBar,
  minW: EDITOR_MIN_W,
  minH: EDITOR_MIN_H,
  rect: () => settings.editorRect ?? defaultEditorRect(),
  setRect(r) {
    settings.editorRect = r;
    writeRect(el.editorPane, r);
  },
};

function applyEditorFloating(on: boolean, animate = false): void {
  settings.editorFloating = on;
  // Narrow screens stack everything; the editor stays in the split there,
  // but only on screen: the preference survives until the screen widens.
  if (stacked.matches) on = false;
  el.editorPane.classList.toggle('floating', on);
  el.editorPane.classList.toggle('pop', on && animate);
  el.main.classList.toggle('editor-floating', on);
  if (on) {
    editorHost.setRect(floater.clamp(editorHost.rect(), EDITOR_MIN_W, EDITOR_MIN_H));
    floater.raise(el.editorPane);
  } else {
    clearRect(el.editorPane);
    el.editorPane.style.flex = `0 0 ${(settings.split * 100).toFixed(2)}%`;
  }
}

/** Only the backgrounds change (styles.css keys off these classes and variables); the pane is still opaque while docked. */
function applyEditorGlass(mode: GlassMode, tint: number, frost: number): void {
  const root = document.documentElement.style;
  root.setProperty('--glass-a', String(mode === 'clear' ? 0 : tint));
  root.setProperty('--glass-blur', `${frost}px`);
  el.editorPane.classList.toggle('glass', mode !== 'solid');
  el.editorPane.classList.toggle('glass-frost', mode === 'glass');
}

el.editorUndock.addEventListener('click', () => {
  applyEditorFloating(true, true);
  saveSettings(settings);
});
el.editorDock.addEventListener('click', () => {
  applyEditorFloating(false);
  saveSettings(settings);
});
el.editorBar.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  applyEditorFloating(false);
  saveSettings(settings);
});
el.editorPane.addEventListener('animationend', () => el.editorPane.classList.remove('pop'));
el.editorPane.addEventListener('pointerdown', () => settings.editorFloating && !stacked.matches && floater.raise(el.editorPane), true);
floater.attach(editorHost, addResizeHandles(el.editorPane));

window.addEventListener('resize', () => {
  if (floater.dragging || !settings.editorFloating || stacked.matches) return;
  editorHost.setRect(floater.clamp(editorHost.rect(), EDITOR_MIN_W, EDITOR_MIN_H));
});
stacked.addEventListener('change', () => {
  if (settings.editorFloating) applyEditorFloating(true);
  el.editorUndock.disabled = stacked.matches;
});

/** The layout fields of a settings object. */
function layoutOf(s: Settings): Pick<Settings, keyof typeof DEFAULT_LAYOUT> {
  return { split: s.split, swapped: s.swapped, editorFloating: s.editorFloating, editorRect: s.editorRect, windows: s.windows };
}

// ---- start ------------------------------------------------------------

applySettings();
renderTabs();
renderScoresButton();
windows.load(settings.windows);
applyEditorFloating(settings.editorFloating);
el.editorUndock.disabled = stacked.matches;
let lastRunHung = false;
try { lastRunHung = localStorage.getItem(RUNNING_KEY) !== null; localStorage.removeItem(RUNNING_KEY); } catch { /* no storage */ }
if (lastRunHung) {
  if (settings.runMode !== 'manual') updateSettings({ runMode: 'manual' });
  draw(lastGood);
  setStatus('The last run never finished (an endless loop?). Run mode is now Manual: fix the script, then Ctrl/⌘ + Enter', 'warning');
} else {
  run();
}
// Autofocus would pop the on-screen keyboard over half the page on touch devices.
if (!matchMedia('(pointer: coarse)').matches) editor.view.focus();

function must<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element: ${selector}`);
  return found;
}
