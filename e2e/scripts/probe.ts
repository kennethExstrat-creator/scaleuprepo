/** Read-only probe of the live database state relevant to the E2E suite (prints no secrets). */
import { adminClient } from "../helpers/supabase";
import { totp } from "../helpers/totp";

// RFC 6238 vectors (SHA-1): secret "12345678901234567890"
const s = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
console.log("totp vectors", totp(s, 59_000) === "287082", totp(s, 1111111109_000) === "081804", totp(s, 1234567890_000) === "005924");

const sb = adminClient();
const settings = await sb.from("platform_settings").select("require_mfa, terms_version, due_day, backfill_grace_days, owner_contributor_limit, default_reporting_start").maybeSingle();
console.log("settings", settings.data, settings.error?.message);
const kind = await sb.from("revenue_segments").select("id, kind").limit(1);
console.log("B30 kind column:", kind.error ? `MISSING (${kind.error.message})` : "present");
const companies = await sb.from("companies").select("id, name, status, reporting_start_month").order("name");
console.log("companies", companies.data?.length, companies.data?.map((c) => `${c.name} [${c.status}${c.reporting_start_month ? " " + c.reporting_start_month : ""}]`).join("; "));
const profiles = await sb.from("profiles").select("id, email, scaleup_role, is_active, terms_version").ilike("email", "e2e.%");
console.log("e2e profiles", profiles.data);
const tmpl = await sb.from("templates").select("id, name, is_default");
console.log("templates", tmpl.data);
const periods = await sb.from("reporting_periods").select("month, due_date").order("month");
console.log("periods", periods.data);
const fns = await sb.rpc("get_client_settings").maybeSingle();
console.log("get_client_settings", fns.data, fns.error?.message);
