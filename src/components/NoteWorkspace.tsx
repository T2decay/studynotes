import { useEffect, useRef, useState } from 'react';
import {
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  PanelLeft,
  Pencil,
  Settings,
  Trash2,
} from 'lucide-react';
import type { Folder, Note } from '../types/models';

interface NoteWorkspaceProps {
  note: Note | null;
  pageCount: number;
  flatFolders: Array<{ folder: Folder; depth: number }>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onRenameNote: (noteId: string, title: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onRequestDeleteNote: (note: Note) => void;
}

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Main workspace pane showing the selected note's title, folder picker,
 * and a crisp US Letter white paper sheet (PDF & Apple Pencil canvas arrive in Phases 2–3).
 */
export function NoteWorkspace({
  note,
  pageCount,
  flatFolders,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  onCreateNote,
  onCreateFolder,
  onRenameNote,
  onMoveNote,
  onRequestDeleteNote,
}: NoteWorkspaceProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [draftTitle, setDraftTitle] = useState(note?.title ?? '');

  useEffect(() => {
    setDraftTitle(note?.title ?? '');
  }, [note?.id, note?.title]);

  const commitTitle = () => {
    if (!note) return;
    const trimmed = draftTitle.trim() || 'Untitled Note';
    setDraftTitle(trimmed);
    if (trimmed !== note.title) {
      onRenameNote(note.id, trimmed);
    }
  };

  // Synchronous focus inside the tap handler so iPadOS Safari immediately opens the keyboard
  const handleFocusTitleSync = () => {
    const input = titleInputRef.current;
    if (!input) return;
    input.focus();
    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      // Ignore if selection range is unsupported
    }
  };

  return (
    <main className="flex-1 min-w-0 h-full flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top toolbar (solid background avoids WebKit standalone PWA backdrop-blur input hit-test quirks) */}
      <header className="safe-top shrink-0 flex items-center gap-2 px-3 sm:px-4 min-h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <PanelLeft className="w-5 h-5" />
        </button>

        {note ? (
          <>
            {/* Always-mounted title input + synchronous focus pencil button for single-tap iPad rename */}
            <div className="flex-1 min-w-0 flex items-center gap-1">
              <input
                ref={titleInputRef}
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                enterKeyHint="done"
                autoComplete="off"
                aria-label="Note title"
                placeholder="Untitled Note"
                className="flex-1 min-w-0 min-h-11 px-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-white dark:focus:bg-slate-950 border border-transparent focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-base font-semibold text-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={handleFocusTitleSync}
                aria-label="Rename note"
                title="Rename note"
                className="min-h-11 min-w-11 shrink-0 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>

            {/* Folder selector */}
            <label className="hidden sm:flex items-center gap-1.5 min-h-11 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200">
              <FolderIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Note folder"
                value={note.folderId ?? ''}
                onChange={(e) =>
                  onMoveNote(note.id, e.target.value ? e.target.value : null)
                }
                className="bg-transparent focus:outline-none max-w-[160px] truncate"
              >
                <option value="">Unfiled</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {'\u00A0'.repeat(depth * 3)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => onRequestDeleteNote(note)}
              aria-label="Delete note"
              title="Delete note"
              className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </>
        ) : (
          <div className="flex-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            StudyNotes
          </div>
        )}

        {sidebarCollapsed && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Settings className="w-5 h-5" />
          </button>
        )}
      </header>

      {/* Main page area */}
      {note ? (
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col items-center">
          {/* Narrow viewport folder picker */}
          <div className="sm:hidden w-full max-w-[680px] mb-3 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <label className="flex items-center gap-1.5 min-h-10 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <FolderIcon className="w-3.5 h-3.5" />
              <select
                aria-label="Note folder"
                value={note.folderId ?? ''}
                onChange={(e) =>
                  onMoveNote(note.id, e.target.value ? e.target.value : null)
                }
                className="bg-transparent focus:outline-none text-slate-700 dark:text-slate-200"
              >
                <option value="">Unfiled</option>
                {flatFolders.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {'\u00A0'.repeat(depth * 3)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
          </div>

          {/* Crisp always-white US Letter page preview (612 × 792 pt aspect ratio) */}
          <div
            className="w-full max-w-[680px] bg-white text-slate-900 rounded-md shadow-md border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between p-6 sm:p-10"
            style={{ aspectRatio: '612 / 792' }}
          >
            <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-100 pb-3">
              <span>Page 1 of {Math.max(1, pageCount)} · US Letter</span>
              <span>Saved locally · {fullDateFormatter.format(note.updatedAt)}</span>
            </div>

            <div className="my-auto text-center max-w-sm mx-auto space-y-2">
              <p className="text-base font-medium text-slate-700">
                Ready for your notes
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                This blank US Letter page is saved offline on your iPad. PDF &amp;
                photo import arrives in Phase 2, and Apple Pencil handwriting arrives
                in Phase 3.
              </p>
            </div>

            <div className="text-center text-[11px] text-slate-300">
              Autosaved offline on this device
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                Welcome to StudyNotes
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Organize classes by semester, create notes, and keep everything safely
                stored offline on your iPad.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={onCreateNote}
                className="w-full sm:w-auto min-h-11 px-5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center gap-2"
              >
                <FilePlus2 className="w-4 h-4" />
                New Note
              </button>
              <button
                type="button"
                onClick={onCreateFolder}
                className="w-full sm:w-auto min-h-11 px-5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                <FolderPlus className="w-4 h-4" />
                New Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
