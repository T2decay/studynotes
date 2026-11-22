/**
 * On-device binary file storage for StudyNotes (PDFs, photos, and backups).
 *
 * Storage strategy (built for iPadOS Safari / WebKit reliability):
 * 1. Primary: Origin Private File System (OPFS) written via `createSyncAccessHandle()`
 *    inside a dedicated Web Worker (`opfsWorker.ts`). This works natively on iPadOS
 *    Safari, macOS Safari, Chrome, and Firefox without relying on main-thread
 *    `createWritable()` (which iPadOS Safari does not support).
 * 2. Fallback: If OPFS is unavailable (e.g. Private Browsing), transparently stores
 *    blobs in a separate IndexedDB store (`StudyNotesBlobFallbackDB`).
 */

import { db } from '../db/database';
import {
  idbClearDir,
  idbDeleteFile,
  idbGetFile,
  idbListDir,
  idbPutFile,
  idbTotalBytes,
} from './idbFallback';

export type OpfsDirName = 'assets' | 'safety' | 'exports' | 'assets_staging';
export type StorageBackendKind = 'opfs' | 'indexeddb';

export interface OpfsChunkWriter {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
  getFile: () => Promise<File>;
}

export interface StorageStatus {
  persisted: boolean;
  storageBackend: StorageBackendKind;
  usageBytes: number;
  quotaBytes: number | null;
}

interface WorkerResponse {
  reqId: number;
  ok: boolean;
  error?: string;
}

let workerInstance: Worker | null = null;
let nextReqId = 1;
let nextSessionId = 1;
const pendingRequests = new Map<
  number,
  { resolve: () => void; reject: (err: Error) => void }
>();
let backendDetectionPromise: Promise<StorageBackendKind> | null = null;

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./opfsWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { reqId, ok, error } = event.data;
      const pending = pendingRequests.get(reqId);
      if (!pending) return;
      pendingRequests.delete(reqId);
      if (ok) {
        pending.resolve();
      } else {
        pending.reject(new Error(error || 'OPFS worker operation failed'));
      }
    };
    workerInstance.onerror = (event) => {
      const err = new Error(event.message || 'OPFS worker error');
      for (const [, pending] of pendingRequests) {
        pending.reject(err);
      }
      pendingRequests.clear();
    };
  }
  return workerInstance;
}

function callWorker(
  payload: Record<string, unknown>,
  transfer?: Transferable[]
): Promise<void> {
  const reqId = nextReqId++;
  const worker = getWorker();
  return new Promise<void>((resolve, reject) => {
    pendingRequests.set(reqId, { resolve, reject });
    worker.postMessage({ ...payload, reqId }, transfer ?? []);
  });
}

/**
 * Probes OPFS once by writing and removing a 4-byte test file via the Web Worker.
 * Caches the result (`'opfs'` or `'indexeddb'`) for the rest of the session.
 */
export function getStorageBackend(): Promise<StorageBackendKind> {
  if (!backendDetectionPromise) {
    backendDetectionPromise = (async () => {
      try {
        if (
          typeof Worker === 'undefined' ||
          !navigator.storage ||
          typeof navigator.storage.getDirectory !== 'function'
        ) {
          return 'indexeddb';
        }
        await callWorker({ op: 'probe' });
        return 'opfs';
      } catch {
        return 'indexeddb';
      }
    })();
  }
  return backendDetectionPromise;
}

/** Asks iPadOS / Safari to mark this app's storage as persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    // Ignore in contexts that disallow persist()
  }
  return false;
}

/**
 * Returns storage protection status, active engine (OPFS vs IndexedDB), and a
 * reliable on-device usage number (never "Unavailable" on iPadOS Safari).
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  let persisted = false;
  let browserUsage: number | null = null;
  let quotaBytes: number | null = null;

  const storageBackend = await getStorageBackend();

  try {
    if (navigator.storage && typeof navigator.storage.persisted === 'function') {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    // Ignore
  }

  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && Number.isFinite(est.usage)) {
        browserUsage = est.usage;
      }
      if (typeof est.quota === 'number' && Number.isFinite(est.quota) && est.quota > 0) {
        quotaBytes = est.quota;
      }
    }
  } catch {
    // Some iPadOS Safari standalone contexts reject or omit estimate(); fall back below
  }

  // Always measure our actual stored app data (IndexedDB tables + binary files)
  // so Settings displays an accurate number even if Safari omits navigator.storage.estimate()
  const measuredBytes = await measureAppDataBytes(storageBackend);
  const usageBytes =
    browserUsage !== null && browserUsage > measuredBytes
      ? browserUsage
      : measuredBytes;

  return { persisted, storageBackend, usageBytes, quotaBytes };
}

async function measureAppDataBytes(backend: StorageBackendKind): Promise<number> {
  let total = 0;

  // 1. Measure IndexedDB metadata (folders, notes, pages, strokes, assets, settings)
  try {
    const [folders, notes, pages, strokes, assets, settings] = await Promise.all([
      db.folders.toArray(),
      db.notes.toArray(),
      db.pages.toArray(),
      db.strokes.toArray(),
      db.assets.toArray(),
      db.settings.toArray(),
    ]);
    const json = JSON.stringify({ folders, notes, pages, strokes, assets, settings });
    total += new TextEncoder().encode(json).byteLength;
  } catch {
    // Ignore
  }

  // 2. Measure stored binary files in OPFS (or IndexedDB fallback)
  if (backend === 'opfs') {
    const dirs: OpfsDirName[] = ['assets', 'safety', 'exports'];
    for (const dirName of dirs) {
      const names = await listOpfsDir(dirName);
      for (const name of names) {
        const file = await readOpfsFile(dirName, name);
        if (file) total += file.size;
      }
    }
  } else {
    total += await idbTotalBytes();
  }

  return total;
}

async function getOpfsSubdir(
  dirName: OpfsDirName,
  create = true
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(dirName, { create });
  } catch {
    return null;
  }
}

/**
 * Opens a streaming chunk writer for a file inside OPFS (via Web Worker
 * `createSyncAccessHandle`) or the IndexedDB blob fallback if OPFS is unavailable.
 */
