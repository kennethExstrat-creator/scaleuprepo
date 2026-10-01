/**
 * Conformance review (F-DB): type-level probes of src/lib/supabase/database.types.ts against the
 * @supabase/postgrest-js type machinery (checked by `npx tsc --noEmit`, never executed).
 *
 * Each block exercises a query shape the feature modules will use. Lines marked @ts-expect-error
 * document a deliberate type error (so tsc fails if the generated types ever stop rejecting them).
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type ReviewAssertions = [
  // Every contract table and both views are present.
  Expect<
    Equal<
      keyof Database["public"]["Tables"],
      | "access_links"
      | "platform_settings"
      | "profiles"
      | "funds"
      | "companies"
      | "fund_investments"
      | "company_members"
      | "company_internal"
      | "revenue_segments"
      | "kpi_dimensions"
      | "kpi_dimension_members"
      | "company_kpis"
      | "templates"
      | "template_versions"
      | "template_sections"
      | "template_fields"
      | "reporting_periods"
      | "submissions"
      | "submission_values"
      | "submission_segment_values"
      | "submission_kpi_values"
      | "submission_events"
      | "comments"
      | "period_closes"
      | "documents"
      | "fx_rates"
      | "audit_log"
    >
  >,
  Expect<Equal<keyof Database["public"]["Views"], "v_submission_financials" | "v_submission_overview">>,
  // Every contract RPC is present (and nothing from the private schema leaks into the API types).
  Expect<
    Equal<
      keyof Database["public"]["Functions"],
      | "open_due_periods"
      | "open_period"
      | "save_submission_values"
      | "get_submission_validation"
      | "submit_submission"
      | "request_changes"
      | "approve_submission"
      | "reopen_submission"
      | "request_amendment"
      | "extend_due_date"
      | "resolve_comment"
      | "confirm_period_close"
      | "reopen_period_close"
      | "get_client_settings"
      // BRD B28 (decisions 2026-10-01): ScaleUp staff display names for the company side.
      | "staff_display_names"
      | "accept_terms"
      | "update_my_profile"
      | "admin_update_profile"
      | "create_template_draft"
      | "publish_template_version"
      | "set_company_status"
      | "delete_company"
      | "log_audit_event"
      // BRD B30: the company's own revenue segments (owner, or ScaleUp on behalf).
      | "set_company_revenue_segments"
      // Service role only (the /access accept action, BRD B14); not executable by authenticated.
      | "claim_access_link"
    >
  >,
  // Column types of note.
  Expect<Equal<Tables<"companies">["reporting_currency"], string>>, // char(3) → bpchar → string
  Expect<Equal<Tables<"platform_settings">["due_day"], number>>, // smallint
  Expect<Equal<Tables<"submission_kpi_values">["dimension_member_id"], string | null>>,
  Expect<Equal<Tables<"submission_events">["id"], number>>, // bigint identity
  Expect<Equal<TablesInsert<"submission_events">["id"], undefined>>, // generated always → never
  Expect<Equal<Tables<"period_closes">["computed_totals"], Database["public"]["Tables"]["period_closes"]["Row"]["restated_totals"]>>,
  Expect<Equal<Tables<"v_submission_financials">["fx_rate_to_myr"], number | null>>,
  Expect<Equal<Tables<"v_submission_overview">["days_overdue"], number | null>>,
  // Defaults make these optional on insert (the DB fills them in).
  Expect<Equal<undefined extends TablesInsert<"comments">["author_id"] ? true : false, true>>,
  Expect<Equal<undefined extends TablesInsert<"documents">["uploaded_by"] ? true : false, true>>,
  Expect<Equal<undefined extends TablesInsert<"documents">["version"] ? true : false, true>>,
  Expect<Equal<Enums<"submission_status">, "draft" | "submitted" | "changes_requested" | "approved">>,
];

export async function reviewTypedQueries(): Promise<void> {
  const sb = createClient<Database>("https://example.supabase.co", "public-anon-key");

  // 1. Embedding a table from a view through the underlying foreign key (view relationships).
  const overview = await sb.from("v_submission_overview").select("id, month, company:companies(name, status)");
  const companyName: string | undefined = overview.data?.[0]?.company?.name;

  // 2. Two foreign keys from company_members to profiles: a hint is required and works.
  const members = await sb
    .from("company_members")
    .select("role, is_active, user:profiles!company_members_user_id_fkey(full_name, email)")
    .eq("company_id", "c");
  const memberEmail: string | undefined = members.data?.[0]?.user.email;

  // 3. Self-reference (comment replies) and author embed.
  const threads = await sb
    .from("comments")
    .select("id, body, parent_id, replies:comments!comments_parent_id_fkey(id, body), author:profiles!comments_author_id_fkey(full_name)")
    .is("parent_id", null);
  const replyBodies: string[] | undefined = threads.data?.[0]?.replies.map((r) => r.body);

  // 4. KPI cells with their KPI and member.
  const cells = await sb
    .from("submission_kpi_values")
    .select("value_number, value_text, value_bool, company_kpis(name, value_type), kpi_dimension_members(name)")
    .eq("submission_id", "s");
  const kpiType: Enums<"kpi_value_type"> | undefined = cells.data?.[0]?.company_kpis.value_type;
  const memberName: string | null | undefined = cells.data?.[0]?.kpi_dimension_members?.name;

  // 5. Company with its ScaleUp-internal record and partner-in-charge (company_internal →
  //    profiles via company_internal_partner_in_charge_id_fkey; ScaleUp-only through RLS).
  const company = await sb
    .from("companies")
    .select(
      "id, name, company_internal(internal_rating, partner:profiles!company_internal_partner_in_charge_id_fkey(full_name))",
    )
    .single();
  const partnerName: string | null | undefined = company.data?.company_internal?.partner?.full_name;

  // 6. Writes with the generated Insert / Update shapes.
  const comment: TablesInsert<"comments"> = { submission_id: "s", body: "Please check GP", visibility: "internal", target: "field:gross_profit" };
  await sb.from("comments").insert(comment);
  const doc = await sb
    .from("documents")
    .insert({ company_id: "c", period_close_id: null, file_name: "a.pdf", storage_path: "c/general/x-a.pdf", mime_type: "application/pdf", size_bytes: 10 })
    .select("id, version")
    .single();
  const docVersion: number | undefined = doc.data?.version;
  const internal: TablesUpdate<"company_internal"> = { internal_rating: "watch", notes: null };
  await sb.from("company_internal").update(internal).eq("company_id", "c");

  // 7. RPCs with optional arguments: omitted (fine) …
  await sb.rpc("approve_submission", { p_submission_id: "s" });
  await sb.rpc("extend_due_date", { p_submission_id: "s", p_new_due_date: "2026-11-30" });
  await sb.rpc("confirm_period_close", { p_close_id: "c", p_restated_totals: null });
  await sb.rpc("log_audit_event", { p_action: "export", p_entity: "c4_workbook", p_company_id: "c" });
  await sb.rpc("admin_update_profile", { p_user_id: "u", p_full_name: "N", p_job_title: "" });
  // … but an explicit null for a nullable SQL argument is a type error (the official generator
  // types arguments without `| null`), so feature code must pass undefined instead of null.
  // @ts-expect-error — p_message is `string | undefined`, not null
  await sb.rpc("approve_submission", { p_submission_id: "s", p_message: null });
  // @ts-expect-error — p_scaleup_role null (= company user) cannot be expressed; omit it instead
  await sb.rpc("admin_update_profile", { p_user_id: "u", p_full_name: "N", p_job_title: "", p_scaleup_role: null, p_is_active: true });

  // 8. Return types.
  const opened = await sb.rpc("open_period", { p_month: "2026-10-01" });
  const periodId: string | null = opened.data;
  const saved = await sb.rpc("save_submission_values", { p_submission_id: "s" });
  const savedAt: string | null = saved.data;

  // 9. Enum-typed filters reject unknown values.
  // @ts-expect-error — not a submission_status
  await sb.from("submissions").select("id").eq("status", "late");

  void [companyName, memberEmail, replyBodies, kpiType, memberName, partnerName, docVersion, periodId, savedAt];
}
