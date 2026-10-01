"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { listComments } from "@/lib/actions/comments";

import type { CommentThread } from "./types";

type FetchState = { threads: CommentThread[] | null; error: string | null };

const EMPTY: FetchState = { threads: null, error: null };

export type CommentThreadsState = {
  /** The threads, or null while they have not been loaded yet. */
  threads: CommentThread[] | null;
  error: string | null;
  loading: boolean;
  /** Loads the threads again (after a change). No-op when the page provided them. */
  reload: () => void;
  /** Forgets loaded threads (e.g. when a popover closes, so its badge falls back to the page's counts). */
  reset: () => void;
};

/**
 * The comment threads of a submission for a comment component. When the page passed them in (`provided`,
 * server-rendered), those are used as they are: after a change the server action re-renders the page with
 * fresh props. Otherwise they are loaded with the listComments server action while `enabled` is true (on
 * mount for the panel, when opened for a field's popover) and again on `reload()`.
 */
export function useCommentThreads(
  submissionId: string,
  { provided, enabled }: { provided?: CommentThread[]; enabled: boolean },
): CommentThreadsState {
  const controlled = provided !== undefined;
  const [state, setState] = useState<FetchState>(EMPTY);
  const [loading, startTransition] = useTransition();

  const reload = useCallback(() => {
    if (controlled) return;
    startTransition(async () => {
      const result = await listComments(submissionId);
      setState(result.ok ? { threads: result.data, error: null } : { threads: null, error: result.error });
    });
  }, [controlled, submissionId]);

  const reset = useCallback(() => setState(EMPTY), []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  if (controlled) return { threads: provided, error: null, loading: false, reload, reset };
  return { threads: state.threads, error: state.error, loading, reload, reset };
}
