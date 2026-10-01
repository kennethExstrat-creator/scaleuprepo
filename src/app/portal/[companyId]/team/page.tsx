import type { SupabaseClient } from "@supabase/supabase-js";
import { InfoIcon, LockIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";

import { ContributorAllowanceNote } from "./_components/contributor-allowance-note";
import { InviteContributorButton } from "./_components/invite-contributor-dialog";
import { buildTeam, contributorAllowance, idsToName, type TeamMemberInput } from "./_components/team-model";
import { TeamTable } from "./_components/team-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { listPendingAccessLinks, type PendingAccessLink } from "@/lib/auth-admin";
import { canManageCompanyTeam, membershipFor } from "@/lib/auth/permissions";
import { requireCompanyAccess } from "@/lib/auth/session";
import { COMPANY_STATUS_LABELS, SCALEUP_LABEL } from "@/lib/constants";
import { getClientSettings, getStaffDisplayNames } from "@/lib/data";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team" };

type Sb = SupabaseClient<Database>;

/** The owners' contributor-places note; the disabled "Invite contributor" button points to it. */
const ALLOWANCE_NOTE_ID = "team-contributor-places";

/**
 * /portal/[companyId]/team (BRD C1): the company's team. Owners of an active company invite new
 * contributors — single-use links they copy and send (BRD B14), up to the contributor limit (BRD B29:
 * "N of L contributors"; ScaleUp can add more) — send a new invitation to someone who has not joined
 * yet, revoke the links they or a co-owner sent, and deactivate or reactivate contributors.
 * Contributors see the list read-only; exited and written-off companies are read-only for everyone
 * (BRD B15). ScaleUp people appear as "<full name> (ScaleUp)" (BRD B28), never with an email or role.
 */
export default async function TeamPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await requireCompanyAccess(companyId);
  const membership = membershipFor(ctx, companyId);
  const companyName = membership?.companyName ?? "Your company";
  const companyStatus = membership?.companyStatus ?? "active";
  const canManage = canManageCompanyTeam(ctx, companyId);

  const sb = await createClient();
  const [membersResult, contributorLimit] = await Promise.all([
    sb
      .from("company_members")
      .select(
        "user_id, role, is_active, profile:profiles!company_members_user_id_fkey(email, full_name, job_title, is_active, terms_accepted_at)",
      )
      .eq("company_id", companyId),
    canManage ? loadContributorLimit(sb) : Promise.resolve(null),
  ]);
  if (membersResult.error) throw new Error(`Could not load the team: ${membersResult.error.message}`);
  const members: TeamMemberInput[] = membersResult.data.map(({ profile, ...member }) => ({
    ...member,
    profile: profile ?? null,
  }));

  let pendingLinks: PendingAccessLink[] = [];
  let linksUnavailable = false;
  try {
    pendingLinks = await listPendingAccessLinks({ userIds: members.map((member) => member.user_id) });
  } catch (linksError) {
    linksUnavailable = true;
    console.error("[team] could not load pending links", linksError instanceof Error ? linksError.name : "unknown");
  }

  const staffNames = await loadStaffNames(sb, idsToName(members, pendingLinks));
  const team = buildTeam({
    currentUserId: ctx.userId,
    canManage,
    companyActive: companyStatus === "active",
    members,
    pendingLinks,
    staffNames,
  });
  const allowance = contributorLimit === null ? null : contributorAllowance(members, contributorLimit);
  const blockedReason = allowance?.blockedReason ?? null;

  return (
    <>
      <PageHeader
        title="Team"
        description={`People at ${companyName} who can use ScaleUp Portfolio Reporting.`}
        actions={
          canManage ? (
            <InviteContributorButton
              companyId={companyId}
              companyName={companyName}
              blockedReason={blockedReason}
              reasonId={allowance ? ALLOWANCE_NOTE_ID : undefined}
            />
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {companyStatus !== "active" ? (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertDescription>
              {companyName} is no longer an active portfolio company ({COMPANY_STATUS_LABELS[companyStatus]}), so its
              team can&apos;t be changed.
            </AlertDescription>
          </Alert>
        ) : ctx.companyRole !== "owner" ? (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertDescription>
              Only company owners can invite or remove team members. Ask an owner if someone needs access.
            </AlertDescription>
          </Alert>
        ) : null}
        {linksUnavailable ? (
          <Alert className="border-warning/30 bg-warning/5">
            <InfoIcon className="text-warning" aria-hidden="true" />
            <AlertDescription className="text-foreground">
              Pending invitations can&apos;t be shown right now. Please try again in a minute.
            </AlertDescription>
          </Alert>
        ) : null}
        {allowance ? <ContributorAllowanceNote id={ALLOWANCE_NOTE_ID} allowance={allowance} /> : null}

        {team.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No team members yet" />
        ) : (
          <TeamTable
            companyId={companyId}
            companyName={companyName}
            members={team}
            canManage={canManage}
            reactivateBlockedReason={blockedReason}
          />
        )}

        {canManage ? (
          <p className="text-sm text-muted-foreground">
            Invitation links work once and expire after 7 days. If someone who has already joined can&apos;t sign in
            (for example, they forgot their password), ScaleUp can send them a sign-in link. Need another owner, or help
            with an account that also belongs to another company? Contact ScaleUp.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * BRD B29: the most active contributors the owners may have (`owner_contributor_limit`), or null when
 * it can't be loaded — the page then shows no count and the database still enforces the limit.
 */
async function loadContributorLimit(sb: Sb): Promise<number | null> {
  try {
    const settings = await getClientSettings(sb);
    return settings.owner_contributor_limit;
  } catch (error) {
    console.error("[team] could not load the contributor limit", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

/**
 * BRD B28: "<full name> (ScaleUp)" by lower-case id for the ScaleUp people the page shows. When the
 * names can't be loaded every id reads "ScaleUp", so their links still show.
 */
async function loadStaffNames(sb: Sb, ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  try {
    return await getStaffDisplayNames(sb, ids);
  } catch (error) {
    console.error("[team] could not load the names of ScaleUp staff", error instanceof Error ? error.name : "unknown");
    return Object.fromEntries(ids.map((id) => [id, SCALEUP_LABEL]));
  }
}
