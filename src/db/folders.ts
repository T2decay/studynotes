import { db } from './database';
import {
  DEFAULT_FOLDER_COLOR,
  type Folder,
  type FolderNode,
} from '../types/models';

/** Creates a new folder (top-level if parentId is null, or nested inside parentId). */
export async function createFolder(params: {
  name: string;
  parentId: string | null;
  color?: string;
}): Promise<Folder> {
  const trimmed = params.name.trim() || 'Untitled Folder';
  const siblings = await getSiblingFolders(params.parentId);
  const maxOrder = siblings.reduce((max, f) => Math.max(max, f.order), -1);
  const now = Date.now();

  const folder: Folder = {
    id: crypto.randomUUID(),
    parentId: params.parentId,
    name: trimmed,
    color: params.color ?? DEFAULT_FOLDER_COLOR,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.folders.add(folder);
  return folder;
}

/** Renames an existing folder. */
export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.folders.update(id, { name: trimmed, updatedAt: Date.now() });
}

/** Changes a folder's accent color. */
export async function recolorFolder(id: string, color: string): Promise<void> {
  await db.folders.update(id, { color, updatedAt: Date.now() });
}

/** Moves a folder up or down among its siblings and normalizes sibling order values. */
export async function reorderFolder(
  id: string,
  direction: 'up' | 'down'
): Promise<void> {
  const target = await db.folders.get(id);
  if (!target) return;

  const siblings = await getSiblingFolders(target.parentId);
  const currentIndex = siblings.findIndex((f) => f.id === id);
  if (currentIndex === -1) return;

  const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return;

  // Swap positions in memory, then persist clean 0..n-1 order numbers in one transaction
  const reordered = [...siblings];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(swapIndex, 0, moved);

  const now = Date.now();
  await db.transaction('rw', db.folders, async () => {
    for (let i = 0; i < reordered.length; i++) {
      await db.folders.update(reordered[i].id, { order: i, updatedAt: now });
    }
  });
}

/** Returns how many subfolders and notes will be affected before deleting a folder. */
export async function getFolderDeleteImpact(
  folderId: string
): Promise<{ subfolderCount: number; noteCount: number }> {
  const allFolders = await db.folders.toArray();
  const affectedIds = collectFolderAndDescendantIds(folderId, allFolders);
  const notesInTree = await db.notes
    .filter((note) => note.folderId !== null && affectedIds.has(note.folderId))
    .count();

  return {
    subfolderCount: Math.max(0, affectedIds.size - 1),
    noteCount: notesInTree,
  };
}

/**
 * Safely deletes a folder and any nested subfolders inside it.
 * All notes in the deleted folder (and its subfolders) are preserved by moving
 * them to "Unfiled" (folderId = null) inside one atomic transaction.
 */
export async function deleteFolderSafely(folderId: string): Promise<void> {
  await db.transaction('rw', db.folders, db.notes, async () => {
    const allFolders = await db.folders.toArray();
    const affectedIds = collectFolderAndDescendantIds(folderId, allFolders);
    const now = Date.now();

    // Move all notes inside the deleted folder subtree to Unfiled
    const affectedNotes = await db.notes
      .filter((note) => note.folderId !== null && affectedIds.has(note.folderId))
      .toArray();

    for (const note of affectedNotes) {
      await db.notes.update(note.id, { folderId: null, updatedAt: now });
    }

    // Delete the folder and its descendant folders
    await db.folders.bulkDelete([...affectedIds]);
  });
}

/** Builds a nested tree structure sorted by `order` (then name) at each level. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, Folder[]>();
  const validIds = new Set(folders.map((f) => f.id));

  for (const folder of folders) {
    // If a parent was somehow missing, treat as top-level so nothing gets lost
    const parentKey =
      folder.parentId && validIds.has(folder.parentId) ? folder.parentId : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(folder);
    byParent.set(parentKey, list);
  }

  const sortFolders = (list: Folder[]) =>
    [...list].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const buildBranch = (parentId: string | null, visited: Set<string>): FolderNode[] => {
    const children = sortFolders(byParent.get(parentId) ?? []);
    const nodes: FolderNode[] = [];

    for (const folder of children) {
      if (visited.has(folder.id)) continue; // Guard against accidental cycles
      visited.add(folder.id);
      nodes.push({
        folder,
        children: buildBranch(folder.id, visited),
      });
    }
    return nodes;
  };

  return buildBranch(null, new Set());
}

/** Returns a flat list of folders with depth indentation (for folder picker dropdowns). */
export function flattenFolderTree(
  nodes: FolderNode[],
  depth = 0
): Array<{ folder: Folder; depth: number }> {
  const result: Array<{ folder: Folder; depth: number }> = [];
  for (const node of nodes) {
    result.push({ folder: node.folder, depth });
    result.push(...flattenFolderTree(node.children, depth + 1));
  }
  return result;
}

/** Collects a folder ID and all of its descendant folder IDs. */
export function collectFolderAndDescendantIds(
  rootId: string,
  allFolders: Folder[]
): Set<string> {
  const result = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of allFolders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

async function getSiblingFolders(parentId: string | null): Promise<Folder[]> {
  const all = await db.folders.toArray();
  return all
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
