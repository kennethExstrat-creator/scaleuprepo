import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyDraft,
  numberDraft,
  textDraft,
  withFieldValue,
  type DraftValues,
  type PayloadTypes,
  type SavePayload,
} from "@/components/submission-form/draft";
import { AUTOSAVE_DEBOUNCE_MS, DraftStore, type SaveResult } from "@/components/submission-form/draft-store";

const TYPES: PayloadTypes = {
  fieldTypes: { gross_profit: "currency", net_profit: "currency", key_milestones: "long_text" },
  kpiTypes: {},
};

type Deferred = { resolve: (result: SaveResult) => void; reject: (error: unknown) => void };

/** A save function whose calls resolve only when the test says so. */
function controlledSave() {
  const calls: SavePayload[] = [];
  const pending: Deferred[] = [];
  const save = vi.fn((payload: SavePayload) => {
    calls.push(payload);
    return new Promise<SaveResult>((resolve, reject) => pending.push({ resolve, reject }));
  });
  return {
    save,
    calls,
    async succeed(savedAt = "2026-09-30T06:05:00.000000+00:00") {
      pending.shift()?.resolve({ ok: true, savedAt });
      await vi.advanceTimersByTimeAsync(0);
    },
    async fail(error = "Sep 2026 has been submitted and is awaiting review, so it can no longer be edited.") {
      pending.shift()?.resolve({ ok: false, error });
      await vi.advanceTimersByTimeAsync(0);
    },
    async throwNetwork() {
      pending.shift()?.reject(new TypeError("Failed to fetch"));
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

type StoreOptions = { initial: DraftValues; saved: DraftValues; enabled: boolean; lastSavedAt: string | null };

function makeStore(save: (payload: SavePayload) => Promise<SaveResult>, options: Partial<StoreOptions> = {}) {
  const saved = options.saved ?? emptyDraft();
  return new DraftStore({
    initial: options.initial ?? saved,
    saved,
    lastSavedAt: options.lastSavedAt ?? null,
    types: TYPES,
    save,
    enabled: options.enabled ?? true,
  });
}

const setGross = (value: number | null) => (draft: DraftValues) =>
  withFieldValue(draft, "gross_profit", value === null ? null : numberDraft(value));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DraftStore autosave", () => {
  it("debounces edits into one save with only the changed entries", async () => {
    const server = controlledSave();
    const store = makeStore(server.save, { saved: { ...emptyDraft(), values: { net_profit: numberDraft(-5) } } });
    expect(store.getSnapshot().status).toBe("idle");

    store.update(setGross(1));
    store.update(setGross(12));
    store.update(setGross(120));
    expect(store.getSnapshot()).toMatchObject({ status: "pending", unsaved: 1 });

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(server.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.save).toHaveBeenCalledTimes(1);
    expect(server.calls[0]).toEqual({ values: [{ key: "gross_profit", value_number: 120 }], segments: [], kpis: [] });
    expect(store.getSnapshot().status).toBe("saving");

    await server.succeed("2026-09-30T06:05:00.000000+00:00");
    expect(store.getSnapshot()).toMatchObject({
      status: "saved",
      unsaved: 0,
      lastSavedAt: "2026-09-30T06:05:00.000000+00:00",
      error: null,
    });
    expect(store.hasUnsavedWork()).toBe(false);
  });

  it("never runs two saves at once; changes made meanwhile go out next", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);

    store.update(setGross(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(server.save).toHaveBeenCalledTimes(1);

    // Typing continues while the first save is in flight.
    store.update(setGross(2));
    store.update((draft) => withFieldValue(draft, "key_milestones", textDraft("Opened KL office")));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(server.save).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().status).toBe("saving");

    await server.succeed("2026-09-30T06:05:00Z");
    expect(store.getSnapshot()).toMatchObject({ status: "pending", unsaved: 2 });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.calls[1].values).toEqual([
      { key: "gross_profit", value_number: 2 },
      { key: "key_milestones", value_text: "Opened KL office" },
    ]);
    await server.succeed("2026-09-30T06:05:02Z");
    expect(store.getSnapshot()).toMatchObject({ status: "saved", unsaved: 0 });
  });

  it("keeps changes after a failure and saves them on retry", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);

    store.update(setGross(10));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await server.fail("Couldn't reach the server. Please try again.");
    expect(store.getSnapshot()).toMatchObject({
      status: "error",
      unsaved: 1,
      error: "Couldn't reach the server. Please try again.",
    });
    expect(store.hasUnsavedWork()).toBe(true);

    // No automatic retry loop...
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 5);
    expect(server.save).toHaveBeenCalledTimes(1);

    // ...but Retry sends the same change again.
    store.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.calls[1]).toEqual(server.calls[0]);
    await server.succeed();
    expect(store.getSnapshot()).toMatchObject({ status: "saved", error: null, unsaved: 0 });
  });

  it("treats a thrown request (offline) as a failure with a friendly message", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);
    store.update(setGross(10));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await server.throwNetwork();
    expect(store.getSnapshot().status).toBe("error");
    expect(store.getSnapshot().error).toMatch(/Couldn't reach the server/);
  });

  it("a later edit tries again after a failure, and undoing the change clears the error", async () => {
    const server = controlledSave();
    const store = makeStore(server.save, { saved: { ...emptyDraft(), values: { gross_profit: numberDraft(5) } } });
    store.update(setGross(10));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await server.fail();
    store.update(setGross(11));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(server.save).toHaveBeenCalledTimes(2);
    await server.fail();
    expect(store.getSnapshot().status).toBe("error");

    // Back to what the server has: nothing to save, so the failure no longer matters.
    store.update(setGross(5));
    expect(store.getSnapshot()).toMatchObject({ status: "idle", unsaved: 0, error: null });
  });

  it("flush() saves now, waits for a save in flight and reports failures", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);

    store.update(setGross(1));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    store.update(setGross(2));

    let flushed: boolean | undefined;
    void store.flush().then((result) => {
      flushed = result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.save).toHaveBeenCalledTimes(1);
    await server.succeed("2026-09-30T06:05:00Z");
    // The rest goes out straight away, without waiting for the debounce.
    expect(server.save).toHaveBeenCalledTimes(2);
    expect(server.calls[1].values).toEqual([{ key: "gross_profit", value_number: 2 }]);
    await server.succeed("2026-09-30T06:05:01Z");
    expect(flushed).toBe(true);

    store.update(setGross(3));
    const failing = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    await server.fail();
    await expect(failing).resolves.toBe(false);
    expect(store.getSnapshot().unsaved).toBe(1);
  });

  it("flush() with nothing to save resolves true without calling the server", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);
    await expect(store.flush()).resolves.toBe(true);
    expect(server.save).not.toHaveBeenCalled();
  });

  it("start() saves a draft that differs from the server from the outset (e.g. a corrected total)", async () => {
    const server = controlledSave();
    const saved = { ...emptyDraft(), values: { gross_profit: numberDraft(1) } };
    const store = makeStore(server.save, { saved, initial: setGross(2)(saved) });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(server.save).not.toHaveBeenCalled(); // nothing is sent before the form is mounted
    store.start();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(server.calls).toEqual([{ values: [{ key: "gross_profit", value_number: 2 }], segments: [], kpis: [] }]);
  });

  it("a read-only store never saves", async () => {
    const server = controlledSave();
    const store = makeStore(server.save, { enabled: false });
    store.update(setGross(1));
    store.start();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    await expect(store.flush()).resolves.toBe(true);
    expect(server.save).not.toHaveBeenCalled();
  });

  it("stop() cancels a scheduled save", async () => {
    const server = controlledSave();
    const store = makeStore(server.save);
    store.update(setGross(1));
    store.stop();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(server.save).not.toHaveBeenCalled();
  });

  it("tracks unreadable inputs as unsaved work", () => {
    const store = makeStore(controlledSave().save);
    store.setInvalid("field:gross_profit", "Enter a number, for example 1,234.50.");
    expect(store.getSnapshot().invalid).toEqual({ "field:gross_profit": "Enter a number, for example 1,234.50." });
    expect(store.hasUnsavedWork()).toBe(true);
    store.setInvalid("field:gross_profit", null);
    expect(store.getSnapshot().invalid).toEqual({});
    expect(store.hasUnsavedWork()).toBe(false);
  });

  it("notifies subscribers with a new snapshot on every change", () => {
    const store = makeStore(controlledSave().save);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();
    store.update(setGross(1));
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).not.toBe(before);
    unsubscribe();
    listener.mockClear();
    store.update(setGross(2));
    expect(listener).not.toHaveBeenCalled();
    // An edit that changes nothing keeps the same snapshot.
    const same = store.getSnapshot();
    store.update((draft) => draft);
    expect(store.getSnapshot()).toBe(same);
  });
});

