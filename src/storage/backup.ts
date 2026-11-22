import {
  Zip,
  ZipDeflate,
  ZipPassThrough,
  Unzip,
  UnzipInflate,
  strToU8,
  strFromU8,
} from 'fflate';
import { APP_VERSION, DB_SCHEMA_VERSION, db } from '../db/database';
import { SETTING_KEYS, setSetting } from '../db/settings';
import {
  clearOpfsDir,
  commitStagedAssets,
  createOpfsChunkWriter,
  deleteOpfsFile,
  readOpfsFile,
  type OpfsChunkWriter,
} from './opfs';
import type {
  BackupDatabaseDump,
  BackupInspection,
  BackupManifest,
  BackupProgress,
} from '../types/models';

const BACKUP_FORMAT = 'studynotes-backup';
const SAFETY_SNAPSHOT_FILENAME = 'pre-restore-backup.studynotes.zip';
const STREAM_CHUNK_SIZE = 512 * 1024; // 512 KB chunks keep iPad RAM low during big backups

export interface BackupSizeEstimate {
  estimatedBytes: number;
  metadataBytes: number;
  assetsBytes: number;
  folderCount: number;
  noteCount: number;
  pageCount: number;
  assetCount: number;
}

export type ExportBackupResult =
  | { status: 'shared'; fileName: string; byteSize: number }
  | { status: 'downloaded'; fileName: string; byteSize: number }
  | { status: 'cancelled' }
  | { status: 'ready_to_share'; file: File; fileName: string; byteSize: number };

/** Formats byte counts into readable strings like "1.4 KB", "18.2 MB", or "1.12 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

/**
 * Estimates the size of the `.studynotes.zip` backup file.
 * - JSON metadata compresses well (~40% of raw UTF-8 size)
 * - PDFs & images are stored at ZIP level 0 (no recompression), so their exact
 *   byteSize is added 1:1 plus ~120 bytes of ZIP header overhead per file.
 */
export async function estimateBackupSize(): Promise<BackupSizeEstimate> {
  const [folders, notes, pages, strokes, assets, settings] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.pages.toArray(),
    db.strokes.toArray(),
    db.assets.toArray(),
    db.settings.toArray(),
  ]);

  const rawJson = JSON.stringify({ folders, notes, pages, strokes, assets, settings });
  const rawJsonBytes = strToU8(rawJson).byteLength;
  const estimatedMetadataBytes = Math.max(400, Math.round(rawJsonBytes * 0.45));
  const assetsBytes = assets.reduce((sum, asset) => sum + (asset.byteSize || 0), 0);
  const zipHeaderOverhead = (assets.length + 2) * 120;

  return {
    estimatedBytes: estimatedMetadataBytes + assetsBytes + zipHeaderOverhead,
    metadataBytes: estimatedMetadataBytes,
    assetsBytes,
    folderCount: folders.length,
    noteCount: notes.length,
    pageCount: pages.length,
    assetCount: assets.length,
  };
}

/**
 * Builds a single-file `.studynotes.zip` archive by streaming output chunks to `onChunk`.
 *
 * Memory design for iPad:
 * - `manifest.json` and `database.json` use Deflate (level 6) for compact storage.
 * - Every PDF/photo asset in OPFS uses `ZipPassThrough` (STORE, level 0) so
 *   already-compressed media is never recompressed, and is read in 512 KB chunks
 *   with backpressure between chunks so RAM never spikes.
 */
