import { db } from './database';

export const SETTING_KEYS = {
  lastBackupAt: 'lastBackupAt',
  preRestoreBackupAt: 'preRestoreBackupAt',
  sidebarWidth: 'sidebarWidth',
  sidebarCollapsed: 'sidebarCollapsed',
} as const;

export const BACKUP_REMINDER_DAYS = 7;
export const DEFAULT_SIDEBAR_WIDTH = 310;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 480;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const entry = await db.settings.get(key);
  if (!entry || entry.value === undefined) {
    return fallback;
  }
  return entry.value as T;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value });
}

export function getDaysSince(timestamp: number | null): number | null {
  if (timestamp === null) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.floor((Date.now() - timestamp) / msPerDay));
}

export function formatLastBackupLabel(lastBackupAt: number | null): string {
  const days = getDaysSince(lastBackupAt);
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/**
 * Returns true when the gentle 7-day backup reminder should appear:
 * - Either it has been 7+ days since the last backup, OR
 * - She has never backed up and her oldest note is at least 7 days old.
 */
export function isBackupReminderDue(
  lastBackupAt: number | null,
  oldestNoteCreatedAt: number | null
): boolean {
  if (lastBackupAt !== null) {
    const days = getDaysSince(lastBackupAt);
    return days !== null && days >= BACKUP_REMINDER_DAYS;
  }
  if (oldestNoteCreatedAt !== null) {
    const daysSinceFirstNote = getDaysSince(oldestNoteCreatedAt);
    return daysSinceFirstNote !== null && daysSinceFirstNote >= BACKUP_REMINDER_DAYS;
  }
  return false;
}
