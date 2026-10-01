// Autosave engine of the monthly form: holds the draft and what the server has, debounces saves (about
// 1.2 s after the last change), sends only the changed entries, never runs two saves at once, keeps
// unsaved changes after a failure (retry, or the next change tries again) and adopts newer server values
// for entries the person has not touched. Framework-free: the form reads it with useSyncExternalStore
// (subscribe / getSnapshot); unit tests drive it with fake timers (tests/features/m5).

import { parseInstant } from "@/lib/periods";

import {
  applySaved,
  buildSavePayload,
  countChanges,
  diffDraft,
  emptyChangeSet,
  hasChanges,
  mergeServerValues,
  pickChanged,
  type ChangeSet,
  type DraftValues,
  type PayloadTypes,
  type SavePayload,
} from "./draft";

/** `savedAt`: the new `last_saved_at` (null when the server did not report one). */
export type SaveResult = { ok: true; savedAt: string | null } | { ok: false; error: string };
export type SaveFunction = (payload: SavePayload) => Promise<SaveResult>;

/**
 * - `idle`: nothing changed since the page loaded and nothing was ever saved;
 * - `pending`: changes wait for the debounce (or for the next attempt);
 * - `saving`: a save is in flight;
 * - `saved`: everything is saved (`lastSavedAt`);
 * - `error`: the last save failed; the changes are kept (`error` holds the message).
 */
export type DraftStatus = "idle" | "pending" | "saving" | "saved" | "error";

export type DraftSnapshot = {
  draft: DraftValues;
  status: DraftStatus;
  /** Changed entries not saved yet (including those in flight). */
  unsaved: number;
  error: string | null;
  lastSavedAt: string | null;
  /** Inputs whose text could not be read, by target (e.g. 'field:gross_profit'); they are not saved. */
  invalid: Readonly<Record<string, string>>;
};

export type DraftStoreOptions = {
  /** What the form starts with (may differ from `saved`, e.g. a corrected revenue total). */
  initial: DraftValues;
  /** What the server has. */
  saved: DraftValues;
  /** `submissions.last_saved_at` of the loaded values. */
  lastSavedAt: string | null;
  types: PayloadTypes;
  save: SaveFunction;
  /** False for read-only forms: nothing is ever saved. */
  enabled: boolean;
  debounceMs?: number;
};

export const AUTOSAVE_DEBOUNCE_MS = 1200;
const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";
const MAX_FLUSH_ROUNDS = 5;

export class DraftStore {
  private draft: DraftValues;
  private saved: DraftValues;
  private lastSavedAt: string | null;
  /** Newest server version known (epoch ms of last_saved_at), to ignore stale server values. */
  private version: number | null;
  private error: string | null = null;
  private invalid: Record<string, string> = {};
  private inflight: { changes: ChangeSet; promise: Promise<void> } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: DraftSnapshot;
  private readonly types: PayloadTypes;
  private readonly save: SaveFunction;
  private readonly enabled: boolean;
  private readonly debounceMs: number;

  constructor(options: DraftStoreOptions) {
    this.draft = options.initial;
    this.saved = options.saved;
    this.lastSavedAt = options.lastSavedAt;
    this.version = parseInstant(options.lastSavedAt);
    this.types = options.types;
    this.save = options.save;
    this.enabled = options.enabled;
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.snapshot = this.buildSnapshot();
  }

  // --- useSyncExternalStore -------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DraftSnapshot => this.snapshot;

  // --- Editing --------------------------------------------------------------------------------

  /** Applies an edit to the draft and schedules a save. */
  update(recipe: (draft: DraftValues) => DraftValues): void {
    const next = recipe(this.draft);
    if (next === this.draft) return;
    this.draft = next;
    this.emit();
    this.schedule();
  }

  /** Marks an input whose text cannot be saved (message) or clears the mark (null). */
  setInvalid(target: string, message: string | null): void {
    if (message === null) {
      if (!(target in this.invalid)) return;
      const next = { ...this.invalid };
      delete next[target];
      this.invalid = next;
    } else {
      if (this.invalid[target] === message) return;
      this.invalid = { ...this.invalid, [target]: message };
    }
    this.emit();
  }

