import { HistoryIcon, SettingsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { canViewAudit } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { getPlatformSettings, isNotFoundError } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { currentMonthMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { PlatformSettingsRow } from "@/lib/types/domain";

import { SettingsForm } from "./_components/settings-form";
import { settingsFromRow } from "./_lib/settings-model";

export const metadata: Metadata = { title: "Settings" };

type Client = Awaited<ReturnType<typeof createClient>>;
type ProfileName = { full_name: string | null; email: string };

/** Who last saved the settings (ScaleUp pages show plain names), or null. */
async function nameOf(sb: Client, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await sb.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  if (error) {
    console.error("[settings] could not load who last changed the settings", error.code, error.message);
    return null;
  }
  const profile: ProfileName | null = data;
  return profile ? profile.full_name?.trim() || profile.email : "A former user";
}

function lastChangedText(row: PlatformSettingsRow, by: string | null): string {
  if (row.updated_by === null && row.updated_at === row.created_at) {
    return `Not changed since the platform was set up (${formatDateTime(row.created_at)}).`;
  }
  return `Last changed ${formatDateTime(row.updated_at)}${by ? ` by ${by}` : ""}.`;
}

/**
 * Platform settings (module M4, BRD A5, B4, B11, B12, B19, B25, B27, B29): Super Admins only. Reporting
 * cycle rules, review-flag thresholds, the owners' contributor limit, the submission declaration, two-factor
 * authentication and the terms of use version — saved together after a review of what each change does.
 */
export default async function SettingsPage() {
  const ctx = await requireScaleUp(["super_admin"]);
  const sb = await createClient();

  let row: PlatformSettingsRow;
  try {
    row = await getPlatformSettings(sb);
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
    return (
      <>
        <PageHeader title="Settings" />
        <EmptyState
          icon={SettingsIcon}
          title="The platform settings are missing"
          description="The settings row is created when the database is set up. Ask the developers to run the database seed again."
        />
      </>
    );
  }
  const by = await nameOf(sb, row.updated_by);

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          <>
            Rules that apply across the platform. Only Super Admins can change them; every change is recorded in the
            audit log. <span className="text-foreground/80">{lastChangedText(row, by)}</span>
          </>
        }
        actions={
          canViewAudit(ctx) ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/audit?entity=platform_settings">
                <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                Change history
              </Link>
            </Button>
          ) : undefined
        }
      />
      <SettingsForm
        key={row.updated_at}
        initial={settingsFromRow(row)}
        updatedAt={row.updated_at}
        currentMonth={currentMonthMYT()}
      />
    </>
  );
}
