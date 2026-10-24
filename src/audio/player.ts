import { ElectricPiano, Mallet, Reverb, Soundfont, SplendidGrandPiano, type Smplr } from 'smplr';

import { barAccidentals, midiOf, parseKey } from '../music/pitch.js';
import { unitsWithDots } from '../music/rhythm.js';
import type { Measure, NoteEvent, Score } from '../model/types.js';

// Playback. The score model already carries everything timing needs: events in
// whole-note units, measures padded parallel across the two staves. We flatten
// both voices to absolute-time events and feed them to a sampled instrument
// (smplr — real recorded samples, fetched once per instrument from its CDN).
//
// Notes are scheduled through a short lookahead loop rather than all at once:
// stop() then only has to silence sounding notes and drop the queue, instead of
// trusting the sampler to cancel minutes of pre-scheduled audio. The loop is
// also what drives the currently-playing-note callback for score highlighting.

interface PlaybackEvent {
  midis: number[];
  /** Onset in seconds from the start of the piece. */
  start: number;
  /** Sounding length in seconds. */
  duration: number;
  /** Source offset of the note's span — the score tags SVG groups with this. */
  spanFrom: number;
}

/**
 * MIDI numbers for a chord, each member at the alteration the bar's
 * accidental state gives it (the same state the engraving is printed from).
 */
function eventMidis(event: NoteEvent, sounding: string[]): number[] {
  const out: number[] = [];
  event.keys.forEach((key, i) => {
    const p = parseKey(key);
    const midi = p ? midiOf(`${p.letter}${sounding[i] ?? ''}/${p.octave}`) : null;
    if (midi !== null && midi >= 0 && midi <= 127) out.push(midi);
  });
  return out;
}

/** Flatten one voice's measures into absolute-time events. */
function collectVoice(measures: Measure[], secondsPerWholeNote: number, out: PlaybackEvent[]): void {
  let measureStart = 0;
  for (const measure of measures) {
    const accidentals = barAccidentals(measure.events, measure.keySig);
    let cursor = measureStart;
    measure.events.forEach((event, i) => {
      const units = unitsWithDots(event.duration, event.dots);
      if (!event.rest) {
        const midis = eventMidis(event, accidentals[i]!.sounding);
        if (midis.length) {
          out.push({
            midis,
            start: cursor * secondsPerWholeNote,
            // Slight detach so repeated notes re-articulate.
            duration: Math.max(0.05, units * secondsPerWholeNote * 0.95),
            spanFrom: event.span.from,
          });
        }
      }
      cursor += units;
    });
    // The next bar starts on the grid even if this one over- or under-fills.
    measureStart += measure.capacity;
  }
}

function collect(score: Score, speed: number): { events: PlaybackEvent[]; length: number } {
  const bpm = score.meta.tempo;
  const tempo = (bpm != null && Number.isFinite(bpm) && bpm > 0 ? bpm : 100) * speed; // quarter-note BPM
  const secondsPerWholeNote = (60 / tempo) * 4;
  const events: PlaybackEvent[] = [];
  // Only the staves on the page sound: a clef of 'treble' hides the bass.
  if (score.meta.clefMode !== 'bass') collectVoice(score.treble, secondsPerWholeNote, events);
  if (score.meta.clefMode !== 'treble') collectVoice(score.bass, secondsPerWholeNote, events);
  events.sort((a, b) => a.start - b.start);
  let length = 0;
  for (const e of events) length = Math.max(length, e.start + e.duration);
  // A loop restarts on the barline, not the moment the last note dies away.
  const staff = score.meta.clefMode === 'bass' || !score.treble.length ? score.bass : score.treble;
  const written = staff.reduce((sum, m) => sum + m.capacity, 0);
  return { events, length: Math.max(length, written * secondsPerWholeNote) };
}

// ---- instruments ------------------------------------------------------

export interface InstrumentInfo {
  id: string;
  name: string;
  note: string;
}