  /** Changes not saved yet, a save in flight, or inputs that cannot be saved. */
  hasUnsavedWork(): boolean {
    return (
      this.inflight !== null || hasChanges(diffDraft(this.saved, this.draft)) || Object.keys(this.invalid).length > 0
    );
  }

  // --- Saving ---------------------------------------------------------------------------------

  /** Call once mounted in the browser: saves changes the form started with (never on the server). */
  start(): void {
    if (this.enabled && hasChanges(diffDraft(this.saved, this.draft))) this.schedule();
  }

  /** Cancels a scheduled save (e.g. on unmount, after flush()). */
  stop(): void {
    this.clearTimer();
  }

  /** Tries the failed save again now. */
  retry(): void {
    void this.flush();
  }

  /**
   * Saves every change now (waiting for a save in flight first). Resolves true when everything is saved,
   * false when a save failed (the changes are kept; `error` explains why).
   */
  async flush(): Promise<boolean> {
    this.clearTimer();
    if (!this.enabled) return true;
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
      if (this.inflight) {
        await this.inflight.promise;
        continue;
      }
      if (!hasChanges(diffDraft(this.saved, this.draft))) {
        // Nothing left to save: an earlier failure no longer matters.
        this.clearTimer();
        if (this.error !== null) {
          this.error = null;
          this.emit();
        }
        return true;
      }
      await this.runSave();
      if (this.error !== null) return false;
    }
    return !hasChanges(diffDraft(this.saved, this.draft)) && this.error === null;
  }

  /**
   * Newer values from the server (a re-rendered page, or the values checked before submitting). Ignored
   * when older than what this store already knows (`lastSavedAt` before the newest known save).
   */
  syncFromServer(values: DraftValues, lastSavedAt: string | null): void {
    const version = parseInstant(lastSavedAt);
    if (this.version !== null && (version === null || version < this.version)) return;
    const busy = this.inflight?.changes ?? emptyChangeSet();
    const merged = mergeServerValues(this.draft, this.saved, values, busy);
    this.draft = merged.draft;
    this.saved = merged.saved;
    if (version !== null) {
      this.version = version;
      this.lastSavedAt = lastSavedAt;
    }
    this.emit();
  }

  private schedule(): void {
    if (!this.enabled) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runSave();
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Sends the current changes (one save at a time; a save in flight is returned instead). */
  private runSave(): Promise<void> {
    if (this.inflight) return this.inflight.promise;
    const changes = diffDraft(this.saved, this.draft);
    if (!hasChanges(changes)) {
      this.emit();
      return Promise.resolve();
    }
    const sent = pickChanged(this.draft, changes);
    const payload = buildSavePayload(this.draft, changes, this.types);

    let finish: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // Marked in flight before the request starts, so nothing else can send the same changes.
    this.inflight = { changes, promise };
    this.error = null;
    this.emit();
    void this.send(payload, sent, changes).finally(finish);
    return promise;
  }

  private async send(payload: SavePayload, sent: DraftValues, changes: ChangeSet): Promise<void> {
    let result: SaveResult;
    try {
      result = await this.save(payload);
    } catch {
      result = { ok: false, error: NETWORK_ERROR };
    }
    this.inflight = null;
    if (result.ok) {
      this.saved = applySaved(this.saved, sent, changes);
      this.error = null;
      const version = parseInstant(result.savedAt);
      if (version !== null && (this.version === null || version >= this.version)) {
        this.version = version;
        this.lastSavedAt = result.savedAt;
      }
    } else {
      this.error = result.error || NETWORK_ERROR;
    }
    this.emit();
    // Changes made while this save was in flight go out with the next one.
    if (result.ok && hasChanges(diffDraft(this.saved, this.draft))) this.schedule();
  }

  // --- Snapshot -------------------------------------------------------------------------------

  private buildSnapshot(): DraftSnapshot {
    const unsaved = countChanges(diffDraft(this.saved, this.draft));
    // A failure only matters while there is something left to save (e.g. not after undoing the change).
    if (unsaved === 0 && this.inflight === null) this.error = null;
    const status: DraftStatus = this.inflight
      ? "saving"
      : this.error !== null
        ? "error"
        : unsaved > 0
          ? "pending"
          : this.lastSavedAt
            ? "saved"
            : "idle";
    return {
      draft: this.draft,
      status,
      unsaved,
      error: this.error,
      lastSavedAt: this.lastSavedAt,
      invalid: this.invalid,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
