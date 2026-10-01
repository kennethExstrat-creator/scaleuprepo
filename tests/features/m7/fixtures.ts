// Shared fixtures for the M7 tests: a small portfolio on 30 Sep 2026 (the latest open month is
// August 2026), seed-like ids and names.
import {
  DEFAULT_TRACKER_FILTERS,
  type TrackerCompany,
  type TrackerData,
  type TrackerFilters,
  type TrackerSubmission,
} from "@/app/admin/tracker/_lib/tracker-model";

export const P1 = "a1000000-0000-4000-8000-000000000001"; // Renuka Sena
export const P2 = "a1000000-0000-4000-8000-000000000002"; // Aaron Sarma (the signed-in user)

export const SV1 = { id: "f1", code: "SV1", name: "ScaleUp Ventures 1 Sdn Bhd" };
export const SFF = { id: "f2", code: "SFF", name: "ScaleUp Founders Fund LP" };

export const IDS = {
  batik: "c0000000-0000-4000-8000-000000000001",
  recqa: "c0000000-0000-4000-8000-000000000002",
  kiddocare: "c0000000-0000-4000-8000-000000000003",
  huddle: "c0000000-0000-4000-8000-000000000011",
  stayhere: "c0000000-0000-4000-8000-000000000013",
  oldco: "c0000000-0000-4000-8000-000000000099",
  future: "c0000000-0000-4000-8000-000000000098",
};

export function company(overrides: Partial<TrackerCompany> & Pick<TrackerCompany, "id" | "name">): TrackerCompany {
  return { status: "active", startMonth: "2026-07", funds: [SV1], partner: null, ...overrides };
}

export const COMPANIES: TrackerCompany[] = [
  company({ id: IDS.recqa, name: "RECQA" }),
  company({ id: IDS.kiddocare, name: "Kiddocare", funds: [SFF], partner: { id: P2, name: "Aaron Sarma" } }),
  company({ id: IDS.batik, name: "Batik Boutique", partner: { id: P1, name: "Renuka Sena" } }),
  company({ id: IDS.huddle, name: "Huddle", startMonth: null, funds: [SFF], partner: { id: P1, name: "Renuka Sena" } }),
  company({ id: IDS.stayhere, name: "StayHere", startMonth: null, status: "written_off", funds: [SFF] }),
  company({ id: IDS.oldco, name: "OldCo", startMonth: "2025-10", status: "exited" }),
];

let seq = 0;
export function submission(
  companyId: string,
  month: string,
  overrides: Partial<TrackerSubmission> = {},
): TrackerSubmission {
  seq += 1;
  const [year, mm] = month.split("-").map(Number);
  const next = mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, "0")}`;
  return {
    id: `50000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    companyId,
    month,
    status: "draft",
    dueDate: `${next}-15`,
    originalDueDate: null,
    submittedAt: null,
    approvedAt: null,
    revision: 0,
    isOverdue: false,
    daysOverdue: 0,
    hasNarrative: false,
    openThreads: 0,
    ...overrides,
  };
}

export const MONTHS = [
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
].map((month) => {
  const [year, mm] = month.split("-").map(Number);
  const next = mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, "0")}`;
  return { month, dueDate: `${next}-15` };
});

export const SUBMISSIONS: TrackerSubmission[] = [
  submission(IDS.batik, "2026-07", {
    status: "approved",
    submittedAt: "2026-08-10T02:00:00Z",
    approvedAt: "2026-08-15T03:00:00Z",
    revision: 1,
    hasNarrative: true,
  }),
  submission(IDS.batik, "2026-08", { status: "submitted", submittedAt: "2026-09-12T02:00:00Z", revision: 2, openThreads: 2 }),
  submission(IDS.recqa, "2026-07", {
    status: "changes_requested",
    submittedAt: "2026-08-14T02:00:00Z",
    revision: 1,
    dueDate: "2026-09-27",
    originalDueDate: "2026-08-15",
    isOverdue: true,
    daysOverdue: 3,
  }),
  submission(IDS.recqa, "2026-08", { isOverdue: true, daysOverdue: 15 }),
  submission(IDS.kiddocare, "2026-07", {
    status: "approved",
    submittedAt: "2026-08-20T02:00:00Z",
    approvedAt: "2026-09-10T02:00:00Z",
    revision: 1,
  }),
  submission(IDS.kiddocare, "2026-08", {
    status: "approved",
    submittedAt: "2026-09-05T02:00:00Z",
    approvedAt: "2026-09-18T02:00:00Z",
    revision: 1,
    hasNarrative: true,
    openThreads: 1,
  }),
  submission(IDS.oldco, "2025-10", { status: "approved", approvedAt: "2025-11-20T02:00:00Z", revision: 1 }),
  submission(IDS.oldco, "2025-11", { status: "draft" }),
  // A month that is not in the window is ignored.
  submission(IDS.batik, "2025-01", { status: "approved" }),
];

export function data(overrides: Partial<TrackerData> = {}): TrackerData {
  return {
    months: [...MONTHS].reverse(),
    companies: COMPANIES,
    submissions: SUBMISSIONS,
    funds: [SV1, SFF],
    escalationDays: 14,
    today: "2026-09-30",
    currentUserId: P2,
    ...overrides,
  };
}

export function filters(overrides: Partial<TrackerFilters> = {}): TrackerFilters {
  return { ...DEFAULT_TRACKER_FILTERS, ...overrides };
}

