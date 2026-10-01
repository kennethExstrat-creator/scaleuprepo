// Removing a deleted company's files from Supabase Storage. delete_company() deletes the database rows
// (documents included) but not the stored objects (docs/ARCHITECTURE.md §2.4), so the delete action lists
// everything under "<company_id>/" in the company-documents bucket and removes it with the service-role
// storage API (there is no DELETE policy for users). Storage lists one folder level at a time (folders
// come back as entries without an id), so the listing walks the folders.
// Pure: takes the bucket API as a parameter; unit-tested in tests/features/m1/storage-cleanup.test.ts.

export const COMPANY_DOCUMENTS_BUCKET = "company-documents";

export type StorageEntry = { name: string; id: string | null };
type StorageFailure = { message: string } | null;

/** The part of `supabase.storage.from(bucket)` this needs. */
export type StorageFolderApi = {
  list(
    path: string,
    options: { limit: number; offset: number; sortBy: { column: string; order: string } },
  ): PromiseLike<{ data: StorageEntry[] | null; error: StorageFailure }>;
  remove(paths: string[]): PromiseLike<{ error: StorageFailure }>;
};

export type ListOptions = { pageSize?: number; maxDepth?: number };

/** Every object path under `folder` (recursively, up to `maxDepth` folder levels below it). */
export async function listFilesUnder(
  api: StorageFolderApi,
  folder: string,
  { pageSize = 100, maxDepth = 5 }: ListOptions = {},
): Promise<string[]> {
  const files: string[] = [];
  const queue: { path: string; depth: number }[] = [{ path: folder, depth: 0 }];
  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await api.list(path, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not list the files in ${path}: ${error.message}`);
      const entries = data ?? [];
      for (const entry of entries) {
        if (!entry.name) continue;
        const child = `${path}/${entry.name}`;
        if (entry.id === null) {
          if (depth < maxDepth) queue.push({ path: child, depth: depth + 1 });
        } else {
          files.push(child);
        }
      }
      if (entries.length < pageSize) break;
    }
  }
  return files;
}

/** Removes every object under `folder`; returns how many were removed. Throws when listing or removing fails. */
export async function removeFolder(
  api: StorageFolderApi,
  folder: string,
  { batchSize = 100, ...listOptions }: ListOptions & { batchSize?: number } = {},
): Promise<number> {
  const files = await listFilesUnder(api, folder, listOptions);
  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize);
    const { error } = await api.remove(batch);
    if (error) throw new Error(`Could not remove ${batch.length} file(s) under ${folder}: ${error.message}`);
  }
  return files.length;
}