export async function createOpfsChunkWriter(
  dirName: OpfsDirName,
  fileName: string
): Promise<OpfsChunkWriter> {
  const backend = await getStorageBackend();

  if (backend === 'opfs') {
    const sessionId = nextSessionId++;
    await callWorker({ op: 'openWrite', sessionId, dirName, fileName });
    let closed = false;

    return {
      async write(chunk: Uint8Array) {
        // Copy into a standalone transferable ArrayBuffer so the worker gets zero-copy ownership
        const buffer = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(buffer).set(chunk);
        await callWorker({ op: 'writeChunk', sessionId, buffer }, [buffer]);
      },
      async close() {
        if (!closed) {
          closed = true;
          await callWorker({ op: 'closeWrite', sessionId });
        }
      },
      async abort() {
        if (!closed) {
          closed = true;
          await callWorker({ op: 'abortWrite', sessionId }).catch(() => {});
        }
      },
      async getFile() {
        const file = await readOpfsFile(dirName, fileName);
        if (!file) {
          throw new Error('Could not read back saved file from device storage.');
        }
        return file;
      },
    };
  }

  // Fallback: collect chunks and save as a Blob in StudyNotesBlobFallbackDB
  const chunks: BlobPart[] = [];
  let closed = false;

  return {
    async write(chunk: Uint8Array) {
      const buffer = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buffer).set(chunk);
      chunks.push(buffer);
    },
    async close() {
      if (!closed) {
        closed = true;
        await idbPutFile(dirName, fileName, new Blob(chunks));
        chunks.length = 0;
      }
    },
    async abort() {
      closed = true;
      chunks.length = 0;
      await idbDeleteFile(dirName, fileName).catch(() => {});
    },
    async getFile() {
      const file = await idbGetFile(dirName, fileName);
      if (!file) {
        throw new Error('Could not read back saved file from device storage.');
      }
      return file;
    },
  };
}

/** Reads a stored file as a disk-backed File (sliceable in 512 KB chunks). */
export async function readOpfsFile(
  dirName: OpfsDirName,
  fileName: string
): Promise<File | null> {
  const backend = await getStorageBackend();
  if (backend === 'indexeddb') {
    return idbGetFile(dirName, fileName);
  }

  try {
    const dir = await getOpfsSubdir(dirName, false);
    if (!dir) return null;
    const handle = await dir.getFileHandle(fileName, { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

/** Deletes a single file from storage if it exists. */
export async function deleteOpfsFile(
  dirName: OpfsDirName,
  fileName: string
): Promise<void> {
  const backend = await getStorageBackend();
  if (backend === 'indexeddb') {
    await idbDeleteFile(dirName, fileName).catch(() => {});
    return;
  }

  try {
    const dir = await getOpfsSubdir(dirName, false);
    if (!dir) return;
    await dir.removeEntry(fileName);
  } catch {
    // Already missing
  }
}

/** Lists all file names inside a storage subdirectory. */
export async function listOpfsDir(dirName: OpfsDirName): Promise<string[]> {
  const backend = await getStorageBackend();
  if (backend === 'indexeddb') {
    return idbListDir(dirName);
  }

  try {
    const dir = await getOpfsSubdir(dirName, false);
    if (!dir) return [];
    const names: string[] = [];
    const iterable = dir as unknown as {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of iterable.entries()) {
      if (handle.kind === 'file') {
        names.push(name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Removes all files inside a storage subdirectory. */
export async function clearOpfsDir(dirName: OpfsDirName): Promise<void> {
  const backend = await getStorageBackend();
  if (backend === 'indexeddb') {
    await idbClearDir(dirName).catch(() => {});
    return;
  }

  try {
    const dir = await getOpfsSubdir(dirName, false);
    if (!dir) return;
    const names = await listOpfsDir(dirName);
    for (const name of names) {
      await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    // Ignore
  }
}

/**
 * Moves staged assets from `/assets_staging/` into `/assets/` using chunked
 * worker copies (never relies on main-thread `createWritable()` or `move()`).
 */
export async function commitStagedAssets(expectedAssetIds: Set<string>): Promise<void> {
  const backend = await getStorageBackend();
  const stagedNames = await listOpfsDir('assets_staging');

  for (const name of stagedNames) {
    if (backend === 'opfs') {
      await callWorker({
        op: 'copyFile',
        srcDir: 'assets_staging',
        srcName: name,
        destDir: 'assets',
        destName: name,
      });
    } else {
      const file = await idbGetFile('assets_staging', name);
      if (file) {
        await idbPutFile('assets', name, file);
      }
    }
  }

  // Delete any old assets that are not present in the restored backup
  const existingAssets = await listOpfsDir('assets');
  for (const name of existingAssets) {
    if (!expectedAssetIds.has(name)) {
      await deleteOpfsFile('assets', name);
    }
  }

  await clearOpfsDir('assets_staging');
}
