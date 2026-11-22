/**
 * Shared TypeScript data models for StudyNotes.
 *
 * Designed in Phase 1 to support Phases 2–4 (PDF/photo imports, vector
 * handwriting, and page editing) without breaking schema changes.
 */

// Standard US Letter page size in PDF points (1 inch = 72 points)
export const US_LETTER_WIDTH_PT = 612; // 8.5 inches
export const US_LETTER_HEIGHT_PT = 792; // 11 inches

// Curated folder colors that stay readable in both Light and Dark mode
export const FOLDER_COLORS = [
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Purple', hex: '#A855F7' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Red', hex: '#EF4444' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Green', hex: '#22C55E' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Slate', hex: '#64748B' },
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[0].hex;

export interface Folder {
  id: string;
  /** null means top-level folder (e.g. a Semester); otherwise parent folder ID */
  parentId: string | null;
  name: string;
  color: string;
  /** Sort order among sibling folders (0, 1, 2, ...) */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
}

export interface Note {
  id: string;
  /** null means "Unfiled" */
  folderId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type PageBackground =
  | { kind: 'blank' }
  | { kind: 'pdf'; pdfRef: string; pageNum: number }
  | { kind: 'image'; imageRef: string };

export interface Page {
  id: string;
  noteId: string;
  /** 0-based order of the page inside the note */
  index: number;
  /** Width in PDF points (default 612 = 8.5 in) */
  widthPt: number;
  /** Height in PDF points (default 792 = 11 in) */
  heightPt: number;
  /** Clockwise rotation in degrees (used in Phase 4) */
  rotation: 0 | 90 | 180 | 270;
  background: PageBackground;
}

export interface StrokePoint {
  /** X coordinate in page PDF points (0..widthPt), independent of zoom */
  x: number;
  /** Y coordinate in page PDF points (0..heightPt), independent of zoom */
  y: number;
  /** Relative timestamp in ms for speed-based thinning (Apple Pencil USB-C) */
  t: number;
}

export interface Stroke {
  id: string;
  pageId: string;
  tool: 'pen' | 'highlighter';
  color: string;
  /** Stroke width in PDF points */
  width: number;
  opacity: number;
  points: StrokePoint[];
  createdAt: number;
}

/** Metadata for binary files (PDFs & photos) stored in OPFS /assets/<id> */
export interface AssetRecord {
  id: string;
  kind: 'pdf' | 'image';
  mimeType: string;
  originalName: string;
  byteSize: number;
  sha256: string;
  createdAt: number;
}

export interface SettingEntry {
  key: string;
  value: unknown;
}

export interface BackupManifest {
  format: 'studynotes-backup';
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  counts: {
    folders: number;
    notes: number;
    pages: number;
    strokes: number;
    assets: number;
  };
}

export interface BackupDatabaseDump {
  folders: Folder[];
  notes: Note[];
  pages: Page[];
  strokes: Stroke[];
  assets: AssetRecord[];
  settings: SettingEntry[];
}

export interface BackupInspection {
  manifest: BackupManifest;
  fileSize: number;
}

export interface BackupProgress {
  phase: 'preparing' | 'metadata' | 'assets' | 'finalizing' | 'safety' | 'restoring';
  label: string;
  /** 0 to 100 */
  percent: number;
}