async function streamBackupZip(
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
  onProgress?: (progress: BackupProgress) => void
): Promise<void> {
  onProgress?.({ phase: 'preparing', label: 'Reading your notes…', percent: 5 });

  const [folders, notes, pages, strokes, assets, allSettings] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.pages.toArray(),
    db.strokes.toArray(),
    db.assets.toArray(),
    db.settings.toArray(),
  ]);

  // Do not export device-local preRestoreBackupAt metadata inside user backups
  const settings = allSettings.filter(
    (entry) => entry.key !== SETTING_KEYS.preRestoreBackupAt
  );

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    schemaVersion: DB_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    counts: {
      folders: folders.length,
      notes: notes.length,
      pages: pages.length,
      strokes: strokes.length,
      assets: assets.length,
    },
  };

  const dump: BackupDatabaseDump = {
    folders,
    notes,
    pages,
    strokes,
    assets,
    settings,
  };

  let writeChain = Promise.resolve();
  let streamError: Error | null = null;

  const zip = new Zip((err, chunk) => {
    if (err) {
      streamError = err;
      return;
    }
    if (chunk && chunk.byteLength > 0) {
      // Copy slice before async write so fflate buffers cannot be mutated underneath us
      const copy = chunk.slice();
      writeChain = writeChain.then(() => onChunk(copy));
    }
  });

  const flushWrites = async () => {
    await writeChain;
    if (streamError) throw streamError;
  };

  // 1. Add manifest.json (compressed)
  onProgress?.({ phase: 'metadata', label: 'Packing folders & notes…', percent: 15 });
  const manifestEntry = new ZipDeflate('manifest.json', { level: 6 });
  zip.add(manifestEntry);
  manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true);
  await flushWrites();

  // 2. Add database.json (compressed)
  const dbEntry = new ZipDeflate('database.json', { level: 6 });
  zip.add(dbEntry);
  dbEntry.push(strToU8(JSON.stringify(dump)), true);
  await flushWrites();

  // 3. Stream every binary asset (PDFs & images) at STORE level 0 (no recompression)
  const totalAssetBytes = assets.reduce((sum, a) => sum + (a.byteSize || 0), 0);
  let processedAssetBytes = 0;

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const file = await readOpfsFile('assets', asset.id);
    if (!file) continue;

    // ZipPassThrough stores bytes as-is (ZIP method 0 / level 0)
    const assetEntry = new ZipPassThrough(`assets/${asset.id}`);
    zip.add(assetEntry);

    if (file.size === 0) {
      assetEntry.push(new Uint8Array(0), true);
      await flushWrites();
      continue;
    }

    for (let offset = 0; offset < file.size; offset += STREAM_CHUNK_SIZE) {
      const end = Math.min(offset + STREAM_CHUNK_SIZE, file.size);
      const isFinal = end >= file.size;
      const sliceBuffer = await file.slice(offset, end).arrayBuffer();
      assetEntry.push(new Uint8Array(sliceBuffer), isFinal);
      await flushWrites();

      processedAssetBytes += end - offset;
      const ratio = totalAssetBytes > 0 ? processedAssetBytes / totalAssetBytes : 1;
      onProgress?.({
        phase: 'assets',
        label: `Packing files (${i + 1} of ${assets.length})…`,
        percent: Math.min(95, Math.round(20 + ratio * 75)),
      });
    }
  }

  onProgress?.({ phase: 'finalizing', label: 'Finalizing backup file…', percent: 98 });
  zip.end();
  await flushWrites();
  onProgress?.({ phase: 'finalizing', label: 'Backup ready', percent: 100 });
}

/** Generates a backup file name like `StudyNotes-Backup-2026-11-21.studynotes.zip`. */
function buildBackupFileName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `StudyNotes-Backup-${yyyy}-${mm}-${dd}.studynotes.zip`;
}

/**
 * Exports all notes, folders, pages, strokes, and OPFS assets into a single
 * `.studynotes.zip` file and opens the iPad Share Sheet (or browser download fallback).
 */
