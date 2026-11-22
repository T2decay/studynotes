import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  HardDrive,
  RotateCcw,
  Share,
  ShieldCheck,
  Upload,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { APP_VERSION } from '../db/database';
import { formatLastBackupLabel } from '../db/settings';
import { getStorageStatus, type StorageStatus } from '../storage/opfs';
import {
  estimateBackupSize,
  exportBackupToDevice,
  formatBytes,
  hasSafetySnapshot,
  inspectBackupFile,
  restoreFromBackupFile,
  shareOrDownloadBackupFile,
  undoLastRestore,
  type BackupSizeEstimate,
} from '../storage/backup';
import type { BackupInspection, BackupProgress } from '../types/models';
import { ConfirmDialog } from './ConfirmDialog';

interface SettingsModalProps {
  open: boolean;
  lastBackupAt: number | null;
  preRestoreBackupAt: number | null;
  onClose: () => void;
  onRestored: (message: string, canUndo: boolean) => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Settings modal built on the native HTML <dialog> element.
 * Handles full backup export (iPad Share Sheet), safe restore with automatic
 * pre-restore snapshot, undo last restore, estimated backup size, and storage info.
 */
export function SettingsModal({
  open,
  lastBackupAt,
  preRestoreBackupAt,
  onClose,
  onRestored,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [estimate, setEstimate] = useState<BackupSizeEstimate | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [safetyAvailable, setSafetyAvailable] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    tone: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [pendingShareFile, setPendingShareFile] = useState<File | null>(null);

  // Restore confirmation state
  const [pendingRestore, setPendingRestore] = useState<{
    file: File;
    inspection: BackupInspection;
  } | null>(null);
  const [confirmUndoOpen, setConfirmUndoOpen] = useState(false);

  const refreshStats = async () => {
    const [est, status, hasSafety] = await Promise.all([
      estimateBackupSize(),
      getStorageStatus(),
      hasSafetySnapshot(),
    ]);
    setEstimate(est);
    setStorageStatus(status);
    setSafetyAvailable(hasSafety);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      setStatusMessage(null);
      setPendingShareFile(null);
      void refreshStats();
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleBackup = async () => {
    setBusy(true);
    setStatusMessage(null);
    setPendingShareFile(null);
    setProgress({ phase: 'preparing', label: 'Starting backup…', percent: 2 });

    try {
      const result = await exportBackupToDevice((p) => setProgress(p));
      if (result.status === 'shared') {
        setStatusMessage({
          tone: 'success',
          text: `Backup saved (${formatBytes(result.byteSize)}).`,
        });
      } else if (result.status === 'downloaded') {
        setStatusMessage({
          tone: 'success',
          text: `Downloaded ${result.fileName} (${formatBytes(result.byteSize)}).`,
        });
      } else if (result.status === 'cancelled') {
        setStatusMessage({
          tone: 'info',
          text: 'Backup cancelled. Last backup date was not changed.',
        });
      } else if (result.status === 'ready_to_share') {
        setPendingShareFile(result.file);
        setStatusMessage({
          tone: 'info',
          text: `Backup is ready (${formatBytes(result.byteSize)}). Tap "Save backup file" below to open the Share Sheet.`,
        });
      }
      await refreshStats();
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Backup failed. Please try again.',
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleSharePreparedFile = async () => {
    if (!pendingShareFile) return;
    setBusy(true);
    try {
      const result = await shareOrDownloadBackupFile(pendingShareFile);
      if (result.status === 'shared' || result.status === 'downloaded') {
        setPendingShareFile(null);
        setStatusMessage({
          tone: 'success',
          text: `Backup saved (${formatBytes(result.byteSize)}).`,
        });
      } else if (result.status === 'cancelled') {
        setStatusMessage({
          tone: 'info',
          text: 'Share cancelled. You can tap "Save backup file" again.',
        });
      }
      await refreshStats();
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not share backup file.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePickRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so selecting the same file again still triggers onChange
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    setStatusMessage(null);
    try {
      const inspection = await inspectBackupFile(file);
      setPendingRestore({ file, inspection });
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not read that backup file.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;
    const { file } = pendingRestore;
    setPendingRestore(null);
    setBusy(true);
    setStatusMessage(null);
    setProgress({
      phase: 'safety',
      label: 'Saving safety backup of current notes…',
      percent: 5,
    });

    try {
      const manifest = await restoreFromBackupFile(file, {
        onProgress: (p) => setProgress(p),
      });
      await refreshStats();
      const summary = `Restored ${manifest.counts.folders} folder${manifest.counts.folders === 1 ? '' : 's'} and ${manifest.counts.notes} note${manifest.counts.notes === 1 ? '' : 's'}.`;
      onRestored(summary, true);
      onClose();
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Restore failed. Your existing notes were not changed.',
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleConfirmUndoRestore = async () => {
    setConfirmUndoOpen(false);
    setBusy(true);
    setStatusMessage(null);
    setProgress({
      phase: 'restoring',
      label: 'Restoring your previous notes…',
      percent: 20,
    });

    try {
      const manifest = await undoLastRestore((p) => setProgress(p));
      await refreshStats();
      const summary = `Restored previous state (${manifest.counts.folders} folder${manifest.counts.folders === 1 ? '' : 's'}, ${manifest.counts.notes} note${manifest.counts.notes === 1 ? '' : 's'}).`;
      onRestored(summary, false);
      onClose();
    } catch (err) {
      setStatusMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not undo restore.',
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <>
      <dialog
        ref={dialogRef}
        className="sn-dialog"
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) onClose();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current && !busy) {
            onClose();
          }
        }}
      >
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Settings &amp; Backup
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close settings"
              className="min-h-11 min-w-11 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto p-6 space-y-6">
            {/* Backup & Restore section */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Backup &amp; Restore
              </h3>

              {/* Backup status & estimated size summary */}
              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">Last backup</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatLastBackupLabel(lastBackupAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-400">
                    Estimated backup size
                  </span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {estimate ? formatBytes(estimate.estimatedBytes) : 'Calculating…'}
                  </span>
                </div>
                {estimate && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/80 dark:border-slate-800">
                    {estimate.folderCount}{' '}
                    {estimate.folderCount === 1 ? 'folder' : 'folders'} ·{' '}
                    {estimate.noteCount}{' '}
                    {estimate.noteCount === 1 ? 'note' : 'notes'} ·{' '}
                    {estimate.pageCount}{' '}
                    {estimate.pageCount === 1 ? 'page' : 'pages'}
                    {estimate.assetCount > 0
                      ? ` · ${estimate.assetCount} attached ${estimate.assetCount === 1 ? 'file' : 'files'}`
                      : ''}
                  </p>
                )}
              </div>

              {/* Progress indicator */}
              {progress && (
                <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-blue-800 dark:text-blue-200">
                    <span>{progress.label}</span>
                    <span className="tabular-nums">{progress.percent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-blue-200 dark:bg-blue-900 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-150"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Feedback banner */}
              {statusMessage && (
                <div
                  className={`rounded-xl p-3.5 text-sm ${
                    statusMessage.tone === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                      : statusMessage.tone === 'error'
                        ? 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {statusMessage.text}
                </div>
              )}

              {/* Action buttons */}
              <div className="space-y-2.5">
                {pendingShareFile ? (
                  <button
                    type="button"
                    onClick={handleSharePreparedFile}
                    disabled={busy}
                    className="w-full min-h-12 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Share className="w-4 h-4" />
                    Save backup file ({formatBytes(pendingShareFile.size)})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleBackup}
                    disabled={busy}
                    className="w-full min-h-12 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Back up everything
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="w-full min-h-12 px-4 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  Restore from backup
                </button>

                {/* Hidden file input; includes .zip & application/zip so iPadOS Files never greys out backups */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.studynotes,application/zip,application/octet-stream"
                  onChange={handlePickRestoreFile}
                  className="hidden"
                />

                {/* Automatic pre-restore safety snapshot rollback */}
                {safetyAvailable && (
                  <button
                    type="button"
                    onClick={() => setConfirmUndoOpen(true)}
                    disabled={busy}
                    className="w-full min-h-12 px-4 rounded-xl text-sm font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/70 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      Undo last restore
                      {preRestoreBackupAt
                        ? ` (${dateTimeFormatter.format(preRestoreBackupAt)})`
                        : ''}
                    </span>
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Saves one <code className="font-mono">.studynotes.zip</code> file to
                Files / iCloud Drive via the Share Sheet. PDFs and photos are stored
                without recompression so large semester backups stay fast.
              </p>
            </section>

            {/* Storage & Offline status section */}
            <section className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Device Storage &amp; Offline Status
              </h3>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    {isOnline ? (
                      <Wifi className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-amber-500" />
                    )}
                    Network
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {isOnline ? 'Online (offline copy ready)' : 'Offline mode'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <ShieldCheck className="w-4 h-4 text-blue-500" />
                    Storage protection
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100 inline-flex items-center gap-1">
                    {storageStatus?.persisted ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        Persistent
                      </>
                    ) : (
                      'Standard'
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <HardDrive className="w-4 h-4 text-slate-400" />
                    On-device usage
                  </span>
                  <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    {storageStatus?.usageBytes != null
                      ? formatBytes(storageStatus.usageBytes)
                      : 'Unavailable'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/80 dark:border-slate-800">
                  <span>StudyNotes v{APP_VERSION}</span>
                  <span>All data stays on this iPad</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </dialog>

      {/* Confirmation modal before replacing device data from a backup */}
      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restore from backup?"
        tone="primary"
        confirmLabel="Replace & Restore"
        description={
          pendingRestore && (
            <div className="space-y-2.5">
              <p>
                Backup from{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {dateTimeFormatter.format(pendingRestore.inspection.manifest.exportedAt)}
                </strong>{' '}
                ({formatBytes(pendingRestore.inspection.fileSize)}):
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>
                  {pendingRestore.inspection.manifest.counts.folders}{' '}
                  {pendingRestore.inspection.manifest.counts.folders === 1
                    ? 'folder'
                    : 'folders'}
                </li>
                <li>
                  {pendingRestore.inspection.manifest.counts.notes}{' '}
                  {pendingRestore.inspection.manifest.counts.notes === 1
                    ? 'note'
                    : 'notes'}
                </li>
                <li>
                  {pendingRestore.inspection.manifest.counts.pages}{' '}
                  {pendingRestore.inspection.manifest.counts.pages === 1
                    ? 'page'
                    : 'pages'}
                </li>
              </ul>
              <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
                This will replace the notes currently on this iPad. A safety backup of
                your current notes will be saved automatically first so you can undo
                the restore if needed.
              </p>
            </div>
          )
        }
        onConfirm={handleConfirmRestore}
        onClose={() => setPendingRestore(null)}
      />

      {/* Confirmation modal before rolling back to the pre-restore safety snapshot */}
      <ConfirmDialog
        open={confirmUndoOpen}
        title="Undo last restore?"
        confirmLabel="Restore Previous Notes"
        description={
          <p>
            This will switch back to the automatic safety backup saved right before
            your last restore
            {preRestoreBackupAt
              ? ` (${dateTimeFormatter.format(preRestoreBackupAt)})`
              : ''}
            .
          </p>
        }
        onConfirm={handleConfirmUndoRestore}
        onClose={() => setConfirmUndoOpen(false)}
      />
    </>
  );
}
