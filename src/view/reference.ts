// The Reference window: the api and the shortcuts, in one scrollable page.
// Static markup, kept next to the README table it mirrors.

const API: Array<[string, string]> = [
  ['note(key, dur?, { dots? })', "one pitch: 'c/4', 'eb/3', 'f#/5', 'bn/4' (explicit natural)"],
  ['chord(keys, dur?, { dots? })', 'several pitches at once'],
  ['rest(dur?, { dots? })', 'silence'],
  ['score(meta, { treble?, bass? })', 'meta: title, key, time, tempo, clef (grand / treble / bass)'],
  ['VF', 'the whole VexFlow module, for experiments'],
];

const KEYS: Array<[string, string]> = [
  ['Ctrl/⌘ + Enter', 'run'],
  ['Ctrl/⌘ + Shift + Enter', 'play / stop'],
  ['Ctrl/⌘ + ,', 'settings'],
  ['Ctrl/⌘ + S', 'save to the score list (Ctrl/⌘ + Shift + S saves a copy)'],
  ['Shift + Alt + F', 'format the code (or :format in vim mode)'],
  ['Alt + N', 'new helper tab'],
  ['Alt + 1…9', 'jump to a tab'],
  ['Alt + [ / ]', 'previous / next tab'],
  ['Alt + W', 'new window'],
  ['Esc', 'close the front floating window'],
];

const WINDOWS: Array<[string, string]> = [
  ['Bar', 'drag to move a floating window; its buttons dock, undock or close it'],
  ['Edges', 'resize from any edge or corner; edges snap to other windows (Alt to drag freely)'],
  ['Double-click bar', 'cycle a floating window through halves and quarters of the screen'],
  ['Double-click editor bar', 'dock the editor back into the split'],
];

function table(rows: Array<[string, string]>): string {
  return `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

function esc(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

export const REFERENCE_HTML = `
<h3>Writing a score</h3>
<p>The document defines <code>main(api)</code> and returns a score. Helper tabs run first, left to right, and share one scope with <code>main.js</code>.</p>
${table(API)}
<p>Durations: <code>1 2 4 8 16 32</code> or <code>w h q</code>, with trailing dots (<code>'4.'</code>). A staff is either an array of measures or one flat list of events, barred automatically by the time signature. Bare letters follow the key signature, on the page and in playback.</p>
<p><code>console.log(…)</code> inside the script prints to a Console window.</p>
<h3>Shortcuts</h3>
${table(KEYS)}
<h3>Windows</h3>
${table(WINDOWS)}
`;
