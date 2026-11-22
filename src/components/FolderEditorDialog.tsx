import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_FOLDER_COLOR, FOLDER_COLORS } from '../types/models';

interface FolderEditorDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  parentName?: string | null;
  initialName?: string;
  initialColor?: string;
  onSave: (name: string, color: string) => void;
  onClose: () => void;
}

/**
 * Native <dialog> modal for creating a new folder/subfolder or editing an
 * existing folder's name and color.
 */
export function FolderEditorDialog({
  open,
  mode,
  parentName,
  initialName = '',
  initialColor = DEFAULT_FOLDER_COLOR,
  onSave,
  onClose,
}: FolderEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      setName(initialName);
      setColor(initialColor);
      if (!dialog.open) {
        dialog.showModal();
      }
      // Focus the text input so the iPad keyboard appears smoothly when creating/renaming
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, initialName, initialColor]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, color);
  };

  const heading =
    mode === 'edit'
      ? 'Edit Folder'
      : parentName
        ? `New Folder in "${parentName}"`
        : 'New Folder';

  return (
    <dialog
      ref={dialogRef}
      className="sn-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-5">
          <div>
            <label
              htmlFor="folder-name-input"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Folder name
            </label>
            <input
              ref={inputRef}
              id="folder-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={parentName ? 'e.g. Biology 101' : 'e.g. Fall 2026'}
              className="w-full min-h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Color
            </span>
            <div className="grid grid-cols-5 gap-2.5">
              {FOLDER_COLORS.map((swatch) => {
                const selected = color === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => setColor(swatch.hex)}
                    aria-label={swatch.name}
                    title={swatch.name}
                    className={`min-h-11 rounded-xl flex items-center justify-center border transition ${
                      selected
                        ? 'border-slate-900 dark:border-white bg-slate-100 dark:bg-slate-800 scale-105'
                        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <span
                      className="w-6 h-6 rounded-full shadow-sm"
                      style={{ backgroundColor: swatch.hex }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-4 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="min-h-11 px-5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40"
          >
            {mode === 'edit' ? 'Save Changes' : 'Create Folder'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
