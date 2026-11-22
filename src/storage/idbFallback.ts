/**
 * Lightweight IndexedDB blob fallback used ONLY when OPFS is unavailable
 * (for example, in Private Browsing mode).
 *
 * Stored in its own separate database (`StudyNotesBlobFallbackDB`) so the main
 * `StudyNotesDB` v1 Dexie schema never has to change.
 */

const FALLBACK_DB_NAME = 'StudyNotesBlobFallbackDB';
const STORE_NAME = 'files';

interface StoredBlobEntry {
  key: string; // `${dirName}/${fileName}`
  dirName: string;
  fileName: string;
  blob: Blob;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openFallbackDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(FALLBACK_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('dirName', 'dirName', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB fallback open failed'));
    });
  }
  return dbPromise;
}

function makeKey(dirName: string, fileName: string): string {
  return `${dirName}/${fileName}`;
}

export async function idbPutFile(
  dirName: string,
  fileName: string,
  blob: Blob
): Promise<void> {
  const db = await openFallbackDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      key: makeKey(dirName, fileName),
      dirName,
      fileName,
      blob,
      updatedAt: Date.now(),
    } satisfies StoredBlobEntry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB fallback write failed'));
  });
}

export async function idbGetFile(
  dirName: string,
  fileName: string
): Promise<File | null> {
  const db = await openFallbackDb();
  const entry = await new Promise<StoredBlobEntry | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(makeKey(dirName, fileName));
    req.onsuccess = () => resolve(req.result as StoredBlobEntry | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!entry) return null;
  return new File([entry.blob], fileName, {
    type: entry.blob.type || 'application/octet-stream',
    lastModified: entry.updatedAt,
  });
}

export async function idbDeleteFile(
  dirName: string,
  fileName: string
): Promise<void> {
  const db = await openFallbackDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(makeKey(dirName, fileName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbListDir(dirName: string): Promise<string[]> {
  const db = await openFallbackDb();
  const entries = await new Promise<StoredBlobEntry[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('dirName');
    const req = index.getAll(dirName);
    req.onsuccess = () => resolve((req.result as StoredBlobEntry[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  return entries.map((e) => e.fileName);
}

export async function idbClearDir(dirName: string): Promise<void> {
  const names = await idbListDir(dirName);
  for (const name of names) {
    await idbDeleteFile(dirName, name);
  }
}

export async function idbTotalBytes(): Promise<number> {
  try {
    const db = await openFallbackDb();
    const entries = await new Promise<StoredBlobEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as StoredBlobEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0);
  } catch {
    return 0;
  }
}
