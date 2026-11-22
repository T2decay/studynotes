import Dexie, { type EntityTable } from 'dexie';
import type {
  AssetRecord,
  Folder,
  Note,
  Page,
  SettingEntry,
  Stroke,
} from '../types/models';

export const DB_SCHEMA_VERSION = 1;
export const APP_VERSION = '0.1.0';

/**
 * Local IndexedDB database powered by Dexie.js.
 *
 * IMPORTANT: Never modify existing version(1) stores in place.
 * Any future schema change MUST add a new `this.version(2)` block with an
 * `.upgrade(...)` migration that preserves all existing user data.
 */
class StudyNotesDB extends Dexie {
  folders!: EntityTable<Folder, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  pages!: EntityTable<Page, 'id'>;
  strokes!: EntityTable<Stroke, 'id'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;

  constructor() {
    super('StudyNotesDB');

    this.version(1).stores({
      folders: 'id, parentId, order',
      notes: 'id, folderId, updatedAt, createdAt',
      pages: 'id, noteId, [noteId+index]',
      strokes: 'id, pageId, createdAt',
      assets: 'id, sha256',
      settings: 'key',
    });
  }
}

export const db = new StudyNotesDB();
