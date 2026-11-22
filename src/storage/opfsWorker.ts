/**
 * Dedicated Web Worker for Origin Private File System (OPFS) file writing.
 *
 * Why a Web Worker?
 * Safari / iPadOS Safari does not support `FileSystemFileHandle.createWritable()`
 * on the main thread, whereas `FileSystemFileHandle.createSyncAccessHandle()`
 * inside a Web Worker is supported across Safari/iPadOS 15.2+, Chrome, and Firefox.
 *
 * Using this worker keeps all disk writes off the UI thread and supports streaming
 * 512 KB chunks with flat RAM usage for large semester PDFs and backups.
 */

type OpfsDirName = 'assets' | 'safety' | 'exports' | 'assets_staging';

/** Minimal type definition for OPFS SyncAccessHandle (supports both sync and async Safari versions). */
interface SyncAccessHandle {
  write: (buffer: ArrayBufferView, options?: { at?: number }) => number;
  read: (buffer: ArrayBufferView, options?: { at?: number }) => number;
  truncate: (newSize: number) => void | Promise<void>;
  getSize: () => number | Promise<number>;
  flush: () => void | Promise<void>;
  close: () => void | Promise<void>;
}

interface WorkerFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle: () => Promise<SyncAccessHandle>;
}

interface WriteSession {
  syncHandle: SyncAccessHandle;
  offset: number;
  dirName: OpfsDirName;
  fileName: string;
}

type WorkerRequest =
  | { reqId: number; op: 'probe' }
  | { reqId: number; op: 'openWrite'; sessionId: number; dirName: OpfsDirName; fileName: string }
  | { reqId: number; op: 'writeChunk'; sessionId: number; buffer: ArrayBuffer }
  | { reqId: number; op: 'closeWrite'; sessionId: number }
  | { reqId: number; op: 'abortWrite'; sessionId: number }
  | {
      reqId: number;
      op: 'copyFile';
      srcDir: OpfsDirName;
      srcName: string;
      destDir: OpfsDirName;
      destName: string;
    };

const sessions = new Map<number, WriteSession>();
const COPY_CHUNK_SIZE = 512 * 1024;

async function getSubdir(dirName: OpfsDirName, create: boolean) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(dirName, { create });
}

async function handleRequest(msg: WorkerRequest): Promise<void> {
  try {
    switch (msg.op) {
      case 'probe': {
        const dir = await getSubdir('safety', true);
        const handle = (await dir.getFileHandle('__opfs_probe__', {
          create: true,
        })) as WorkerFileHandle;
        if (typeof handle.createSyncAccessHandle !== 'function') {
          throw new Error('createSyncAccessHandle is unavailable');
        }
        const sync = await handle.createSyncAccessHandle();
        try {
          await sync.truncate(0);
          sync.write(new Uint8Array([1, 2, 3, 4]), { at: 0 });
          await sync.flush();
        } finally {
          await sync.close();
          await dir.removeEntry('__opfs_probe__').catch(() => {});
        }
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }

      case 'openWrite': {
        const dir = await getSubdir(msg.dirName, true);
        const handle = (await dir.getFileHandle(msg.fileName, {
          create: true,
        })) as WorkerFileHandle;
        const syncHandle = await handle.createSyncAccessHandle();
        await syncHandle.truncate(0);
        sessions.set(msg.sessionId, {
          syncHandle,
          offset: 0,
          dirName: msg.dirName,
          fileName: msg.fileName,
        });
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }

      case 'writeChunk': {
        const session = sessions.get(msg.sessionId);
        if (!session) {
          throw new Error('Write session not found');
        }
        const view = new Uint8Array(msg.buffer);
        const written = session.syncHandle.write(view, { at: session.offset });
        session.offset += written;
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }

      case 'closeWrite': {
        const session = sessions.get(msg.sessionId);
        if (session) {
          sessions.delete(msg.sessionId);
          await session.syncHandle.flush();
          await session.syncHandle.close();
        }
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }

      case 'abortWrite': {
        const session = sessions.get(msg.sessionId);
        if (session) {
          sessions.delete(msg.sessionId);
          try {
            await session.syncHandle.close();
          } catch {
            // Ignore close error during abort
          }
          try {
            const dir = await getSubdir(session.dirName, false);
            await dir.removeEntry(session.fileName);
          } catch {
            // Ignore cleanup error
          }
        }
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }

      case 'copyFile': {
        const srcDirHandle = await getSubdir(msg.srcDir, false);
        const srcFileHandle = (await srcDirHandle.getFileHandle(msg.srcName, {
          create: false,
        })) as WorkerFileHandle;

        const destDirHandle = await getSubdir(msg.destDir, true);
        const destFileHandle = (await destDirHandle.getFileHandle(msg.destName, {
          create: true,
        })) as WorkerFileHandle;

        const srcSync = await srcFileHandle.createSyncAccessHandle();
        const destSync = await destFileHandle.createSyncAccessHandle();
        try {
          const totalSize = await srcSync.getSize();
          await destSync.truncate(0);
          const buffer = new Uint8Array(COPY_CHUNK_SIZE);

          for (let offset = 0; offset < totalSize; offset += COPY_CHUNK_SIZE) {
            const toRead = Math.min(COPY_CHUNK_SIZE, totalSize - offset);
            const slice = buffer.subarray(0, toRead);
            const bytesRead = srcSync.read(slice, { at: offset });
            if (bytesRead > 0) {
              destSync.write(slice.subarray(0, bytesRead), { at: offset });
            }
          }
          await destSync.flush();
        } finally {
          await destSync.close();
          await srcSync.close();
        }
        self.postMessage({ reqId: msg.reqId, ok: true });
        return;
      }
    }
  } catch (err) {
    self.postMessage({
      reqId: msg.reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Serialize worker operations so concurrent file requests never race on OPFS handles
let requestQueue = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  requestQueue = requestQueue.then(() => handleRequest(event.data));
};
