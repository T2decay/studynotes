import { useRef, useState } from 'react';
import {
  AlertCircle,
  FilePlus2,
  FolderPlus,
  Inbox,
  Layers,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../db/settings';
import type { Folder, FolderNode, Note } from '../types/models';
import { FolderTree } from './FolderTree';
import { NoteList } from './NoteList';

export type SidebarFilter =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; folderId: string };

interface SidebarProps {
  width: number;
  collapsed: boolean;
  filter: SidebarFilter;
  searchQuery: string;
  folderTree: FolderNode[];
  folderById: Map<string, Folder>;
  visibleNotes: Note[];
  selectedNoteId: string | null;
  totalNoteCount: number;
  unfiledNoteCount: number;
  noteCountsByFolder: Map<string, number>;
  showBackupReminder: boolean;
  lastBackupLabel: string;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  onSelectFilter: (filter: SidebarFilter) => void;
  onSearchChange: (query: string) => void;
  onCreateFolder: (parent: Folder | null) => void;
  onEditFolder: (folder: Folder) => void;
  onReorderFolder: (folderId: string, direction: 'up' | 'down') => void;
  onRequestDeleteFolder: (folder: Folder) => void;
  onCreateNote: () => void;
  onSelectNote: (noteId: string) => void;
  onRequestDeleteNote: (note: Note) => void;
  onOpenSettings: () => void;
  onDismissBackupReminder: () => void;
}

/**
 * Collapsible, resizable left sidebar containing:
 * - Search bar
 * - All Notes & Unfiled quick views
 * - Nested Folders tree (create/rename/color/reorder/delete)
 * - Filtered Note list (title, date, delete)
 * - Gentle 7-day backup reminder banner
 */
export function Sidebar({
  width,
  collapsed,
  filter,
  searchQuery,
  folderTree,
  folderById,
  visibleNotes,
  selectedNoteId,
  totalNoteCount,
  unfiledNoteCount,
  noteCountsByFolder,
  showBackupReminder,
  lastBackupLabel,
  onWidthChange,
  onWidthCommit,
  onSelectFilter,
  onSearchChange,
  onCreateFolder,
  onEditFolder,
  onReorderFolder,
  onRequestDeleteFolder,
  onCreateNote,
  onSelectNote,
  onRequestDeleteNote,
  onOpenSettings,
  onDismissBackupReminder,
}: SidebarProps) {
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  if (collapsed) {
    return null;
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setResizing(true);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    const delta = e.clientX - startXRef.current;
    const nextWidth = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Math.round(startWidthRef.current + delta))
    );
    onWidthChange(nextWidth);
  };

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    setResizing(false);
    const delta = e.clientX - startXRef.current;
    const nextWidth = Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(MAX_SIDEBAR_WIDTH, Math.round(startWidthRef.current + delta))
    );
    onWidthCommit(nextWidth);
  };

  const activeSectionTitle = searchQuery.trim()
    ? `Search results (${visibleNotes.length})`
    : filter.kind === 'all'
      ? 'All Notes'
      : filter.kind === 'unfiled'
        ? 'Unfiled'
        : folderById.get(filter.folderId)?.name ?? 'Notes';

  const showFolderBadge =
    searchQuery.trim().length > 0 || filter.kind === 'all';

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 h-full max-w-[85vw] flex flex-col bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800"
    >
      {/* Top sidebar header */}
      <div className="safe-top shrink-0 flex items-center justify-between gap-2 px-3 min-h-14 border-b border-slate-200/80 dark:border-slate-800">
        <span className="pl-1 text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
          StudyNotes
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCreateNote}
            aria-label="New note"
            title="New note"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
          >
            <FilePlus2 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings and backup"
            title="Settings and backup"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="w-full min-h-10 pl-9 pr-9 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1 min-h-8 min-w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable folders + notes body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-4 space-y-4">
        {/* Quick filters */}
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => onSelectFilter({ kind: 'all' })}
            className={`w-full min-h-10 px-3 rounded-xl flex items-center gap-2.5 text-sm font-medium transition ${
              filter.kind === 'all' && !searchQuery.trim()
                ? 'bg-blue-500/12 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
            }`}
          >
            <Layers className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="truncate">All Notes</span>
            <span className="ml-auto text-xs tabular-nums text-slate-400">
              {totalNoteCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectFilter({ kind: 'unfiled' })}
            className={`w-full min-h-10 px-3 rounded-xl flex items-center gap-2.5 text-sm font-medium transition ${
              filter.kind === 'unfiled' && !searchQuery.trim()
                ? 'bg-blue-500/12 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
            }`}
          >
            <Inbox className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="truncate">Unfiled</span>
            <span className="ml-auto text-xs tabular-nums text-slate-400">
              {unfiledNoteCount}
            </span>
          </button>
        </div>

        {/* Folders section */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Folders
            </span>
            <button
              type="button"
              onClick={() => onCreateFolder(null)}
              aria-label="New folder"
              title="New folder"
              className="min-h-8 min-w-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>
          <FolderTree
            nodes={folderTree}
            selectedFolderId={
              filter.kind === 'folder' && !searchQuery.trim()
                ? filter.folderId
                : null
            }
            noteCountsByFolder={noteCountsByFolder}
            onSelectFolder={(folderId) =>
              onSelectFilter({ kind: 'folder', folderId })
            }
            onCreateSubfolder={(parent) => onCreateFolder(parent)}
            onEditFolder={onEditFolder}
            onReorderFolder={onReorderFolder}
            onRequestDeleteFolder={onRequestDeleteFolder}
          />
        </div>

        {/* Notes list section */}
        <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between px-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">
              {activeSectionTitle}
            </span>
            <button
              type="button"
              onClick={onCreateNote}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline px-1.5 py-1"
            >
              + New
            </button>
          </div>
          <NoteList
            notes={visibleNotes}
            selectedNoteId={selectedNoteId}
            folderById={folderById}
            showFolderBadge={showFolderBadge}
            emptyMessage={
              searchQuery.trim()
                ? 'No notes match your search.'
                : 'No notes here yet. Tap "+ New" to start one.'
            }
            onSelectNote={onSelectNote}
            onRequestDeleteNote={onRequestDeleteNote}
          />
        </div>
      </div>

      {/* Gentle 7-day backup reminder footer */}
      {showBackupReminder && (
        <div className="safe-bottom shrink-0 m-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-xs">
            <p className="font-medium text-amber-900 dark:text-amber-100">
              Time for a backup
            </p>
            <p className="text-amber-700 dark:text-amber-300 mt-0.5">
              Last backup: {lastBackupLabel}.
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="mt-1.5 font-semibold text-amber-900 dark:text-amber-100 underline underline-offset-2"
            >
              Back up now
            </button>
          </div>
          <button
            type="button"
            onClick={onDismissBackupReminder}
            aria-label="Dismiss reminder"
            className="min-h-8 min-w-8 -mt-1 -mr-1 flex items-center justify-center rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-200/50 dark:hover:bg-amber-900/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Touch & pointer resize handle on right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        style={{ touchAction: 'none' }}
        className={`absolute top-0 right-0 w-3 h-full cursor-col-resize translate-x-1/2 z-10 flex items-center justify-center group select-none ${
          resizing ? 'bg-blue-500/20' : ''
        }`}
      >
        <div
          className={`w-1 h-12 rounded-full transition ${
            resizing
              ? 'bg-blue-500 opacity-100'
              : 'bg-slate-300 dark:bg-slate-700 opacity-0 group-hover:opacity-100'
          }`}
        />
      </div>
    </aside>
  );
}
