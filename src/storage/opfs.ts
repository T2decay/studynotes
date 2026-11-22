/**
 * Origin Private File System (OPFS) helper for StudyNotes.
 *
 * OPFS stores large binary files (PDFs, imported photos, and pre-restore safety
 * snapshots) directly on the iPad's disk outside of IndexedDB, keeping memory
 * usage low and allowing chunked streaming reads and writes.
 */

export type OpfsDirName = 'assets' | 'safety' | 'exports' | 'assets_staging';

export interface OpfsChunkWriter {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
  getFile: () => Promise<File>;
}

export interface StorageStatus {
  persisted: boolean;
  opfsAvailable: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

const COPY_CHUNK_SIZE = 512 * 1024; // 512 KB chunks keep iPad RAM flat

/** Asks iPadOS / Safari to mark this app's storage as persistent (less likely to be evicted). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist();
    }
  } catch {
    // Some browsers disallow persist() in private browsing; fail quietly.
  }
  return false;
}

/** Checks whether OPFS is supported and writable in this browser context. */
export async function isOpfsAvailable(): Promise<boolean> {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      return false;
    }
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

/** Returns persistence, OPFS availability, and estimated storage usage for Settings. */
export async function getStorageStatus(): Promise<StorageStatus> {
  let persisted = false;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  const opfsAvailable = await isOpfsAvailable();

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
      usageBytes = typeof est.usage === 'number' ? est.usage : null;
      quotaBytes = typeof est.quota === 'number' ? est.quota : null;
    }
  } catch {
    // Ignore
  }

  return { persisted, opfsAvailable, usageBytes, quotaBytes };
}

async function getSubdir(
  dirName: OpfsDirName,
  create = true
): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(dirName, { create });
  } catch {
    return null;
  }
}

/**
 * Opens a streaming chunk writer for a file inside OPFS.
 * Returns null if OPFS or `createWritable()` is not available.
 */
export async function createOpfsChunkWriter(
  dirName: OpfsDirName,
  fileName: string
): Promise<OpfsChunkWriter | null> {
  const dir = await getSubdir(dirName, true);
  if (!dir) return null;

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  if (typeof fileHandle.createWritable !== 'function') {
    return null;
  }

  const writable = await fileHandle.createWritable();
  let closed = false;

  return {
    async write(chunk: Uint8Array) {
      // Pass a clean ArrayBuffer-backed Uint8Array for strict DOM/WebKit compatibility
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      await writable.write(copy);
    },
    async close() {
      if (!closed) {
        closed = true;
        await writable.close();
      }
    },
    async abort() {
      if (!closed) {
        closed = true;
        try {
          await writable.abort();
        } catch {
          // Ignore abort errors
        }
      }
      await deleteOpfsFile(dirName, fileName);
    },
    async getFile() {
      return fileHandle.getFile();
    },
  };
}

/** Reads an OPFS file handle as a disk-backed File (can be sliced in chunks without loading into RAM). */
export async function readOpfsFile(
  dirName: OpfsDirName,
  fileName: string
): Promise<File | null> {
  try {
    const dir = await getSubdir(dirName, false);
    if (!dir) return null;
    const handle = await dir.getFileHandle(fileName, { create: false });
    return await handle.getFile();
  } catch {
    return null;
  }
}

/** Deletes a single file from an OPFS subdirectory if it exists. */
export async function deleteOpfsFile(
  dirName: OpfsDirName,
  fileName: string
): Promise<void> {
  try {
    const dir = await getSubdir(dirName, false);
    if (!dir) return;
    await dir.removeEntry(fileName);
  } catch {
    // File didn't exist — nothing to delete
  }
}

/** Lists all file names inside an OPFS subdirectory. */
export async function listOpfsDir(dirName: OpfsDirName): Promise<string[]> {
  try {
    const dir = await getSubdir(dirName, false);
    if (!dir) return [];
    const names: string[] = [];
    // TypeScript's DOM lib types for async directory iteration vary slightly by version
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

/** Removes all files inside an OPFS subdirectory. */
export async function clearOpfsDir(dirName: OpfsDirName): Promise<void> {
  try {
    const dir = await getSubdir(dirName, false);
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
 * Replaces OPFS `/assets/` with the files restored into `/assets_staging/`.
 * Uses chunked copies (512 KB at a time) rather than `move()` for full iPadOS Safari compatibility.
 */
export async function commitStagedAssets(expectedAssetIds: Set<string>): Promise<void> {
  const opfsReady = await isOpfsAvailable();
  if (!opfsReady) return;

  // 1. Copy each staged asset into /assets/ in chunks
  const stagedNames = await listOpfsDir('assets_staging');
  for (const name of stagedNames) {
    const srcFile = await readOpfsFile('assets_staging', name);
    if (!srcFile) continue;

    const writer = await createOpfsChunkWriter('assets', name);
    if (!writer) {
      throw new Error('Device file storage is not writable.');
    }

    try {
      for (let offset = 0; offset < srcFile.size; offset += COPY_CHUNK_SIZE) {
        const buffer = await srcFile
          .slice(offset, Math.min(offset + COPY_CHUNK_SIZE, srcFile.size))
          .arrayBuffer();
        await writer.write(new Uint8Array(buffer));
      }
      await writer.close();
    } catch (err) {
      await writer.abort();
      throw err;
    }
  }

  // 2. Delete any leftover old assets that are not in the restored backup
  const existingAssets = await listOpfsDir('assets');
  for (const name of existingAssets) {
    if (!expectedAssetIds.has(name)) {
      await deleteOpfsFile('assets', name);
    }
  }

  // 3. Clean up the staging folder
  await clearOpfsDir('assets_staging');
}
