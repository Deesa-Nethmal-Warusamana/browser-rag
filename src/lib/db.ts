import { openDB, type IDBPDatabase } from 'idb';
import type { ChunkRecord } from './types';

export interface StoredDoc {
  docId: string;
  title: string;
  sourceName: string;
  chunkCount: number;
  addedAt: number;
  model: string;
  dims: number;
  chunks: ChunkRecord[];
  vectors: ArrayBuffer;
}

const DB_NAME = 'browser-rag';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function openRagDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('docs')) {
          db.createObjectStore('docs', { keyPath: 'docId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function loadStoredDocs(): Promise<StoredDoc[]> {
  const db = await openRagDb();
  return (await db.getAll('docs')) as StoredDoc[];
}

export async function saveStoredDoc(doc: StoredDoc): Promise<void> {
  const db = await openRagDb();
  await db.put('docs', doc);
}

export async function deleteStoredDoc(docId: string): Promise<void> {
  const db = await openRagDb();
  await db.delete('docs', docId);
}

export async function clearStoredDocs(): Promise<void> {
  const db = await openRagDb();
  await db.clear('docs');
}