export async function exportBackupToDevice(
  onProgress?: (progress: BackupProgress) => void
): Promise<ExportBackupResult> {
  const fileName = buildBackupFileName();

  // Prefer streaming directly to a temporary OPFS disk file so large backups stay out of RAM
  await clearOpfsDir('exports');
  const opfsWriter = await createOpfsChunkWriter('exports', fileName);

  let backupFile: File;

  if (opfsWriter) {
    try {
      await streamBackupZip((chunk) => opfsWriter.write(chunk), onProgress);
      await opfsWriter.close();
      const diskFile = await opfsWriter.getFile();
      // Wrap disk-backed File with explicit ZIP MIME type for iPadOS Share Sheet
      backupFile = new File([diskFile], fileName, { type: 'application/zip' });
    } catch (err) {
      await opfsWriter.abort();
      throw err;
    }
  } else {
    // Fallback when OPFS isn't available (e.g. private browsing)
    const chunks: BlobPart[] = [];
    await streamBackupZip((chunk) => {
      chunks.push(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
    }, onProgress);
    backupFile = new File(chunks, fileName, { type: 'application/zip' });
  }

  return shareOrDownloadBackupFile(backupFile);
}

/** Triggers the iPad Share Sheet (or browser download) for an already-built backup File. */
export async function shareOrDownloadBackupFile(
  backupFile: File
): Promise<ExportBackupResult> {
  const canUseShareSheet =
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [backupFile] });

  if (canUseShareSheet) {
    try {
      await navigator.share({
        files: [backupFile],
        title: 'StudyNotes Backup',
      });
      await setSetting(SETTING_KEYS.lastBackupAt, Date.now());
      return {
        status: 'shared',
        fileName: backupFile.name,
        byteSize: backupFile.size,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User tapped Cancel on the Share Sheet — do NOT mark as backed up
        return { status: 'cancelled' };
      }
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        // If building a very large backup took long enough for Safari's user gesture
        // to expire, return the ready file so Settings can offer a 1-tap Share button.
        return {
          status: 'ready_to_share',
          file: backupFile,
          fileName: backupFile.name,
          byteSize: backupFile.size,
        };
      }
      throw err;
    }
  }

  // Desktop browser fallback: trigger a standard file download
  const url = URL.createObjectURL(backupFile);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFile.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  await setSetting(SETTING_KEYS.lastBackupAt, Date.now());
  return {
    status: 'downloaded',
    fileName: backupFile.name,
    byteSize: backupFile.size,
  };
}

/**
 * Automatically saves a full safety snapshot of the current device data into OPFS
 * right before a restore runs, allowing one-tap "Undo last restore".
 */
async function saveSafetySnapshot(
  onProgress?: (progress: BackupProgress) => void
): Promise<number> {
  onProgress?.({
    phase: 'safety',
    label: 'Saving safety backup of current notes…',
    percent: 10,
  });

  const writer = await createOpfsChunkWriter('safety', SAFETY_SNAPSHOT_FILENAME);
  if (!writer) {
    throw new Error(
      'Unable to save the pre-restore safety backup in on-device storage.'
    );
  }

  try {
    await streamBackupZip((chunk) => writer.write(chunk));
    await writer.close();
  } catch (err) {
    await writer.abort();
    throw err;
  }

  return Date.now();
}

/** Checks whether an on-device pre-restore safety snapshot currently exists. */
export async function hasSafetySnapshot(): Promise<boolean> {
  const file = await readOpfsFile('safety', SAFETY_SNAPSHOT_FILENAME);
  return file !== null && file.size > 0;
}

/**
 * Quickly inspects a `.studynotes.zip` file by streaming it in chunks and reading
 * ONLY `manifest.json` (skipping large PDF/photo assets so memory stays minimal).
 */
export async function inspectBackupFile(file: File): Promise<BackupInspection> {
  const manifestChunks: Uint8Array[] = [];
  let foundManifest = false;
  let foundDatabase = false;
  let parseError: Error | null = null;

  const unzip = new Unzip((entry) => {
    if (entry.name === 'manifest.json') {
      foundManifest = true;
      entry.ondata = (err, data) => {
        if (err) {
          parseError = err;
          return;
        }
        if (data && data.byteLength > 0) {
          manifestChunks.push(data.slice());
        }
      };
      entry.start();
    } else if (entry.name === 'database.json') {
      foundDatabase = true;
      // Don't start() here — we just confirm it exists during inspection
    }
    // Skip assets/* entries completely during inspection
  });
  unzip.register(UnzipInflate);

  await feedFileToUnzip(file, unzip);

  if (parseError) {
    throw new Error('This file appears to be corrupted and could not be read.');
  }
  if (!foundManifest || !foundDatabase) {
    throw new Error(
      'This does not look like a StudyNotes backup file. Please choose a .studynotes.zip backup.'
    );
  }

  const manifestText = strFromU8(concatUint8Arrays(manifestChunks));
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestText) as BackupManifest;
  } catch {
    throw new Error('The backup manifest could not be parsed.');
  }

  if (
    manifest.format !== BACKUP_FORMAT ||
    typeof manifest.schemaVersion !== 'number' ||
    !manifest.counts
  ) {
    throw new Error('This file is not a valid StudyNotes backup.');
  }

  if (manifest.schemaVersion > DB_SCHEMA_VERSION) {
    throw new Error(
      `This backup was created by a newer version of StudyNotes (schema v${manifest.schemaVersion}). Please update the app first.`
    );
  }

  return {
    manifest,
    fileSize: file.size,
  };
}

