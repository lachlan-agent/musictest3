/**
 * A small PDF writer: one 8-bit greyscale image per page, Flate-compressed.
 *
 * The score is engraved with web fonts (VexFlow 5 draws its glyphs as text in
 * Bravura), which a vector PDF would have to embed; rasterising each page at
 * print resolution sidesteps that with no dependency, and compresses well —
 * a page is mostly white. The output is PDF 1.4, readable by anything.
 */

export interface PdfPage {
  /** Pixel dimensions of the image. */
  width: number;
  height: number;
  /** One byte per pixel, row-major, 0 = black; zlib-deflated when `compressed`. */
  data: Uint8Array;
  compressed: boolean;
}

export interface PdfOptions {
  /** Page size in points (1/72 in). */
  pageWidth: number;
  pageHeight: number;
  title?: string;
}

/** A4 and US Letter in points. */
export const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const;
export type PageSize = keyof typeof PAGE_SIZES;

/** Greyscale pixels of a canvas: the red channel, since the score is black on white. */
export function grayOf(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = data[i]!;
  return gray;
}

/** A canvas as a finished page: greyscale and already compressed, so the canvas can go. */
export async function pdfPageOf(canvas: HTMLCanvasElement): Promise<PdfPage> {
  const { data, compressed } = await deflate(grayOf(canvas));
  return { width: canvas.width, height: canvas.height, data, compressed };
}

async function deflate(bytes: Uint8Array): Promise<{ data: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') return { data: bytes, compressed: false };
  // 'deflate' is zlib-wrapped, which is what FlateDecode expects.
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  const data = new Uint8Array(await new Response(stream).arrayBuffer());
  return { data, compressed: true };
}

const encoder = new TextEncoder();

/** Only ASCII survives a plain PDF string; anything else is escaped or dropped. */
function pdfString(text: string): string {
  const safe = text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`);
  return `(${safe})`;
}

export async function makePdf(pages: PdfPage[], opts: PdfOptions): Promise<Blob> {
  const chunks: (Uint8Array | string)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string): void => {
    chunks.push(part);
    length += typeof part === 'string' ? encoder.encode(part).length : part.length;
  };
  const object = (n: number, body: Uint8Array | string): void => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    push(body);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

  // Object numbering: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageIds = pages.map((_, i) => 4 + i * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  object(3, `<< /Producer (musicTest3) /Creator (musicTest3) /CreationDate (D:${stamp})${opts.title ? ` /Title ${pdfString(opts.title)}` : ''} >>`);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const [pageId, contentId, imageId] = [pageIds[i]!, pageIds[i]! + 1, pageIds[i]! + 2];
    const { data, compressed } = page;
    const w = opts.pageWidth.toFixed(2);
    const h = opts.pageHeight.toFixed(2);
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[imageId] = length;
    push(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceGray /BitsPerComponent 8${compressed ? ' /Filter /FlateDecode' : ''} /Length ${data.length} >>\nstream\n`);
    push(data);
    push('\nendstream\nendobj\n');
  }

  const count = offsets.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c)) as BlobPart[], { type: 'application/pdf' });
}
