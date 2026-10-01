// "Review and submit" when a request gets no answer (offline, the server unavailable, a new release while
// the page is open): the check ends in "check-failed" (the dialog shows Try again) and a failed submit comes
// back as a message, so the dialog never stays locked on its spinner.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/submission", () => ({
  getSubmissionValidationAction: vi.fn(),
  submitSubmission: vi.fn(),
  saveSubmissionValues: vi.fn(),
  requestAmendment: vi.fn(),
}));

import { emptyDraft, numberDraft, withFieldValue, type DraftValues } from "@/components/submission-form/draft";
import { DraftStore, type SaveFunction } from "@/components/submission-form/draft-store";
import {
  CHECK_UNREACHABLE,
  SUBMIT_UNREACHABLE,
  runReviewCheck,
  submitMonth,
  type ReviewStep,
} from "@/components/submission-form/review-dialog";
import { getSubmissionValidationAction, submitSubmission } from "@/lib/actions/submission";

const SUB = "90000000-0000-4000-8000-000000000009";

function store(options: { unsaved?: boolean; save?: SaveFunction } = {}): DraftStore {
  const saved = emptyDraft();
  const initial: DraftValues = options.unsaved ? withFieldValue(saved, "gross_profit", numberDraft(-150)) : saved;
  return new DraftStore({
    initial,
    saved,
    lastSavedAt: "2026-09-30T06:05:00+00:00",
    types: { fieldTypes: { gross_profit: "currency" }, kpiTypes: {} },
    enabled: true,
    save: options.save ?? (async () => ({ ok: true, savedAt: "2026-09-30T06:06:00+00:00" })),
  });
}

async function steps(draftStore: DraftStore): Promise<ReviewStep[]> {
  const reported: ReviewStep[] = [];
  await runReviewCheck(draftStore, SUB, (step) => reported.push(step));
  return reported;
}

const CHECK = {
  ok: true,
  errors: [],
  priorMonths: [],
  values: emptyDraft(),
  lastSavedAt: "2026-09-30T06:05:00+00:00",
  status: "draft" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReviewCheck", () => {
  it("saves, checks and moves on to the declaration", async () => {
    vi.mocked(getSubmissionValidationAction).mockResolvedValue({ ok: true, data: CHECK });
    expect(await steps(store())).toEqual([{ kind: "checking" }, { kind: "declare", check: CHECK }]);
    expect(getSubmissionValidationAction).toHaveBeenCalledWith(SUB);
  });

  it("offers Try again when the check gets no answer", async () => {
    vi.mocked(getSubmissionValidationAction).mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await steps(store())).toEqual([{ kind: "checking" }, { kind: "check-failed", message: CHECK_UNREACHABLE }]);
  });

  it("passes on the server's refusal", async () => {
    vi.mocked(getSubmissionValidationAction).mockResolvedValue({ ok: false, error: "Your session has expired." });
    expect(await steps(store())).toEqual([
      { kind: "checking" },
      { kind: "check-failed", message: "Your session has expired." },
    ]);
  });

  it("stops when the latest changes cannot be saved", async () => {
    const failing = store({ unsaved: true, save: async () => ({ ok: false, error: "Sep 2026 is locked." }) });
    expect(await steps(failing)).toEqual([{ kind: "save-failed", message: "Sep 2026 is locked." }]);
    expect(getSubmissionValidationAction).not.toHaveBeenCalled();
  });

  it("reports a save that gets no answer as a failed save, never a spinner", async () => {
    const offline = store({
      unsaved: true,
      save: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const reported = await steps(offline);
    expect(reported).toHaveLength(1);
    expect(reported[0].kind).toBe("save-failed");
  });
});

describe("submitMonth", () => {
  it("submits with the declaration", async () => {
    vi.mocked(submitSubmission).mockResolvedValue({ ok: true, data: { month: "2026-09" } });
    expect(await submitMonth(SUB)).toEqual({ ok: true, data: { month: "2026-09" } });
    expect(submitSubmission).toHaveBeenCalledWith(SUB, true);
  });

  it("passes on the server's refusal", async () => {
    vi.mocked(submitSubmission).mockResolvedValue({ ok: false, error: "Submit earlier months first: Aug 2026." });
    expect(await submitMonth(SUB)).toEqual({ ok: false, error: "Submit earlier months first: Aug 2026." });
  });

  it("turns a request that gets no answer into a message, so the dialog unlocks", async () => {
    vi.mocked(submitSubmission).mockRejectedValue(new Error("Failed to find Server Action"));
    expect(await submitMonth(SUB)).toEqual({ ok: false, error: SUBMIT_UNREACHABLE });
  });
});