/**
 * Restores all data from a `.studynotes.zip` file:
 * 1. Saves an automatic pre-restore safety snapshot to OPFS (unless undoing).
 * 2. Streams the ZIP in chunks, writing any PDF/image assets directly to OPFS staging.
 * 3. Validates the database dump completely before touching live data.
 * 4. Atomically replaces OPFS assets and IndexedDB tables in one transaction.
 */
export async function restoreFromBackupFile(
  file: File,
  options?: {
    skipSafetySnapshot?: boolean;
    onProgress?: (progress: BackupProgress) => void;
  }
): Promise<BackupManifest> {
  const onProgress = options?.onProgress;

  // Step 1: Save automatic safety snapshot before changing anything
  let safetyTimestamp: number | null = null;
  if (!options?.skipSafetySnapshot) {
    safetyTimestamp = await saveSafetySnapshot(onProgress);
  }

  // Step 2: Stream-extract the backup archive (assets go straight to OPFS staging)
  await clearOpfsDir('assets_staging');

  const manifestChunks: Uint8Array[] = [];
  const databaseChunks: Uint8Array[] = [];
  let writeChain = Promise.resolve();
  let streamError: Error | null = null;

  const unzip = new Unzip((entry) => {
    if (entry.name === 'manifest.json') {
      entry.ondata = (err, data) => {
        if (err) {
          streamError = err;
          return;
        }
        if (data && data.byteLength > 0) manifestChunks.push(data.slice());
      };
      entry.start();
      return;
    }

    if (entry.name === 'database.json') {
      entry.ondata = (err, data) => {
        if (err) {
          streamError = err;
          return;
        }
        if (data && data.byteLength > 0) databaseChunks.push(data.slice());
      };
      entry.start();
      return;
    }

    if (entry.name.startsWith('assets/') && entry.name.length > 'assets/'.length) {
      const assetId = entry.name.slice('assets/'.length);
      // Prevent path traversal characters in asset IDs
      if (assetId.includes('/') || assetId.includes('..')) return;

      let writerPromise: Promise<OpfsChunkWriter | null> | null = null;

      entry.ondata = (err, data, final) => {
        if (err) {
          streamError = err;
          return;
        }
        const chunkCopy = data && data.byteLength > 0 ? data.slice() : null;
        writeChain = writeChain.then(async () => {
          if (!writerPromise) {
            writerPromise = createOpfsChunkWriter('assets_staging', assetId);
          }
          const writer = await writerPromise;
          if (!writer) {
            throw new Error('Could not write restored files to device storage.');
          }
          if (chunkCopy) {
            await writer.write(chunkCopy);
          }
          if (final) {
            await writer.close();
          }
        });
      };
      entry.start();
    }
  });
  unzip.register(UnzipInflate);

  onProgress?.({
    phase: 'restoring',
    label: 'Reading backup archive…',
    percent: 30,
  });

  try {
    await feedFileToUnzip(file, unzip, async (ratio) => {
      // Wait for staged disk writes after each 512 KB chunk so RAM never grows
      await writeChain;
      if (streamError) throw streamError;
      onProgress?.({
        phase: 'restoring',
        label: 'Extracting notes & files…',
        percent: Math.min(85, Math.round(30 + ratio * 55)),
      });
    });

    await writeChain;
    if (streamError) throw streamError;

    // Step 3: Validate manifest & database JSON before touching live IndexedDB
    if (manifestChunks.length === 0 || databaseChunks.length === 0) {
      throw new Error('Backup is missing required data files.');
    }

    const manifest = JSON.parse(
      strFromU8(concatUint8Arrays(manifestChunks))
    ) as BackupManifest;
    const dump = JSON.parse(
      strFromU8(concatUint8Arrays(databaseChunks))
    ) as BackupDatabaseDump;

    if (
      manifest.format !== BACKUP_FORMAT ||
      !Array.isArray(dump.folders) ||
      !Array.isArray(dump.notes) ||
      !Array.isArray(dump.pages) ||
      !Array.isArray(dump.strokes) ||
      !Array.isArray(dump.assets)
    ) {
      throw new Error('Backup data is invalid or incomplete.');
    }

    // Step 4: Commit staged OPFS files and atomically replace IndexedDB tables
    onProgress?.({
      phase: 'restoring',
      label: 'Applying restored notes…',
      percent: 92,
    });

    const expectedAssetIds = new Set(dump.assets.map((a) => a.id));
    await commitStagedAssets(expectedAssetIds);

    const restoredSettings = Array.isArray(dump.settings)
      ? dump.settings.filter((s) => s.key !== SETTING_KEYS.preRestoreBackupAt)
      : [];

    if (safetyTimestamp !== null) {
      restoredSettings.push({
        key: SETTING_KEYS.preRestoreBackupAt,
        value: safetyTimestamp,
      });
    }

    await db.transaction(
      'rw',
      [db.folders, db.notes, db.pages, db.strokes, db.assets, db.settings],
      async () => {
        await Promise.all([
          db.folders.clear(),
          db.notes.clear(),
          db.pages.clear(),
          db.strokes.clear(),
          db.assets.clear(),
          db.settings.clear(),
        ]);

        if (dump.folders.length > 0) await db.folders.bulkAdd(dump.folders);
        if (dump.notes.length > 0) await db.notes.bulkAdd(dump.notes);
        if (dump.pages.length > 0) await db.pages.bulkAdd(dump.pages);
        if (dump.strokes.length > 0) await db.strokes.bulkAdd(dump.strokes);
        if (dump.assets.length > 0) await db.assets.bulkAdd(dump.assets);
        if (restoredSettings.length > 0) await db.settings.bulkPut(restoredSettings);
      }
    );

    onProgress?.({
      phase: 'finalizing',
      label: 'Restore complete',
      percent: 100,
    });

    return manifest;
  } catch (err) {
    await clearOpfsDir('assets_staging');
    throw err;
  }
}

