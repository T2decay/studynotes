import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCcw, X } from 'lucide-react';
import { db } from './db/database';
import {
  buildFolderTree,
  createFolder,
  deleteFolderSafely,
  flattenFolderTree,
  getFolderDeleteImpact,
  recolorFolder,
  renameFolder,
  reorderFolder,
} from './db/folders';
import { createNote, deleteNote, moveNoteToFolder, renameNote } from './db/notes';
import {
  DEFAULT_SIDEBAR_WIDTH,
  SETTING_KEYS,
  formatLastBackupLabel,
  isBackupReminderDue,
  setSetting,
} from './db/settings';
import { undoLastRestore } from './storage/backup';
import type { Folder, Note } from './types/models';
import { ConfirmDialog } from './components/ConfirmDialog';
import { FolderEditorDialog } from './components/FolderEditorDialog';
import { NoteWorkspace } from './components/NoteWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar, type SidebarFilter } from './components/Sidebar';

export function App() {
  // Live reactive queries from IndexedDB (updates automatically across the UI)
  const folders = useLiveQuery(() => db.folders.toArray(), [], [] as Folder[]);
  const notes = useLiveQuery(
    () => db.notes.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as Note[]
  );
  const settingsRows = useLiveQuery(() => db.settings.toArray(), [], []);

  const settingsMap = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const row of settingsRows) {
      map.set(row.key, row.value);
    }
    return map;
  }, [settingsRows]);

  const lastBackupAt =
    typeof settingsMap.get(SETTING_KEYS.lastBackupAt) === 'number'
      ? (settingsMap.get(SETTING_KEYS.lastBackupAt) as number)
      : null;

  const preRestoreBackupAt =
    typeof settingsMap.get(SETTING_KEYS.preRestoreBackupAt) === 'number'
      ? (settingsMap.get(SETTING_KEYS.preRestoreBackupAt) as number)
      : null;

  const savedSidebarWidth =
    typeof settingsMap.get(SETTING_KEYS.sidebarWidth) === 'number'
      ? (settingsMap.get(SETTING_KEYS.sidebarWidth) as number)
      : DEFAULT_SIDEBAR_WIDTH;

  const savedSidebarCollapsed =
    typeof settingsMap.get(SETTING_KEYS.sidebarCollapsed) === 'boolean'
      ? (settingsMap.get(SETTING_KEYS.sidebarCollapsed) as boolean)
      : false;

  // Local UI state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'all' });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // Toast banner shown right after a restore (includes one-tap Undo Restore)
  const [toast, setToast] = useState<{
    message: string;
    canUndoRestore: boolean;
  } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  // Folder create/edit dialog state
  const [folderDialog, setFolderDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    parent: Folder | null;
    editing: Folder | null;
  }>({ open: false, mode: 'create', parent: null, editing: null });

  // Destructive confirmation dialogs
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{
    folder: Folder;
    subfolderCount: number;
    noteCount: number;
  } | null>(null);
  const [pendingDeleteNote, setPendingDeleteNote] = useState<Note | null>(null);

  // Sync persisted sidebar preferences when loaded from Dexie
  useEffect(() => {
    setSidebarWidth(savedSidebarWidth);
  }, [savedSidebarWidth]);

  useEffect(() => {
    setSidebarCollapsed(savedSidebarCollapsed);
  }, [savedSidebarCollapsed]);

  // Derived folder lookups & tree
  const folderById = useMemo(
    () => new Map(folders.map((f) => [f.id, f])),
    [folders]
  );
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree]);

  // Note counts per folder & unfiled
  const { noteCountsByFolder, unfiledNoteCount, oldestNoteCreatedAt } = useMemo(() => {
    const counts = new Map<string, number>();
    let unfiled = 0;
    let oldest: number | null = null;

    for (const note of notes) {
      if (oldest === null || note.createdAt < oldest) {
        oldest = note.createdAt;
      }
      if (note.folderId === null || !folderById.has(note.folderId)) {
        unfiled++;
      } else {
        counts.set(note.folderId, (counts.get(note.folderId) ?? 0) + 1);
      }
    }
    return {
      noteCountsByFolder: counts,
      unfiledNoteCount: unfiled,
      oldestNoteCreatedAt: oldest,
    };
  }, [notes, folderById]);

  // Filtered notes for the sidebar note list
  const visibleNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return notes.filter((note) => {
        const titleMatch = note.title.toLowerCase().includes(q);
        const folderName = note.folderId
          ? folderById.get(note.folderId)?.name.toLowerCase() ?? ''
          : 'unfiled';
        return titleMatch || folderName.includes(q);
      });
    }

    if (filter.kind === 'all') return notes;
    if (filter.kind === 'unfiled') {
      return notes.filter((n) => n.folderId === null || !folderById.has(n.folderId));
    }
    return notes.filter((n) => n.folderId === filter.folderId);
  }, [notes, filter, searchQuery, folderById]);

  // Selected note & its live page count
  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  const selectedNotePageCount = useLiveQuery(
    async () => {
      if (!selectedNoteId) return 0;
      return db.pages.where('noteId').equals(selectedNoteId).count();
    },
    [selectedNoteId],
    0
  );

  // If the currently filtered folder disappears (e.g. after delete/restore), reset to All Notes
  useEffect(() => {
    if (filter.kind === 'folder' && !folderById.has(filter.folderId)) {
      setFilter({ kind: 'all' });
    }
  }, [filter, folderById]);

  // Handlers
  const handleToggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    void setSetting(SETTING_KEYS.sidebarCollapsed, next);
  };

  const handleCreateNote = async () => {
    const targetFolderId = filter.kind === 'folder' ? filter.folderId : null;
    const created = await createNote({ folderId: targetFolderId });
    setSelectedNoteId(created.id);
    if (searchQuery.trim()) {
      setSearchQuery('');
    }
  };

  const handleOpenCreateFolder = (parent: Folder | null) => {
    setFolderDialog({ open: true, mode: 'create', parent, editing: null });
  };

  const handleOpenEditFolder = (folder: Folder) => {
    setFolderDialog({ open: true, mode: 'edit', parent: null, editing: folder });
  };

  const handleSaveFolder = async (name: string, color: string) => {
    if (folderDialog.mode === 'edit' && folderDialog.editing) {
      await renameFolder(folderDialog.editing.id, name);
      await recolorFolder(folderDialog.editing.id, color);
    } else {
      const created = await createFolder({
        name,
        parentId: folderDialog.parent?.id ?? null,
        color,
      });
      setFilter({ kind: 'folder', folderId: created.id });
    }
    setFolderDialog((prev) => ({ ...prev, open: false }));
  };

  const handleRequestDeleteFolder = async (folder: Folder) => {
    const impact = await getFolderDeleteImpact(folder.id);
    setPendingDeleteFolder({ folder, ...impact });
  };

  const handleConfirmDeleteFolder = async () => {
    if (!pendingDeleteFolder) return;
    await deleteFolderSafely(pendingDeleteFolder.folder.id);
    setPendingDeleteFolder(null);
  };

  const handleConfirmDeleteNote = async () => {
    if (!pendingDeleteNote) return;
    const deletedId = pendingDeleteNote.id;
    await deleteNote(deletedId);
    if (selectedNoteId === deletedId) {
      setSelectedNoteId(null);
    }
    setPendingDeleteNote(null);
  };

  const handleQuickUndoRestore = async () => {
    setUndoBusy(true);
    try {
      const manifest = await undoLastRestore();
      setToast({
        message: `Undid restore (${manifest.counts.folders} folders, ${manifest.counts.notes} notes restored).`,
        canUndoRestore: false,
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Could not undo restore.',
        canUndoRestore: false,
      });
    } finally {
      setUndoBusy(false);
    }
  };

  const showBackupReminder =
    !reminderDismissed && isBackupReminderDue(lastBackupAt, oldestNoteCreatedAt);

  return (
    <div className="h-full w-full flex overflow-hidden bg-slate-100 dark:bg-slate-950">
      <Sidebar
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        filter={filter}
        searchQuery={searchQuery}
        folderTree={folderTree}
        folderById={folderById}
        visibleNotes={visibleNotes}
        selectedNoteId={selectedNote?.id ?? null}
        totalNoteCount={notes.length}
        unfiledNoteCount={unfiledNoteCount}
        noteCountsByFolder={noteCountsByFolder}
        showBackupReminder={showBackupReminder}
        lastBackupLabel={formatLastBackupLabel(lastBackupAt)}
        onWidthChange={setSidebarWidth}
        onWidthCommit={(w) => void setSetting(SETTING_KEYS.sidebarWidth, w)}
        onSelectFilter={(nextFilter) => {
          setFilter(nextFilter);
          setSearchQuery('');
        }}
        onSearchChange={setSearchQuery}
        onCreateFolder={handleOpenCreateFolder}
        onEditFolder={handleOpenEditFolder}
        onReorderFolder={(id, dir) => void reorderFolder(id, dir)}
        onRequestDeleteFolder={(f) => void handleRequestDeleteFolder(f)}
        onCreateNote={() => void handleCreateNote()}
        onSelectNote={setSelectedNoteId}
        onRequestDeleteNote={setPendingDeleteNote}
        onOpenSettings={() => setSettingsOpen(true)}
        onDismissBackupReminder={() => setReminderDismissed(true)}
      />

      <NoteWorkspace
        note={selectedNote}
        pageCount={selectedNotePageCount}
        flatFolders={flatFolders}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
        onCreateNote={() => void handleCreateNote()}
        onCreateFolder={() => handleOpenCreateFolder(null)}
        onRenameNote={(id, title) => void renameNote(id, title)}
        onMoveNote={(id, folderId) => void moveNoteToFolder(id, folderId)}
        onRequestDeleteNote={setPendingDeleteNote}
      />

      {/* Post-restore notification toast with one-tap Undo */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-40 max-w-md rounded-2xl bg-slate-900 dark:bg-slate-800 text-white shadow-xl border border-slate-700 px-4 py-3 flex items-center gap-3">
          <span className="text-sm">{toast.message}</span>
          {toast.canUndoRestore && (
            <button
              type="button"
              disabled={undoBusy}
              onClick={() => void handleQuickUndoRestore()}
              className="min-h-9 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {undoBusy ? 'Undoing…' : 'Undo'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss message"
            className="min-h-8 min-w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create / Rename / Recolor Folder Dialog */}
      <FolderEditorDialog
        open={folderDialog.open}
        mode={folderDialog.mode}
        parentName={folderDialog.parent?.name}
        initialName={folderDialog.editing?.name ?? ''}
        initialColor={folderDialog.editing?.color}
        onSave={(name, color) => void handleSaveFolder(name, color)}
        onClose={() => setFolderDialog((prev) => ({ ...prev, open: false }))}
      />

      {/* Safe Folder Delete Confirmation */}
      <ConfirmDialog
        open={pendingDeleteFolder !== null}
        title={`Delete "${pendingDeleteFolder?.folder.name ?? ''}"?`}
        tone="danger"
        confirmLabel="Delete Folder"
        description={
          pendingDeleteFolder && (
            <div className="space-y-2">
              <p>
                {pendingDeleteFolder.subfolderCount > 0
                  ? `This folder and its ${pendingDeleteFolder.subfolderCount} nested ${pendingDeleteFolder.subfolderCount === 1 ? 'subfolder' : 'subfolders'} will be removed.`
                  : 'This folder will be removed.'}
              </p>
              <p>
                {pendingDeleteFolder.noteCount > 0 ? (
                  <>
                    Your{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {pendingDeleteFolder.noteCount}{' '}
                      {pendingDeleteFolder.noteCount === 1 ? 'note' : 'notes'}
                    </strong>{' '}
                    inside will NOT be deleted—they will be safely moved to{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      Unfiled
                    </strong>
                    .
                  </>
                ) : (
                  'There are no notes inside this folder.'
                )}
              </p>
            </div>
          )
        }
        onConfirm={() => void handleConfirmDeleteFolder()}
        onClose={() => setPendingDeleteFolder(null)}
      />

      {/* Note Delete Confirmation */}
      <ConfirmDialog
        open={pendingDeleteNote !== null}
        title={`Delete "${pendingDeleteNote?.title || 'Untitled Note'}"?`}
        tone="danger"
        confirmLabel="Delete Note"
        description={
          <p>
            This permanently deletes this note and its pages from this iPad. This
            cannot be undone unless you have a backup.
          </p>
        }
        onConfirm={() => void handleConfirmDeleteNote()}
        onClose={() => setPendingDeleteNote(null)}
      />

      {/* Settings & Backup Modal */}
      <SettingsModal
        open={settingsOpen}
        lastBackupAt={lastBackupAt}
        preRestoreBackupAt={preRestoreBackupAt}
        onClose={() => setSettingsOpen(false)}
        onRestored={(message, canUndo) => {
          setSelectedNoteId(null);
          setToast({ message, canUndoRestore: canUndo });
        }}
      />
    </div>
  );
}
