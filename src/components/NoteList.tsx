import { FileText, Trash2 } from 'lucide-react';
import type { Folder, Note } from '../types/models';

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  folderById: Map<string, Folder>;
  showFolderBadge: boolean;
  emptyMessage: string;
  onSelectNote: (noteId: string) => void;
  onRequestDeleteNote: (note: Note) => void;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Scrollable list of notes inside the sidebar showing title, last modified date,
 * optional folder badge (in All Notes / Search), and a safe delete button.
 */
export function NoteList({
  notes,
  selectedNoteId,
  folderById,
  showFolderBadge,
  emptyMessage,
  onSelectNote,
  onRequestDeleteNote,
}: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {notes.map((note) => {
        const isSelected = note.id === selectedNoteId;
        const folder = note.folderId ? folderById.get(note.folderId) : null;

        return (
          <div
            key={note.id}
            className={`group flex items-center gap-1 rounded-xl pr-1 transition ${
              isSelected
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-800 dark:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectNote(note.id)}
              className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-start gap-2.5"
            >
              <FileText
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {note.title || 'Untitled Note'}
                </div>
                <div
                  className={`mt-0.5 flex items-center gap-2 text-xs ${
                    isSelected
                      ? 'text-blue-100'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <span>{dateFormatter.format(note.updatedAt)}</span>
                  {showFolderBadge && (
                    <span className="inline-flex items-center gap-1 truncate max-w-[140px]">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: folder
                            ? folder.color
                            : isSelected
                              ? '#bfdbfe'
                              : '#94a3b8',
                        }}
                      />
                      <span className="truncate">
                        {folder ? folder.name : 'Unfiled'}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onRequestDeleteNote(note)}
              aria-label={`Delete ${note.title}`}
              className={`min-h-10 min-w-10 flex items-center justify-center rounded-lg transition ${
                isSelected
                  ? 'text-blue-100 hover:bg-blue-700'
                  : 'text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70'
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