describe("DraftStore.syncFromServer", () => {
  const T0 = "2026-09-30T06:00:00Z";
  const T1 = "2026-09-30T06:05:00Z";

  it("adopts newer values for untouched entries and keeps local changes", () => {
    const saved = { ...emptyDraft(), values: { gross_profit: numberDraft(1), net_profit: numberDraft(1) } };
    const store = makeStore(controlledSave().save, { saved, lastSavedAt: T0 });
    store.update((draft) => withFieldValue(draft, "net_profit", numberDraft(7)));

    store.syncFromServer(
      {
        ...emptyDraft(),
        values: { gross_profit: numberDraft(2), net_profit: numberDraft(3), key_milestones: textDraft("Hi") },
      },
      T1,
    );
    const snapshot = store.getSnapshot();
    expect(snapshot.draft.values).toEqual({
      gross_profit: numberDraft(2),
      net_profit: numberDraft(7),
      key_milestones: textDraft("Hi"),
    });
    expect(snapshot.lastSavedAt).toBe(T1);
    expect(snapshot.unsaved).toBe(1);
  });

  it("ignores values older than what it already knows", async () => {
    const server = controlledSave();
    const store = makeStore(server.save, { lastSavedAt: T0 });
    store.update(setGross(5));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await server.succeed(T1);

    // A page rendered before that save arrives late.
    store.syncFromServer(emptyDraft(), T0);
    expect(store.getSnapshot().draft.values).toEqual({ gross_profit: numberDraft(5) });
    expect(store.getSnapshot()).toMatchObject({ unsaved: 0, lastSavedAt: T1 });

    // Never saved on the server at all (null) is also older.
    store.syncFromServer(emptyDraft(), null);
    expect(store.getSnapshot().draft.values).toEqual({ gross_profit: numberDraft(5) });
  });

  it("does not touch entries that are being saved", async () => {
    const server = controlledSave();
    const store = makeStore(server.save, { lastSavedAt: T0 });
    store.update(setGross(5));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    // The page re-renders while the save is in flight (same version as before).
    store.syncFromServer(emptyDraft(), T0);
    expect(store.getSnapshot().draft.values).toEqual({ gross_profit: numberDraft(5) });
    await server.succeed(T1);
    expect(store.getSnapshot()).toMatchObject({ status: "saved", unsaved: 0 });
  });
});