/** Rolls back the last restore using the automatic on-device safety snapshot. */
export async function undoLastRestore(
  onProgress?: (progress: BackupProgress) => void
): Promise<BackupManifest> {
  const safetyFile = await readOpfsFile('safety', SAFETY_SNAPSHOT_FILENAME);
  if (!safetyFile) {
    throw new Error('No safety backup is available to undo.');
  }

  const manifest = await restoreFromBackupFile(safetyFile, {
    skipSafetySnapshot: true,
    onProgress,
  });

  await deleteOpfsFile('safety', SAFETY_SNAPSHOT_FILENAME);
  await setSetting(SETTING_KEYS.preRestoreBackupAt, null);
  return manifest;
}

/** Feeds a File into an fflate Unzip instance in 512 KB chunks. */
async function feedFileToUnzip(
  file: File,
  unzip: Unzip,
  onChunkFed?: (ratio: number) => Promise<void>
): Promise<void> {
  if (file.size === 0) {
    unzip.push(new Uint8Array(0), true);
    return;
  }

  for (let offset = 0; offset < file.size; offset += STREAM_CHUNK_SIZE) {
    const end = Math.min(offset + STREAM_CHUNK_SIZE, file.size);
    const isFinal = end >= file.size;
    const buffer = await file.slice(offset, end).arrayBuffer();
    unzip.push(new Uint8Array(buffer), isFinal);
    if (onChunkFed) {
      await onChunkFed(end / file.size);
    }
  }
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
