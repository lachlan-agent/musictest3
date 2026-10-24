// Pure system layout: how many measures fit on a line, and how wide each one is.
// No DOM, no VexFlow — just arithmetic, so it can be reasoned about (and tested)
// on its own. The natural widths it consumes are measured by the renderer, which
// asks VexFlow how much room each bar's notes actually need.

export interface MeasurePlan {
  index: number;
  x: number;
  width: number;
  /** First measure of its system: gets clef + key signature reprinted. */
  first: boolean;
}

export interface SystemPlan {
  measures: MeasurePlan[];
  width: number;
}

export interface LayoutOptions {
  /** Usable width for staves, i.e. container width minus padding and brace room. */
  contentWidth: number;
  /** Width the first measure of a system needs for clef + signatures. */
  headerWidth: number;
  /** Breathing room added to every measure's measured note width. */
  padding: number;
  /** Floor on a measure's width, so an empty bar is still legible. */
  minWidth: number;
  maxPerSystem: number;
}

export const DEFAULT_LAYOUT: Omit<LayoutOptions, 'contentWidth' | 'headerWidth'> = {
  padding: 30,
  minWidth: 60,
  /** No cap of its own: how many bars share a line is a matter of width. */
  maxPerSystem: Infinity,
};

/** How far a system may be stretched past its natural width to fill the page. */
const MAX_STRETCH = 3;
/** The final system stretches less, so a lone trailing bar isn't blown up. */
const MAX_STRETCH_LAST = 1.6;

/**
 * @param naturalWidths one entry per measure: the width VexFlow says its notes
 * need, before padding. Systems are justified to `contentWidth`; a system whose
 * natural width already exceeds the page is compressed instead. A measure that
 * cannot fit even alone gets its own system.
 */
export function planSystems(naturalWidths: number[], opts: LayoutOptions): SystemPlan[] {
  const natural = naturalWidths.map((w) => Math.max(opts.minWidth, w + opts.padding));
  const systems: SystemPlan[] = [];

  let i = 0;
  while (i < natural.length) {
    const rowIdx: number[] = [];
    let used = opts.headerWidth;

    while (i < natural.length && rowIdx.length < opts.maxPerSystem) {
      const w = natural[i];
      if (rowIdx.length > 0 && used + w > opts.contentWidth) break;
      rowIdx.push(i);
      used += w;
      i += 1;
    }

    systems.push({
      measures: rowIdx.map((idx) => ({ index: idx, x: 0, width: natural[idx], first: false })),
      width: used,
    });
  }

  const last = systems.length - 1;
  const available = Math.max(opts.minWidth, opts.contentWidth - opts.headerWidth);

  systems.forEach((sys, si) => {
    const raw = sys.measures.reduce((s, m) => s + m.width, 0);
    const fit = available / Math.max(1, raw);
    // A short final row is only a leftover when something precedes it; a piece
    // that fits on one system should still fill the page.
    const leftover = si === last && systems.length > 1;
    const scale = Math.min(leftover ? MAX_STRETCH_LAST : MAX_STRETCH, fit);

    let x = 0;
    sys.measures.forEach((m, mi) => {
      m.first = mi === 0;
      m.width = Math.max(opts.minWidth, Math.round(m.width * scale)) + (mi === 0 ? opts.headerWidth : 0);
      m.x = x;
      x += m.width;
    });
    sys.width = x;
  });

  return systems;
}
