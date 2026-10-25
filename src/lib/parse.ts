import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { sha256Hex } from './hash';
import type { ParsedDoc } from './types';

const TEXT_EXTENSIONS = /\.(txt|md|markdown|text|csv|json|log|ya?ml|html?|tsx?|jsx?|py|go|rs|java|rb|sh|toml)$/i;

export function isSupportedFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.type.startsWith('text/') ||
    /\.pdf$/i.test(file.name) ||
    TEXT_EXTENSIONS.test(file.name)
  );
}

async function parsePdf(file: File): Promise<{ page: number; text: string }[]> {
  const data = await file.arrayBuffer();
  // Drive pdf.js through an explicit worker port built by Vite. Importing the
  // worker as a URL string works in dev but breaks in the bundle, and without a
  // worker pdf.js silently falls back to synchronous parsing on the main thread.
  const worker = new PdfWorker();
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const loadingTask = pdfjs.getDocument({ data });
  const pages: { page: number; text: string }[] = [];

  try {
    const pdf = await loadingTask.promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push({
        page: pageNumber,
        text: text
          .split('\n')
          .map((line) => line.replace(/[ \t]+/g, ' ').trim())
          .filter(Boolean)
          .join('\n'),
      });
    }
  } finally {
    await loadingTask.destroy();
    pdfjs.GlobalWorkerOptions.workerPort = null;
    worker.terminate();
  }

  return pages;
}

function titleFromFilename(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || name
  );
}

/** Parse a dropped file into pages of plain text. */
export async function parseFile(file: File): Promise<ParsedDoc> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const pages = isPdf ? await parsePdf(file) : [{ page: 1, text: await file.text() }];
  const combined = pages.map((p) => p.text).join('\n\n');

  if (combined.trim().length < 20) {
    throw new Error(
      isPdf
        ? 'No selectable text in this PDF — it is probably a scan. OCR is not wired up yet.'
        : 'File appears to be empty.',
    );
  }

  return {
    docId: (await sha256Hex(combined)).slice(0, 16),
    title: titleFromFilename(file.name),
    sourceName: file.name,
    mime: file.type || 'text/plain',
    pages,
  };
}