const FACTORIES: Record<string, (ctx: AudioContext) => Smplr> = {
  grand: (ctx) => SplendidGrandPiano(ctx),
  rhodes: (ctx) => ElectricPiano(ctx, { instrument: 'CP80' }),
  wurlitzer: (ctx) => ElectricPiano(ctx, { instrument: 'WurlitzerEP200' }),
  vibraphone: (ctx) => Mallet(ctx, { instrument: 'Vibraphone - Soft Mallets' }),
  marimba: (ctx) => Soundfont(ctx, { instrument: 'marimba' }),
  celesta: (ctx) => Soundfont(ctx, { instrument: 'celesta' }),
  musicbox: (ctx) => Soundfont(ctx, { instrument: 'music_box' }),
  harpsichord: (ctx) => Soundfont(ctx, { instrument: 'harpsichord' }),
  organ: (ctx) => Soundfont(ctx, { instrument: 'church_organ' }),
  guitar: (ctx) => Soundfont(ctx, { instrument: 'acoustic_guitar_nylon' }),
  strings: (ctx) => Soundfont(ctx, { instrument: 'string_ensemble_1' }),
  flute: (ctx) => Soundfont(ctx, { instrument: 'flute' }),
};

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'grand', name: 'Grand piano', note: 'Splendid Grand — multi-velocity samples' },
  { id: 'rhodes', name: 'Electric piano', note: 'Yamaha CP80' },
  { id: 'wurlitzer', name: 'Wurlitzer', note: 'EP200, bark and all' },
  { id: 'vibraphone', name: 'Vibraphone', note: 'Soft mallets' },
  { id: 'marimba', name: 'Marimba', note: 'General MIDI soundfont' },
  { id: 'celesta', name: 'Celesta', note: 'General MIDI soundfont' },
  { id: 'musicbox', name: 'Music box', note: 'General MIDI soundfont' },
  { id: 'harpsichord', name: 'Harpsichord', note: 'General MIDI soundfont' },
  { id: 'organ', name: 'Church organ', note: 'General MIDI soundfont — notes hold' },
  { id: 'guitar', name: 'Nylon guitar', note: 'General MIDI soundfont' },
  { id: 'strings', name: 'Strings', note: 'General MIDI ensemble' },
  { id: 'flute', name: 'Flute', note: 'General MIDI soundfont' },
];

export interface PlaybackOptions {
  instrument: string;
  /** 0–1. */
  volume: number;
  /** Tempo multiplier. */
  speed: number;
  /** Reverb send, 0–1; 0 bypasses the reverb entirely. */
  reverb: number;
  loop: boolean;
  /** Small random timing and velocity drift, so chords don't sound typed. */
  humanize: boolean;
}

export const DEFAULT_PLAYBACK: PlaybackOptions = {
  instrument: 'grand',
  volume: 0.8,
  speed: 1,
  reverb: 0.2,
  loop: false,
  humanize: false,
};

/**
 * How far ahead of the audio clock notes get handed to the sampler. A hidden
 * tab's timers fire once a second at best, so the window has to cover more
 * than that or notes bunch up when the tick finally runs.
 */
const LOOKAHEAD_S = 1.5;
const TICK_MS = 50;
/** How long a single pass is left to ring after its last bar. */
const TAIL_S = 0.4;

export class Player {
  private context: AudioContext | null = null;
  private reverb: ReturnType<typeof Reverb> | null = null;
  /** Instruments are kept once loaded, so switching back is instant. */
  private instruments = new Map<string, Smplr>();
  private current: Smplr | null = null;

  private queue: PlaybackEvent[] = [];
  private queuePos = 0;
  private startTime = 0;
  private length = 0;
  private tickTimer = 0;
  private endTimer = 0;
  private noteTimers: number[] = [];
  private score: Score | null = null;

  options: PlaybackOptions = { ...DEFAULT_PLAYBACK };

  playing = false;
  /** Fires when playback starts or stops for any reason. */
  onStateChange: ((playing: boolean) => void) | null = null;
  /** Fires at each note onset with its event id and length in ms. */
  onNote: ((spanFrom: number, durationMs: number) => void) | null = null;

  /** Applies new options; volume and reverb take effect on sounding notes too. */
  configure(options: PlaybackOptions): void {
    const previous = this.options;
    this.options = { ...options };
    for (const inst of this.instruments.values()) this.mix(inst);
    if (previous.instrument !== options.instrument && this.playing) this.stop();
  }

  private mix(inst: Smplr): void {
    inst.output.volume = Math.round(this.options.volume * 127);
    if (this.reverb) inst.output.setEffectMix('reverb', this.options.reverb);
  }

