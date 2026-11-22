import { db } from './database';
import {
  US_LETTER_HEIGHT_PT,
  US_LETTER_WIDTH_PT,
  type Note,
  type Page,
} from '../types/models';

/**
 * Creates a new note along with its first blank US Letter white page.
 * Everything happens inside one atomic Dexie transaction.
 */
export async function createNote(params: {
  folderId: string | null;
  title?: string;
}): Promise<Note> {
  const now = Date.now();
  const noteId = crypto.randomUUID();
  const trimmedTitle = params.title?.trim() || 'Untitled Note';

  const note: Note = {
    id: noteId,
    folderId: params.folderId,
    title: trimmedTitle,
    createdAt: now,
    updatedAt: now,
  };

  const firstPage: Page = {
    id: crypto.randomUUID(),
    noteId,
    index: 0,
    widthPt: US_LETTER_WIDTH_PT,
    heightPt: US_LETTER_HEIGHT_PT,
    rotation: 0,
    background: { kind: 'blank' },
  };

  await db.transaction('rw', db.notes, db.pages, async () => {
    await db.notes.add(note);
    await db.pages.add(firstPage);
  });

  return note;
}

/** Updates a note's title and bumps its updatedAt timestamp. */
export async function renameNote(id: string, title: string): Promise<void> {
  const trimmed = title.trim() || 'Untitled Note';
  await db.notes.update(id, { title: trimmed, updatedAt: Date.now() });
}

/** Moves a note into another folder (or pass null for Unfiled). */
export async function moveNoteToFolder(
  id: string,
  folderId: string | null
): Promise<void> {
  await db.notes.update(id, { folderId, updatedAt: Date.now() });
}

/** Deletes a note, all of its pages, and all strokes on those pages. */
export async function deleteNote(noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.pages, db.strokes, async () => {
    const pages = await db.pages.where('noteId').equals(noteId).toArray();
    const pageIds = pages.map((p) => p.id);

    if (pageIds.length > 0) {
      await db.strokes.where('pageId').anyOf(pageIds).delete();
      await db.pages.bulkDelete(pageIds);
    }

    await db.notes.delete(noteId);
  });
}
