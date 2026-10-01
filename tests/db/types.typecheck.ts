/**
 * Type-level smoke test for src/lib/supabase/database.types.ts (checked by `npx tsc --noEmit`,
 * never executed): the generated Database type drives supabase-js inference for selects,
 * embedded foreign-key selects, views and RPCs.
 */
import { createClient } from "@supabase/supabase-js";
import {
  Constants,
  type Database,
  type Enums,
  type Json,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from "@/lib/supabase/database.types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type TypeAssertions = [
  Expect<Equal<Tables<"submissions">["status"], "draft" | "submitted" | "changes_requested" | "approved">>,
  Expect<Equal<Tables<"submissions">["approved_at"], string | null>>,
  Expect<Equal<Tables<"submission_values">["value_number"], number | null>>,
  Expect<Equal<Tables<"audit_log">["id"], number>>,
  Expect<Equal<Tables<"profiles">["scaleup_role"], Enums<"scaleup_role"> | null>>,
  Expect<Equal<Tables<"v_submission_overview">["is_overdue"], boolean | null>>,
  Expect<Equal<TablesInsert<"audit_log">["id"], undefined>>, // identity: never insertable
  Expect<Equal<Database["public"]["Functions"]["open_due_periods"]["Returns"], number>>,
  Expect<Equal<Database["public"]["Functions"]["submit_submission"]["Returns"], undefined>>,
  Expect<Equal<Enums<"company_role">, "owner" | "contributor">>,
  // Not yet reporting = null (BRD B16); the partner-in-charge is ScaleUp-internal (company_internal).
  Expect<Equal<Tables<"companies">["reporting_start_month"], string | null>>,
  Expect<Equal<"partner_in_charge_id" extends keyof Tables<"companies"> ? true : false, false>>,
  Expect<Equal<Tables<"company_internal">["partner_in_charge_id"], string | null>>,
  Expect<
    Equal<
      Database["public"]["Functions"]["get_client_settings"]["Returns"],
      {
        require_mfa: boolean;
        terms_version: string;
        declaration_text: string;
        due_day: number;
        owner_contributor_limit: number;
      }[]
    >
  >,
  // BRD B29 (decisions 2026-10-01): the owners' contributor limit, a Super Admin setting.
  Expect<Equal<Tables<"platform_settings">["owner_contributor_limit"], number>>,
  Expect<Equal<undefined extends TablesInsert<"platform_settings">["owner_contributor_limit"] ? true : false, true>>,
  // BRD B28: ScaleUp staff display names for the company side (no email, no role).
  Expect<
    Equal<
      Database["public"]["Functions"]["staff_display_names"],
      { Args: { p_ids: string[] }; Returns: { id: string; display_name: string }[] }
    >
  >,
  // BRD B30: two revenue breakdowns (kind 'company' | 'scaleup', a checked text column) and retired segments.
  Expect<Equal<Tables<"revenue_segments">["kind"], string>>,
  Expect<Equal<Tables<"revenue_segments">["retired_at"], string | null>>,
  Expect<Equal<undefined extends TablesInsert<"revenue_segments">["kind"] ? true : false, true>>,
  // (20261001000300: the optional p_expected_ids — the ids the list is based on, checked under the lock.)
  Expect<
    Equal<
      Database["public"]["Functions"]["set_company_revenue_segments"],
      {
        Args: { p_company_id: string; p_expected_ids?: string[]; p_segments: Json };
        Returns: Tables<"revenue_segments">[];
      }
    >
  >,
  // BRD A5, B10 (20261001000500): Super Admins and Fund Admins set the reporting-cycle settings.
  Expect<
    Equal<
      Database["public"]["Functions"]["set_cycle_settings"],
      {
        Args: { p_backfill_grace_days: number; p_due_day: number; p_escalation_days: number; p_expected_updated_at?: string };
        Returns: string;
      }
    >
  >,
  Expect<Equal<Tables<"access_links">["purpose"], string>>,
  // The accept action claims a link with the service-role client: one row, or none when not valid.
  Expect<
    Equal<
      Database["public"]["Functions"]["claim_access_link"],
      { Args: { p_token_hash: string }; Returns: { user_id: string; purpose: string; email: string }[] }
    >
  >,
  // The hosted project runs PostgREST 14 (postgrest-js treats 13 and 14 alike).
  Expect<Equal<Database["__InternalSupabase"]["PostgrestVersion"], "14">>,
];

