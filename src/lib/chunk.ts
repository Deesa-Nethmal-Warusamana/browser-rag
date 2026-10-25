import type { ChunkRecord, ParsedDoc } from './types';

/** Soft target for a chunk, in characters (~225 tokens). */
const TARGET = 900;
/** Chunks shorter than this get merged into the previous one. */
const MIN_CHUNK = 250;
/** Character budget of the context tail carried into the next chunk's embedding. */
const OVERLAP = 160;

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;

interface Block {
  text: string;
  section: string;
  heading: boolean;
}

export interface RawChunk {
  text: string;
  section: string;
  page: number;
  ordinal: number;
}

/**
 * Split a document into blocks on blank lines, tracking the markdown heading
 * hierarchy so every block knows which section it belongs to.
 */
export function splitBlocks(text: string): Block[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  const pieces = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const blocks: Block[] = [];
  const stack: { level: number; text: string }[] = [];
  let section = '';

  for (const piece of pieces) {
    const match = piece.includes('\n') ? null : piece.match(HEADING_RE);
    if (match) {
      const level = match[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: match[2].trim() });
      section = stack.map((s) => s.text).join(' › ');
      blocks.push({ text: piece, section, heading: true });
    } else {
      blocks.push({ text: piece, section, heading: false });
    }
  }
  return blocks;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(\[])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split an over-long paragraph into pieces no larger than `max` characters. */
export function splitLongBlock(text: string, max = TARGET): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let buf = '';
  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      if (buf) {
        out.push(buf.trim());
        buf = '';
      }
      for (let i = 0; i < sentence.length; i += max) {
        out.push(sentence.slice(i, i + max).trim());
      }
      continue;
    }
    if (buf.length + sentence.length + 1 > max && buf) {
      out.push(buf.trim());
      buf = '';
    }
    buf += (buf ? ' ' : '') + sentence;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function overlapTail(text: string, size: number): string {
  if (text.length <= size) return text;
  const slice = text.slice(text.length - size);
  const space = slice.indexOf(' ');
  return space === -1 ? slice : slice.slice(space + 1).trim();
}

/** Chunk a single page, preserving page numbers for citations. */
export function chunkPage(text: string, page: number, startOrdinal = 0): RawChunk[] {
  const blocks = splitBlocks(text);
  const chunks: RawChunk[] = [];
  let buf = '';
  let section = '';
  let ordinal = startOrdinal;

  const flush = () => {
    const body = buf.trim();
    buf = '';
    if (!body) return;
    if (body.length < MIN_CHUNK && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      prev.text = `${prev.text}\n\n${body}`.trim();
      return;
    }
    chunks.push({ text: body, section, page, ordinal: ordinal++ });
  };

  for (const block of blocks) {
    if (block.heading) {
      if (buf.trim().length >= MIN_CHUNK) flush();
      section = block.section;
      buf += (buf ? '\n\n' : '') + block.text;
      continue;
    }
    if (block.section) section = block.section;
    for (const part of splitLongBlock(block.text, TARGET)) {
      if (buf.length + part.length + 2 > TARGET * 1.15 && buf.trim()) flush();
      buf += (buf ? '\n\n' : '') + part;
      if (buf.length >= TARGET) flush();
    }
  }
  flush();
  return chunks;
}

/** Turn a parsed document into embeddable chunk records. */
export function chunkDoc(doc: ParsedDoc): ChunkRecord[] {
  const records: ChunkRecord[] = [];
  const pages = doc.pages.length > 0 ? doc.pages : [{ page: 1, text: '' }];
  let ordinal = 0;

  for (const page of pages) {
    const rawChunks = chunkPage(page.text, page.page, ordinal);
    for (const raw of rawChunks) {
      const previous = records.length > 0 ? records[records.length - 1].text : '';
      const tail = previous ? overlapTail(previous, OVERLAP) : '';
      const prefix = raw.section ? `${raw.section}\n` : '';
      const embedText = `${prefix}${tail ? `${tail}\n…\n` : ''}${raw.text}`;

      records.push({
        id: `${doc.docId}:${raw.ordinal}`,
        docId: doc.docId,
        docTitle: doc.title,
        sourceName: doc.sourceName,
        ordinal: raw.ordinal,
        page: raw.page,
        section: raw.section,
        text: raw.text,
        embedText,
      });
      ordinal = raw.ordinal + 1;
    }
  }
  return records;
}
