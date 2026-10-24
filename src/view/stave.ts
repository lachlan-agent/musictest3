import {
  Accidental,
  Barline,
  Beam,
  CanvasContext,
  Dot,
  Formatter,
  type RenderContext,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow';

import { barAccidentals } from '../music/pitch.js';
import { voiceTime } from '../music/rhythm.js';
import type { Measure, NoteEvent, Score, Voice as VoiceName } from '../model/types.js';
import { DEFAULT_LAYOUT, planSystems, type MeasurePlan, type SystemPlan } from './layout.js';

// THE ONLY FILE THAT IMPORTS VEXFLOW. Everything above this layer is plain data,
// which is what keeps the language extensible without touching engraving.
//
// Strategy: full teardown and redraw on every call. A fresh Renderer per pass
// sidesteps SVGContext.resize()'s cumulative scale (see musicTest2/src/ui/staff.ts).

const PAD_LEFT = 26;   // room for the brace, which draws left of the stave origin
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const STAVE_GAP = 92;  // treble origin -> bass origin
const SYSTEM_GAP = 46;
const NOTE_END_PAD = 10;  // keep the last note clear of the end barline

const REST_KEY: Record<VoiceName, string> = { treble: 'b/4', bass: 'd/3' };
const CLEF: Record<VoiceName, string> = { treble: 'treble', bass: 'bass' };

export interface RenderOptions {
  /** Available CSS pixel width of the score pane. */
  width: number;
  /**
   * Ink colour. `currentColor` lets the stylesheet recolour the engraving
   * (themes, printing) without a redraw.
   */
  ink: string;
  /** Print the title and tempo above the first system. */
  heading?: boolean;
  /** Most measures per system when the score itself doesn't say; null = auto. */
  barsPerLine?: number | null;
  /**
   * Instrumentation seam: called once per drawn measure with the final geometry.
   * Used by the headless layout check to assert no note escapes its own bar.
   */
  debug?(info: MeasureGeometry): void;
}

export interface MeasureGeometry {
  index: number;
  staff: VoiceName;
  noteStartX: number;
  noteEndX: number;
  noteXs: number[];
}

export function renderScore(host: HTMLElement, score: Score, opts: RenderOptions): void {
  host.textContent = '';

  const staves: VoiceName[] =
    score.meta.clefMode === 'grand' ? ['treble', 'bass']
    : score.meta.clefMode === 'bass' ? ['bass']
    : ['treble'];

  if (opts.heading ?? true) renderHeading(host, score);

  if (score.measureCount === 0) return;

  const plan = layoutScore(score, staves, opts.width, opts.barsPerLine ?? null);
  const totalHeight = PAD_TOP + plan.systems.length * plan.systemHeight + 20;
  const totalWidth = PAD_LEFT + plan.contentWidth + PAD_RIGHT;

  const mount = document.createElement('div');
  host.appendChild(mount);

  const renderer = new Renderer(mount, Renderer.Backends.SVG);
  renderer.resize(totalWidth, totalHeight);
  const ctx = renderer.getContext();
  hardenSvg(mount, totalWidth, totalHeight);
  ctx.setFillStyle(opts.ink);
  ctx.setStrokeStyle(opts.ink);

  drawSystems(ctx, score, staves, plan, 0, PAD_LEFT, PAD_TOP, { tag: true, debug: opts.debug });

  inkSvg(mount, opts.ink);
}

/** The systems of a score laid out for a width, plus the per-system height. */
interface ScorePlan {
  systems: SystemPlan[];
  systemHeight: number;
  contentWidth: number;
}

function layoutScore(score: Score, staves: VoiceName[], width: number, barsPerLine: number | null): ScorePlan {
  const contentWidth = Math.max(240, width - PAD_LEFT - PAD_RIGHT);
  const headerWidth = measureHeaderWidth(score);
  const systems = planSystems(measureNaturalWidths(score, staves), {
    ...DEFAULT_LAYOUT,
    contentWidth,
    headerWidth,
    minWidth: score.meta.minBarWidth ?? DEFAULT_LAYOUT.minWidth,
    // Fit to width is decided by the width alone; a fixed bars-per-line caps it.
    maxPerSystem: score.meta.barsPerLine ?? barsPerLine ?? Infinity,
  });
  const systemHeight = (staves.length - 1) * STAVE_GAP + SYSTEM_GAP + 60;
  return { systems, systemHeight, contentWidth };
}

/**
 * Draws systems `first`.. (as many as `count`, all by default) with the first
 * one's stave origin at (x0, y0). `tag` marks each note's SVG group with its
 * source offset for playback highlighting; a canvas has nothing to tag.
 */
function drawSystems(
  ctx: RenderContext,
  score: Score,
  staves: VoiceName[],
  plan: ScorePlan,
  first: number,
  x0: number,
  y0: number,
  opts: { count?: number; tag: boolean; debug?: RenderOptions['debug'] },
): void {
  const systems = plan.systems.slice(first, opts.count == null ? undefined : first + opts.count);
  systems.forEach((system, si) => {
    const y = y0 + si * plan.systemHeight;
    const drawn: Record<string, Stave> = {};

    for (const plan of system.measures) {
      const built: { stave: Stave; voice: Voice; beams: Beam[]; measure: Measure }[] = [];

      staves.forEach((name, vi) => {
        const measure = pick(score, name, plan.index);
        const prev = plan.index > 0 ? pick(score, name, plan.index - 1) : null;
        const stave = buildStave(measure, prev, plan, name, x0 + plan.x, y + vi * STAVE_GAP, {
          lastOfPiece: plan.index === score.measureCount - 1,
        });
        stave.setContext(ctx).draw();
        if (plan.first) drawn[name] = stave;

        const notes = buildNotes(measure, name);
        const beams = Beam.generateBeams(notes, { groups: Beam.getDefaultBeamGroups(beamTime(measure.timeSig)) });
        const voice = makeVoice(measure, notes);
        voice.setStave(stave);
        built.push({ stave, voice, beams, measure });
      });

      // Justify to the *drawable* span of the narrowest stave in this column —
      // stave.getNoteStartX() already accounts for whatever clef, key and time
      // signature this measure printed, which a width guess cannot.
      const span = Math.min(...built.map((b) => b.stave.getNoteEndX() - b.stave.getNoteStartX()));
      const formatter = new Formatter();
      for (const b of built) formatter.joinVoices([b.voice]);
      formatter.format(built.map((b) => b.voice), Math.max(40, span - NOTE_END_PAD));

      built.forEach((b, bi) => {
        b.voice.draw(ctx, b.stave);
        for (const beam of b.beams) beam.setContext(ctx).draw();
        // Tag each note's SVG group with its source offset, so playback can
        // highlight the sounding note by querying [data-from="..."].
        if (opts.tag) {
          b.voice.getTickables().forEach((t, ti) => {
            const el = (t as StaveNote).getSVGElement?.();
            const event = b.measure.events[ti];
            if (el && event && !event.rest && event.span.from >= 0) {
              el.setAttribute('data-from', String(event.span.from));
            }
          });
        }
        opts.debug?.({
          index: plan.index,
          staff: staves[bi]!,
          noteStartX: b.stave.getNoteStartX(),
          noteEndX: b.stave.getNoteEndX(),
          noteXs: b.voice.getTickables().map((t) => t.getAbsoluteX()),
        });
      });
    }

    if (staves.length === 2 && drawn.treble && drawn.bass) {
      new StaveConnector(drawn.treble, drawn.bass).setType('brace').setContext(ctx).draw();
      new StaveConnector(drawn.treble, drawn.bass).setType('singleLeft').setContext(ctx).draw();
    }
  });
}

// ---- pages ------------------------------------------------------------

export interface PageOptions {
  /** Page size in CSS pixels (96 per inch), e.g. A4 is 794 × 1123. */
  width: number;
  height: number;
  /** Margin on every side, CSS pixels. */
  margin: number;
  /** Device pixels per CSS pixel the canvas is rendered at. */
  scale: number;
  heading?: boolean;
  barsPerLine?: number | null;
  /** The fonts for the title and tempo line. */
  serif: string;
}

/**
 * The score as page-sized canvases, black on white: the title block on the
 * first, then as many whole systems per page as fit. A system never
 * straddles a page. Each page is handed to `each` as it is drawn and
 * released once that returns, so only one page's pixels exist at a time;
 * resolves to the page count.
 */
export async function renderScorePages(
  score: Score,
  opts: PageOptions,
  each: (canvas: HTMLCanvasElement, index: number) => Promise<void> | void,
): Promise<number> {
  const staves: VoiceName[] =
    score.meta.clefMode === 'grand' ? ['treble', 'bass']
    : score.meta.clefMode === 'bass' ? ['bass']
    : ['treble'];
  const plan = layoutScore(score, staves, opts.width - 2 * opts.margin, opts.barsPerLine ?? null);
  const { title, tempo } = score.meta;
  const heading = (opts.heading ?? true) && (title || tempo != null);
  const headingHeight = heading ? (title ? 34 : 0) + (tempo != null ? 22 : 0) + 12 : 0;
  const usable = opts.height - 2 * opts.margin;
  const perPage = Math.max(1, Math.floor((usable - PAD_TOP) / plan.systemHeight));
  const firstPage = Math.max(1, Math.floor((usable - PAD_TOP - headingHeight) / plan.systemHeight));

  let pages = 0;
  let next = 0;
  do {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(opts.width * opts.scale);
    canvas.height = Math.round(opts.height * opts.scale);
    const c2d = canvas.getContext('2d')!;
    c2d.fillStyle = '#fff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    c2d.scale(opts.scale, opts.scale);
    c2d.fillStyle = '#000';
    c2d.strokeStyle = '#000';

    let y = opts.margin;
    if (pages === 0 && heading) {
      c2d.textBaseline = 'alphabetic';
      if (title) {
        c2d.font = `600 20px ${opts.serif}`;
        c2d.fillText(title, opts.margin + PAD_LEFT, y + 22);
        y += 34;
      }
      if (tempo != null) {
        c2d.font = `13px ${opts.serif}`;
        c2d.globalAlpha = 0.75;
        c2d.fillText(`♩ = ${tempo}`, opts.margin + PAD_LEFT, y + 14);
        c2d.globalAlpha = 1;
        y += 22;
      }
      y += 12;
    }

    const count = Math.min(pages === 0 ? firstPage : perPage, plan.systems.length - next);
    if (count > 0) {
      const ctx = new CanvasContext(c2d);
      ctx.setFillStyle('#000');
      ctx.setStrokeStyle('#000');
      drawSystems(ctx, score, staves, plan, next, opts.margin + PAD_LEFT, y + PAD_TOP, { count, tag: false });
      next += count;
    }
    await each(canvas, pages++);
    // Zero-sized, the canvas gives its bitmap back at once instead of at GC.
    canvas.width = 0;
    canvas.height = 0;
  } while (next < plan.systems.length);
  return pages;
}


// ---- pieces -----------------------------------------------------------

function renderHeading(host: HTMLElement, score: Score): void {
  const { title, tempo } = score.meta;
  if (!title && tempo == null) return;
  const head = document.createElement('div');
  head.className = 'score-heading';
  if (title) {
    const h = document.createElement('h1');
    h.textContent = title;
    head.appendChild(h);
  }
  if (tempo != null) {
    const t = document.createElement('p');
    t.textContent = `♩ = ${tempo}`;
    head.appendChild(t);
  }
  host.appendChild(head);
}

function makeVoice(measure: Measure, notes: StaveNote[]): Voice {
  const voice = new Voice(voiceTime(measure.timeSig)).setMode(Voice.Mode.SOFT);
  voice.addTickables(notes);
  return voice;
}

/**
 * Ask VexFlow how much horizontal room each measure's notes actually need, before
 * deciding how many fit on a system. Counting noteheads is not enough: accidentals,
 * dots and chord clusters all cost width, and underestimating pushes the last notes
 * of a bar past its own barline.
 *
 * Notes are built twice — once here, once for real. Formatting mutates tick
 * contexts, so measuring pass objects are deliberately thrown away.
 */
function measureNaturalWidths(score: Score, staves: VoiceName[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < score.measureCount; i++) {
    let widest = 0;
    for (const name of staves) {
      const measure = pick(score, name, i);
      const notes = buildNotes(measure, name);
      const voice = makeVoice(measure, notes);
      const formatter = new Formatter().joinVoices([voice]);
      widest = Math.max(widest, formatter.preCalculateMinTotalWidth([voice]));
    }
    out.push(widest);
  }
  return out;
}

/**
 * Width the clef, key signature and time signature occupy at the head of a system,
 * measured from a throwaway stave rather than guessed.
 */
function measureHeaderWidth(score: Score): number {
  const probe = new Stave(0, 0, 300);
  probe.addClef('treble');
  if (score.meta.keySig) probe.addKeySignature(score.meta.keySig);
  probe.addTimeSignature(score.meta.timeSig);
  return Math.max(40, probe.getNoteStartX() - probe.getX());
}

function pick(score: Score, name: VoiceName, index: number): Measure {
  return (name === 'treble' ? score.treble : score.bass)[index];
}

function buildStave(
  measure: Measure,
  prev: Measure | null,
  plan: MeasurePlan,
  name: VoiceName,
  x: number,
  y: number,
  info: { lastOfPiece: boolean },
): Stave {
  const stave = new Stave(x, y, plan.width);

  if (plan.first) {
    stave.addClef(CLEF[name]);
    if (measure.keySig) stave.addKeySignature(measure.keySig);
  } else if (prev && measure.keySig !== prev.keySig && measure.keySig) {
    stave.addKeySignature(measure.keySig);
  }

  if (!prev || measure.timeSig !== prev.timeSig) {
    stave.addTimeSignature(measure.timeSig);
  }

  if (!plan.first) stave.setBegBarType(Barline.type.NONE);
  if (measure.beginRepeat) stave.setBegBarType(Barline.type.REPEAT_BEGIN);

  stave.setEndBarType(endBarOf(measure, info.lastOfPiece));
  return stave;
}

function endBarOf(measure: Measure, lastOfPiece: boolean): number {
  switch (measure.barType) {
    case 'double': return Barline.type.DOUBLE;
    case 'end': return Barline.type.END;
    case 'repeatEnd': return Barline.type.REPEAT_END;
    case 'repeatBegin':
    case 'single':
    default: return lastOfPiece ? Barline.type.END : Barline.type.SINGLE;
  }
}

/** VexFlow's beam-group table spells common and cut time in lowercase. */
function beamTime(timeSig: string): string {
  if (timeSig === 'C') return '4/4';
  if (timeSig === 'C|') return '2/2';
  return timeSig;
}

/** A bar's notes, with the accidentals its running state says to print. */
function buildNotes(measure: Measure, name: VoiceName): StaveNote[] {
  const accidentals = barAccidentals(measure.events, measure.keySig);
  return measure.events.map((e, i) => buildNote(e, name, measure, accidentals[i]!.printed));
}

function buildNote(event: NoteEvent, name: VoiceName, measure: Measure, printed: string[]): StaveNote {
  const wholeBar = event.rest && measure.events.length === 1;
  const note = new StaveNote({
    keys: event.rest ? [REST_KEY[name]] : event.keys,
    duration: event.duration + (event.rest ? 'r' : ''),
    clef: CLEF[name],
    dots: event.dots,
    autoStem: true,
    alignCenter: wholeBar,
  });

  for (let d = 0; d < event.dots; d++) Dot.buildAndAttach([note], { all: true });

  printed.forEach((a, i) => {
    if (a) note.addModifier(new Accidental(a), i);
  });

  return note;
}

/**
 * VexFlow's SVGContext writes unitless width/height and its scale() compounds
 * across calls. We recreate the renderer every pass, but still pin the attributes
 * by hand so the SVG sizes predictably inside a flex/scroll container.
 */
/**
 * Force the whole engraving to one ink colour. VexFlow elements (stems, beams,
 * flags, barlines) carry their own default-black styles that ignore the context's
 * fill/stroke, so themed rendering has to repaint the finished SVG. The score is
 * strictly monochrome, which makes a blanket rewrite safe.
 */
function inkSvg(mount: HTMLElement, ink: string): void {
  const svg = mount.querySelector('svg');
  if (!svg) return;
  for (const el of svg.querySelectorAll<SVGElement>('*')) {
    const fill = el.getAttribute('fill');
    if (fill !== 'none') el.setAttribute('fill', ink);
    const stroke = el.getAttribute('stroke');
    if (stroke && stroke !== 'none') el.setAttribute('stroke', ink);
    // Inline style wins over attributes when present, so mirror it there too.
    if (el.style.fill && el.style.fill !== 'none') el.style.fill = ink;
    if (el.style.stroke && el.style.stroke !== 'none') el.style.stroke = ink;
  }
}

function hardenSvg(mount: HTMLElement, width: number, height: number): void {
  const svg = mount.querySelector('svg');
  if (!svg) return;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  svg.style.overflow = 'visible';
}
