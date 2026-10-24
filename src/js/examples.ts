import { JS_SEED } from './runtime.js';

// Starter documents, offered from the settings panel. Each is a complete
// script — loading one replaces the editor text as a single undoable edit.

export interface Example {
  id: string;
  name: string;
  /** The main tab. */
  source: string;
  /** Helper tabs the example needs, created or overwritten by name. */
  tabs?: Array<{ name: string; source: string }>;
}

const PROGRESSION = `// A ii–V–I in every key around the circle of fifths… or just three of them.
// Voicings are built by hand; the bass takes the roots.

function main({ score, chord, note }) {
  const bars = [
    { rh: ['d/4', 'f/4', 'a/4', 'c/5'], lh: 'd/3' }, // Dm7
    { rh: ['d/4', 'f/4', 'g/4', 'b/4'], lh: 'g/2' }, // G7
    { rh: ['c/4', 'e/4', 'g/4', 'b/4'], lh: 'c/3' }, // Cmaj7
    { rh: ['c/4', 'e/4', 'g/4', 'b/4'], lh: 'c/3' },
  ];

  return score(
    { title: 'ii – V – I', key: 'C', time: '4/4', tempo: 84 },
    {
      treble: bars.map((b) => [chord(b.rh, 'h'), chord(b.rh, 'h')]),
      bass: bars.map((b) => [note(b.lh, 'q'), note(b.lh, 'q'), note(b.lh, 'h')]),
    },
  );
}
`;

const ARPEGGIOS = `// Broken chords: each chord is spread up and back down in eighth notes.

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

/** Diatonic step n (0 = c/4) to a key string. */
function step(n) {
  const octave = 4 + Math.floor(n / 7);
  return \`\${LETTERS[((n % 7) + 7) % 7]}/\${octave}\`;
}

function main({ score, note }) {
  const roots = [0, 5, 3, 4]; // I – vi – IV – V
  const treble = roots.map((r) => {
    const up = [r, r + 2, r + 4, r + 7];
    return [...up, ...up.slice().reverse()].map((n) => note(step(n), '8'));
  });
  const bass = roots.map((r) => [note(step(r - 7), 'w')]);

  return score({ title: 'Arpeggios', key: 'C', time: '4/4', tempo: 112 }, { treble, bass });
}
`;

const RANDOM_WALK = `// A seeded random walk in G major. Change SEED for a new tune.
// The melody is one flat list — score() bars it by the time signature, and
// the key signature turns every f into f#, on the page and in playback.

const SEED = 7;
const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const step = (n) => \`\${LETTERS[((n % 7) + 7) % 7]}/\${4 + Math.floor(n / 7)}\`;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function main({ score, note, rest }) {
  const rand = rng(SEED);
  const durations = ['8', '8', 'q', 'q', 'h'];
  let degree = 4; // g/4
  const melody = [];

  for (let i = 0; i < 40; i++) {
    degree = Math.max(-3, Math.min(11, degree + Math.round((rand() - 0.5) * 4)));
    const dur = durations[Math.floor(rand() * durations.length)];
    melody.push(rand() < 0.08 ? rest(dur) : note(step(degree), dur));
  }

  return score({ title: 'Random Walk', key: 'G', time: '3/4', tempo: 132 }, { treble: melody });
}
`;

const SCALES = `// Scales in contrary motion: the right hand climbs while the left descends.

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const key = (n, base) => \`\${LETTERS[((n % 7) + 7) % 7]}/\${base + Math.floor(n / 7)}\`;

function main({ score, note }) {
  const up = Array.from({ length: 16 }, (_, i) => (i < 8 ? i : 15 - i));
  return score(
    { title: 'Contrary Motion', key: 'C', time: '4/4', tempo: 96 },
    {
      treble: up.map((n) => note(key(n, 4), '8')),
      bass: up.map((n) => note(key(-n, 3), '8')),
    },
  );
}
`;

const THEORY_HELPERS = `// theory.js: small music-theory helpers, shared by every tab.
// Top-level definitions here are visible from main.js.

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

/** Diatonic step n (0 = c/4) to a key string. */
function step(n, base = 4) {
  return \`\${LETTERS[((n % 7) + 7) % 7]}/\${base + Math.floor(n / 7)}\`;
}

/** Root-position triad on diatonic step n. */
const triad = (n) => [step(n), step(n + 2), step(n + 4)];

/** The degrees of a phrase that climbs, then falls back. */
function arch(from, to) {
  const up = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return [...up, ...up.slice(0, -1).reverse()];
}
`;

const WITH_HELPERS = `// The helpers (step, triad, arch) live in the theory.js tab.
// Every tab shares one scope; helper tabs run before main.

function main({ score, note, chord }) {
  const melody = arch(0, 7).map((n) => note(step(n), '8'));
  const roots = [0, 3, 4, 0];
  const bass = roots.map((r) => [chord(triad(r - 7), 'w')]);

  return score({ title: 'Shared Helpers', key: 'C', time: '4/4', tempo: 100 }, {
    treble: melody.concat([note('c/4', 'h'), note('c/5', 'h')]),
    bass,
  });
}
`;

export const EXAMPLES: Example[] = [
  { id: 'sketch', name: 'Sketch — the basics', source: JS_SEED },
  { id: 'progression', name: 'ii–V–I voicings', source: PROGRESSION },
  { id: 'arpeggios', name: 'Generated arpeggios', source: ARPEGGIOS },
  { id: 'scales', name: 'Contrary-motion scales', source: SCALES },
  { id: 'random', name: 'Seeded random walk', source: RANDOM_WALK },
  { id: 'helpers', name: 'Helpers in a second tab', source: WITH_HELPERS, tabs: [{ name: 'theory.js', source: THEORY_HELPERS }] },
];
