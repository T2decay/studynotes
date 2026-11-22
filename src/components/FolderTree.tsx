import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Palette,
  Trash2,
} from 'lucide-react';
import type { Folder, FolderNode } from '../types/models';

interface FolderTreeProps {
  nodes: FolderNode[];
  selectedFolderId: string | null;
  noteCountsByFolder: Map<string, number>;
  onSelectFolder: (folderId: string) => void;
  onCreateSubfolder: (parent: Folder) => void;
  onEditFolder: (folder: Folder) => void;
  onReorderFolder: (folderId: string, direction: 'up' | 'down') => void;
  onRequestDeleteFolder: (folder: Folder) => void;
}

/**
 * Renders nested folders (Semester > Class > Topic...) with touch-friendly
 * expand/collapse toggles and a compact action menu for each folder.
 */
export function FolderTree({
  nodes,
  selectedFolderId,
  noteCountsByFolder,
  onSelectFolder,
  onCreateSubfolder,
  onEditFolder,
  onReorderFolder,
  onRequestDeleteFolder,
}: FolderTreeProps) {
  // Track which folder IDs are collapsed (expanded by default so nesting is immediately visible)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // Track which folder currently has its inline action menu open
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (nodes.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
        No folders yet. Tap + to create a semester or class folder.
      </p>
    );
  }

  const renderNodes = (branch: FolderNode[], depth: number) => {
    return branch.map((node, index) => {
      const { folder, children } = node;
      const isSelected = selectedFolderId === folder.id;
      const isExpanded = !collapsedIds.has(folder.id);
      const hasChildren = children.length > 0;
      const noteCount = noteCountsByFolder.get(folder.id) ?? 0;
      const menuOpen = openMenuId === folder.id;
      const canMoveUp = index > 0;
      const canMoveDown = index < branch.length - 1;

      return (
        <div key={folder.id}>
          <div
            className={`group flex items-center gap-1 rounded-xl pr-1 transition ${
              isSelected
                ? 'bg-blue-500/12 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
            }`}
            style={{ paddingLeft: `${Math.min(depth, 5) * 14 + 4}px` }}
          >
            {/* Expand/collapse chevron */}
            <button
              type="button"
              onClick={() => hasChildren && toggleExpanded(folder.id)}
              aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
              className={`min-h-10 min-w-8 flex items-center justify-center rounded-lg text-slate-400 ${
                hasChildren
                  ? 'hover:bg-slate-200/70 dark:hover:bg-slate-700/70'
                  : 'opacity-0 pointer-events-none'
              }`}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>

            {/* Select folder button */}
            <button
              type="button"
              onClick={() => {
                setOpenMenuId(null);
                onSelectFolder(folder.id);
              }}
              className="flex-1 min-w-0 min-h-10 flex items-center gap-2.5 text-left"
            >
              <FolderIcon
                className="w-4 h-4 shrink-0"
                style={{ color: folder.color }}
                fill={folder.color}
                fillOpacity={0.22}
              />
              <span className="truncate text-sm font-medium">{folder.name}</span>
              {noteCount > 0 && (
                <span className="ml-auto text-xs tabular-nums text-slate-400 dark:text-slate-500 pr-1">
                  {noteCount}
                </span>
              )}
            </button>

            {/* Folder actions toggle button */}
            <button
              type="button"
              onClick={() => setOpenMenuId(menuOpen ? null : folder.id)}
              aria-label={`Actions for ${folder.name}`}
              aria-expanded={menuOpen}
              className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg transition ${
                menuOpen
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70'
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* Inline touch-friendly action bar (never clips outside scrollable sidebar on iPad) */}
          {menuOpen && (
            <div
              className="my-1 mr-1 p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap gap-1"
              style={{ marginLeft: `${Math.min(depth, 5) * 14 + 12}px` }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  onCreateSubfolder(folder);
                }}
                className="min-h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Subfolder
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  onEditFolder(folder);
                }}
                className="min-h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Palette className="w-3.5 h-3.5" />
                Rename / Color
              </button>
              <button
                type="button"
                disabled={!canMoveUp}
                onClick={() => onReorderFolder(folder.id, 'up')}
                title="Move up"
                aria-label="Move folder up"
                className="min-h-9 min-w-9 px-2 rounded-lg text-xs font-medium flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                onClick={() => onReorderFolder(folder.id, 'down')}
                title="Move down"
                aria-label="Move folder down"
                className="min-h-9 min-w-9 px-2 rounded-lg text-xs font-medium flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  onRequestDeleteFolder(folder);
                }}
                className="min-h-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          )}

          {/* Render nested subfolders */}
          {hasChildren && isExpanded && (
            <div className="mt-0.5">{renderNodes(children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return <div className="space-y-0.5">{renderNodes(nodes, 0)}</div>;
}