  /** Lazily create the AudioContext and fetch samples; must follow a user gesture. */
  private async instrument(): Promise<Smplr> {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    const id = FACTORIES[this.options.instrument] ? this.options.instrument : 'grand';
    let inst = this.instruments.get(id);
    if (!inst) {
      const fresh = FACTORIES[id](this.context);
      try {
        this.reverb ??= Reverb(this.context);
        fresh.output.addEffect('reverb', this.reverb, this.options.reverb);
      } catch {
        // Reverb is decoration; a context that can't build it still plays.
      }
      // Cached only once its samples are in: a failed download is then
      // retried by the next play rather than remembered.
      try {
        await fresh.ready;
      } catch (err) {
        try { fresh.disconnect(); } catch { /* already torn down */ }
        throw err;
      }
      this.instruments.set(id, fresh);
      this.mix(fresh);
      inst = fresh;
    }
    await inst.ready;
    this.current = inst;
    return inst;
  }

  async play(score: Score): Promise<void> {
    // Set before the wait: an update() that lands while samples download wins.
    this.score = score;
    await this.instrument();
    this.cancel();
    if (!this.start()) return;
    this.playing = true;
    this.onStateChange?.(true);
  }

  /**
   * Queues one pass through the score, starting at `at` on the audio clock;
   * false when there is nothing to sound.
   */
  private start(at = this.context!.currentTime + 0.1): boolean {
    const { events, length } = collect(this.score!, this.options.speed);
    if (!events.length) return false;

    this.queue = events;
    this.queuePos = 0;
    this.length = length;
    this.startTime = at;

    this.tick();
    this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);
    this.armEnd();
    return true;
  }

  /**
   * Times finish(): a loop queues its next pass a lookahead before the
   * barline, so it starts exactly on it; a single pass rings out first.
   */
  private armEnd(): void {
    const remaining = this.startTime + this.length - this.context!.currentTime;
    const wait = this.options.loop ? remaining - LOOKAHEAD_S : remaining + TAIL_S;
    this.endTimer = window.setTimeout(() => this.finish(), Math.max(0, wait) * 1000);
  }

  private finish(): void {
    const now = this.context!.currentTime;
    const end = this.startTime + this.length;
    if (this.options.loop && this.playing) {
      // Everything left in this pass, then the next one from the barline
      // (or from now, when a throttled timer let the barline go by).
      this.tick();
      window.clearInterval(this.tickTimer);
      if (!this.start(Math.max(end, now))) this.stop();   // the score emptied meanwhile
      return;
    }
    // Looping was switched off mid-pass: the timer came early, let it ring.
    if (now < end + TAIL_S) {
      this.armEnd();
      return;
    }
    this.stop();
  }

  /** Swaps in a newer score; a loop picks it up on its next pass. */
  update(score: Score): void {
    this.score = score;
  }

  /** Hand every event inside the lookahead window to the sampler. */
  private tick(): void {
    const inst = this.current!;
    const now = this.context!.currentTime;
    const horizon = now - this.startTime + LOOKAHEAD_S;
    const human = this.options.humanize;

    while (this.queuePos < this.queue.length && this.queue[this.queuePos].start <= horizon) {
      const ev = this.queue[this.queuePos++];
      const when = this.startTime + ev.start;
      for (const midi of ev.midis) {
        inst.start({
          note: midi,
          time: Math.max(now, when + (human ? (Math.random() - 0.5) * 0.024 : 0)),
          duration: ev.duration,
          velocity: human ? 76 + Math.round(Math.random() * 30) : 90,
        });
      }
      if (this.onNote && ev.spanFrom >= 0) {
        const delay = Math.max(0, (when - now) * 1000);
        this.noteTimers.push(
          window.setTimeout(() => this.onNote?.(ev.spanFrom, ev.duration * 1000), delay),
        );
      }
    }
  }

  /** Seconds into the current pass, or 0 when stopped. */
  get position(): number {
    if (!this.playing || !this.context) return 0;
    return Math.min(this.length, Math.max(0, this.context.currentTime - this.startTime));
  }

  stop(): void {
    const wasPlaying = this.playing;
    this.cancel();
    if (wasPlaying) {
      this.playing = false;
      this.onStateChange?.(false);
    }
  }

  private cancel(): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.endTimer);
    for (const t of this.noteTimers) window.clearTimeout(t);
    this.noteTimers = [];
    this.queue = [];
    this.queuePos = 0;
    for (const inst of this.instruments.values()) inst.stop();
  }
}
