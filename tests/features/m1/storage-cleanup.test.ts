import { describe, expect, it } from "vitest";

import {
  listFilesUnder,
  removeFolder,
  type StorageEntry,
  type StorageFolderApi,
} from "@/app/admin/companies/_components/storage-cleanup";

/**
 * A fake bucket over object paths that lists like Supabase Storage: one folder level at a time, folders as
 * entries without an id, sorted by name, paginated with limit/offset.
 */
function fakeBucket(paths: string[], failures: { list?: string; remove?: string } = {}) {
  const objects = new Set(paths);
  const removed: string[][] = [];
  const listed: string[] = [];
  const api: StorageFolderApi = {
    async list(path, { limit, offset }) {
      listed.push(`${path}@${offset}`);
      if (failures.list && path === failures.list) return { data: null, error: { message: "list failed" } };
      const prefix = `${path}/`;
      const entries = new Map<string, StorageEntry>();
      for (const object of objects) {
        if (!object.startsWith(prefix)) continue;
        const [first, ...rest] = object.slice(prefix.length).split("/");
        entries.set(first, { name: first, id: rest.length > 0 ? null : `id-${object}` });
      }
      const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
      return { data: sorted.slice(offset, offset + limit), error: null };
    },
    async remove(batch) {
      if (failures.remove) return { error: { message: failures.remove } };
      removed.push(batch);
      for (const path of batch) objects.delete(path);
      return { error: null };
    },
  };
  return { api, objects, removed, listed };
}

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OTHER = "c0000000-0000-4000-8000-000000000002";
const CLOSE = "d0000000-0000-4000-8000-000000000001";

describe("listFilesUnder", () => {
  it("walks the folders and pages through long listings", async () => {
    const files = [
      ...Array.from({ length: 7 }, (_, i) => `${COMPANY}/general/${i}-report.pdf`),
      `${COMPANY}/${CLOSE}/q3-accounts.xlsx`,
      `${OTHER}/general/not-mine.pdf`,
    ];
    const { api, listed } = fakeBucket(files);
    const found = await listFilesUnder(api, COMPANY, { pageSize: 3 });
    expect(found.sort()).toEqual(files.filter((file) => file.startsWith(COMPANY)).sort());
    // general has 7 files → pages at offsets 0, 3 and 6.
    expect(listed).toContain(`${COMPANY}/general@6`);
  });

  it("stops at the depth limit", async () => {
    const { api } = fakeBucket([`${COMPANY}/a/b/c/deep.pdf`, `${COMPANY}/top.pdf`]);
    expect(await listFilesUnder(api, COMPANY, { maxDepth: 1 })).toEqual([`${COMPANY}/top.pdf`]);
    expect((await listFilesUnder(api, COMPANY, { maxDepth: 3 })).sort()).toEqual([
      `${COMPANY}/a/b/c/deep.pdf`,
      `${COMPANY}/top.pdf`,
    ]);
  });

  it("returns nothing for an empty folder", async () => {
    const { api } = fakeBucket([]);
    expect(await listFilesUnder(api, COMPANY)).toEqual([]);
  });

  it("throws when a listing fails", async () => {
    const { api } = fakeBucket([`${COMPANY}/general/a.pdf`], { list: `${COMPANY}/general` });
    await expect(listFilesUnder(api, COMPANY)).rejects.toThrow("list failed");
  });
});

describe("removeFolder", () => {
  it("removes every file of the company in batches and leaves other companies alone", async () => {
    const mine = Array.from({ length: 5 }, (_, i) => `${COMPANY}/general/${i}.pdf`);
    const { api, objects, removed } = fakeBucket([...mine, `${OTHER}/general/keep.pdf`]);
    expect(await removeFolder(api, COMPANY, { batchSize: 2 })).toBe(5);
    expect(removed.map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect([...objects]).toEqual([`${OTHER}/general/keep.pdf`]);
  });

  it("does nothing when there are no files", async () => {
    const { api, removed } = fakeBucket([]);
    expect(await removeFolder(api, COMPANY)).toBe(0);
    expect(removed).toEqual([]);
  });

  it("throws when removing fails", async () => {
    const { api } = fakeBucket([`${COMPANY}/general/a.pdf`], { remove: "denied" });
    await expect(removeFolder(api, COMPANY)).rejects.toThrow("denied");
  });
});
