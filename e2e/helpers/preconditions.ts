/**
 * Preconditions of the flows, established through the API as the real E2E users (their RLS and RPC
 * checks apply) only when an earlier flow did not leave the expected state — so one failure does not
 * hide the results of the flows after it. Every repair is reported as a note on the flow.
 */
import { COMPANY_SEGMENTS } from "./accounts";
import { withApiUser } from "./api-user";
import type { Flow } from "./browser";
import { adminClient, must, type AnyClient } from "./supabase";
import { loadState } from "./state";

export const JULY = "2026-07";
export const CHANGE_REQUEST_MESSAGE =
  "E2E check: please confirm the cash in bank figure against the July bank statement and resubmit.";
export const AUGUST = "2026-08";

/** The figures flow 2 enters (and the API repair uses). */
export const JULY_FIGURES = {
  segments: { "E2E Online": 60000, "E2E Retail": 40000 } as Record<string, number>,
  revenueTotal: 100000,
  scaleupLine: 25000,
  gross_profit: 40000,
  net_profit: -5000,
  cash_in_bank: 500000,
  burn_rate: 20000,
  headcount_ft: 10,
  headcount_pt: 2,
  customers: 120,
};

export type SubmissionStatus = "draft" | "submitted" | "changes_requested" | "approved";

export async function submissionStatus(month: string): Promise<SubmissionStatus> {
  const state = loadState();
  const id = state.company.submissions[month];
  const row = must(await adminClient().from("submissions").select("status").eq("id", id).single(), "read status") as {
    status: SubmissionStatus;
  };
  return row.status;
}

export async function activeCompanySegments(): Promise<{ id: string; name: string }[]> {
  const state = loadState();
  return must(
    await adminClient()
      .from("revenue_segments")
      .select("id, name, sort_order")
      .eq("company_id", state.company.id)
      .eq("kind", "company")
      .eq("is_active", true)
      .order("sort_order"),
    "read company segments",
  ) as { id: string; name: string }[];
}

async function fillJulyAsOwner(sb: AnyClient) {
  const state = loadState();
  let segments = await activeCompanySegments();
  if (segments.length === 0) {
    must(
      await sb.rpc("set_company_revenue_segments", {
        p_company_id: state.company.id,
        p_segments: COMPANY_SEGMENTS.map((name) => ({ name })),
      }),
      "set_company_revenue_segments",
    );
    segments = await activeCompanySegments();
  }
  const amounts = segments.map((s) => ({ segment_id: s.id, amount: JULY_FIGURES.segments[s.name] ?? 0 }));
  const total = amounts.reduce((sum, a) => sum + a.amount, 0);
  must(
    await sb.rpc("save_submission_values", {
      p_submission_id: state.company.submissions[JULY],
      p_values: [
        { key: "revenue_total", value_number: total },
        { key: "gross_profit", value_number: JULY_FIGURES.gross_profit },
        { key: "net_profit", value_number: JULY_FIGURES.net_profit },
        { key: "cash_in_bank", value_number: JULY_FIGURES.cash_in_bank },
        { key: "burn_rate", value_number: JULY_FIGURES.burn_rate },
        { key: "headcount_ft", value_number: JULY_FIGURES.headcount_ft },
        { key: "headcount_pt", value_number: JULY_FIGURES.headcount_pt },
      ],
      p_segments: [...amounts, { segment_id: state.company.scaleupLineId, amount: JULY_FIGURES.scaleupLine }],
      p_kpis: [{ kpi_id: state.company.kpiId, dimension_member_id: null, value_number: JULY_FIGURES.customers }],
    }),
    "save_submission_values",
  );
}

async function submitJulyAsOwner(sb: AnyClient) {
  const state = loadState();
  must(
    await sb.rpc("submit_submission", { p_submission_id: state.company.submissions[JULY], p_declaration_accepted: true }),
    "submit_submission",
  );
}

/** July 2026 is `submitted` (waiting for review). */
export async function ensureJulySubmitted(flow: Flow) {
  const status = await submissionStatus(JULY);
  if (status === "submitted") return;
  const state = loadState();
  if (status === "draft" || status === "changes_requested") {
    flow.note(`precondition repaired via API: July 2026 was "${status}", submitted as the owner`);
    await withApiUser(state.users.owner, async (sb) => {
      await fillJulyAsOwner(sb);
      await submitJulyAsOwner(sb);
    });
    return;
  }
  throw new Error(`July 2026 is "${status}"; this flow needs it submitted (no API repair for that state).`);
}

/** July 2026 is `changes_requested`, with a message from the admin. */
export async function ensureJulyChangesRequested(flow: Flow, message: string) {
  let status = await submissionStatus(JULY);
  if (status === "changes_requested") return;
  const state = loadState();
  if (status === "draft") {
    await ensureJulySubmitted(flow);
    status = await submissionStatus(JULY);
  }
  if (status === "submitted") {
    flow.note('precondition repaired via API: July 2026 sent back for changes as the admin');
    await withApiUser(state.users.admin, async (sb) => {
      must(
        await sb.rpc("request_changes", { p_submission_id: state.company.submissions[JULY], p_message: message }),
        "request_changes",
      );
    });
    return;
  }
  throw new Error(`July 2026 is "${status}"; this flow needs it sent back for changes.`);
}