export async function typedClientSmokeTest(): Promise<void> {
  const sb = createClient<Database>("https://example.supabase.co", "public-anon-key");

  // Plain select with ordering: columns and nullability are inferred.
  const companies = await sb.from("companies").select("id, name, status, reporting_start_month").order("name");
  const companyRows:
    | {
        id: string;
        name: string;
        status: Enums<"company_status">;
        reporting_start_month: string | null;
      }[]
    | null = companies.data;
  // @ts-expect-error — the partner-in-charge is not a companies column any more (company_internal)
  await sb.from("companies").select("partner_in_charge_id").single().then((r) => r.data?.partner_in_charge_id);

  // The ScaleUp-internal record with the partner-in-charge's profile (single FK to profiles).
  const internal = await sb
    .from("company_internal")
    .select("company_id, internal_rating, partner:profiles(full_name, email)")
    .eq("company_id", "c")
    .maybeSingle();
  const partnerEmail: string | undefined = internal.data?.partner?.email;

  // Client settings (set-returning RPC → one row with maybeSingle()).
  const clientSettings = await sb.rpc("get_client_settings").maybeSingle();
  const declaration: string | undefined = clientSettings.data?.declaration_text;
  const contributorLimit: number | undefined = clientSettings.data?.owner_contributor_limit;

  // ScaleUp staff display names (set-returning RPC → rows).
  const staffNames = await sb.rpc("staff_display_names", { p_ids: ["u1", "u2"] });
  const firstStaffName: string | undefined = staffNames.data?.[0]?.display_name;
  // @ts-expect-error — the RPC returns no email
  void staffNames.data?.[0]?.email;

  // Access links (service-role client in the accept action): null data = the link is not valid.
  const claimed = await sb.rpc("claim_access_link", { p_token_hash: "0".repeat(64) }).maybeSingle();
  const claimedEmail: string | undefined = claimed.data?.email;

  // Embedded many-to-one select (FK submissions.company_id → companies.id) is an object.
  const submissions = await sb
    .from("submissions")
    .select("id, month, status, company:companies(id, name, reporting_currency)")
    .eq("company_id", "c0000000-0000-4000-8000-000000000001");
  const firstCompanyName: string | undefined = submissions.data?.[0]?.company.name;

  // Embedded one-to-many select is an array.
  const withComments = await sb.from("submissions").select("id, comments(id, body, visibility, parent_id)").single();
  const bodies: string[] | undefined = withComments.data?.comments.map((c) => c.body);
  const visibility: Enums<"comment_visibility"> | undefined = withComments.data?.comments[0]?.visibility;

  // Two FKs to profiles: disambiguated by constraint name.
  const authors = await sb.from("comments").select("id, author:profiles!comments_author_id_fkey(full_name, email)");
  const authorName: string | null | undefined = authors.data?.[0]?.author.full_name;

  // Nested embeds through the template tables.
  const template = await sb
    .from("template_versions")
    .select("id, version_no, template_sections(key, title, kind, template_fields(key, label, field_type, is_required))")
    .eq("status", "published")
    .maybeSingle();
  const fieldTypes: Enums<"field_type">[] | undefined = template.data?.template_sections.flatMap((s) =>
    s.template_fields.map((f) => f.field_type),
  );

  // Views (security_invoker) are typed too.
  const overview = await sb.from("v_submission_overview").select("id, month, is_overdue, days_overdue, open_threads");
  const overdue: boolean | null | undefined = overview.data?.[0]?.is_overdue;
  const financials = await sb.from("v_submission_financials").select("submission_id, revenue_total, fx_rate_to_myr");
  const revenue: number | null | undefined = financials.data?.[0]?.revenue_total;

  // Inserts and updates use the Insert / Update shapes (the start month is optional: not yet reporting).
  const newCompany: TablesInsert<"companies"> = { name: "Newco" };
  await sb.from("companies").insert(newCompany);
  const rename: TablesUpdate<"companies"> = { name: "Newco Sports", reporting_start_month: null };
  await sb.from("companies").update(rename).eq("id", "x");
  const assignPartner: TablesUpdate<"company_internal"> = { partner_in_charge_id: "p" };
  await sb.from("company_internal").update(assignPartner).eq("company_id", "x");

  // RPCs: arguments and return types.
  const saved = await sb.rpc("save_submission_values", {
    p_submission_id: "x",
    p_values: [{ key: "revenue_total", value_number: 1000 }],
    p_segments: [],
    p_kpis: [{ kpi_id: "k", dimension_member_id: null, value_bool: true }],
  });
  const lastSavedAt: string | null = saved.data;
  // The company's own revenue segments (set-returning RPC → the active company segments, typed rows).
  const companySegments = await sb.rpc("set_company_revenue_segments", {
    p_company_id: "c",
    p_segments: [{ id: "s", name: "Online" }, { name: "Retail" }],
  });
  const firstSegmentKind: string | undefined = companySegments.data?.[0]?.kind;
  const firstRetiredAt: string | null | undefined = companySegments.data?.[0]?.retired_at;
  const opened = await sb.rpc("open_due_periods");
  const created: number | null = opened.data;
  const validation = await sb.rpc("get_submission_validation", { p_submission_id: "x" });
  const result: Json | null = validation.data;
  const draft = await sb.rpc("create_template_draft", { p_template_id: "t" });
  const draftId: string | null = draft.data;
  await sb.rpc("submit_submission", { p_submission_id: "x", p_declaration_accepted: true });
  await sb.rpc("admin_update_profile", {
    p_user_id: "u",
    p_full_name: "Name",
    p_job_title: "",
    p_scaleup_role: "partner",
    p_is_active: true,
  });

  // @ts-expect-error — unknown RPC
  await sb.rpc("not_a_function");
  // @ts-expect-error — required argument missing
  await sb.rpc("submit_submission", { p_submission_id: "x" });
  // @ts-expect-error — wrong enum value
  await sb.rpc("set_company_status", { p_company_id: "c", p_status: "sold" });
  // @ts-expect-error — the generated Insert type needs the required columns (a company needs a name)
  const badInsert: TablesInsert<"companies"> = { reporting_start_month: "2026-07-01" };

  const roles: readonly Enums<"scaleup_role">[] = Constants.public.Enums.scaleup_role;

  void [companyRows, partnerEmail, declaration, contributorLimit, firstStaffName, claimedEmail, firstCompanyName, bodies, visibility, authorName, fieldTypes, overdue, revenue, lastSavedAt, firstSegmentKind, firstRetiredAt, created, result, draftId, badInsert, roles];
}
