import { UsersIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManagePlatform } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { COMPANY_ROLE_LABELS, type Tone } from "@/lib/constants";
import { getPlatformSettings } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { contributorSlotsLeft, type CompanyRow, type MemberWithProfile } from "@/lib/types/domain";

import { loadCompanyMembers } from "../../_components/queries";
import { personName } from "../../_components/types";

function memberState(member: MemberWithProfile): { label: string; tone: Tone; title?: string } {
  if (!member.is_active) return { label: "Removed from team", tone: "neutral" };
  if (member.profile && !member.profile.is_active) {
    return { label: "Account deactivated", tone: "danger", title: "The person can no longer sign in." };
  }
  if (!member.profile?.terms_accepted_at) {
    return { label: "Not signed in yet", tone: "warning", title: "Has not completed their first sign-in." };
  }
  return { label: "Active", tone: "success" };
}

/**
 * The owner's contributor allowance (BRD B29): the company's active contributor memberships (a pending
 * invitation is an active membership, so it counts) against platform_settings.owner_contributor_limit.
 * ScaleUp is not limited.
 */
function ContributorAllowance({ members, limit }: { members: MemberWithProfile[]; limit: number }) {
  const contributors = members.filter((member) => member.is_active && member.role === "contributor").length;
  const reached = limit > 0 && contributorSlotsLeft(contributors, limit) === 0;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
        <span className="font-medium text-foreground tabular-nums">{contributors}</span> active{" "}
        {contributors === 1 ? "contributor" : "contributors"}, pending invitations included.
      </span>
      <span>
        {limit > 0
          ? `Owners can invite up to ${limit}; ScaleUp can add more.`
          : "Owners can't invite contributors; ScaleUp adds them."}
      </span>
      {reached ? <ToneBadge tone="warning">Owner limit reached</ToneBadge> : null}
    </p>
  );
}

/** Team: the company's users (read-only here; Super Admins manage them on the Users page). */
export async function TeamTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const [members, settings] = await Promise.all([loadCompanyMembers(sb, company.id), getPlatformSettings(sb)]);
  const canManageUsers = canManagePlatform(ctx);
  const usersHref = `/admin/users?company=${company.id}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Team</h2>
        </CardTitle>
        <CardDescription>
          {company.name}&apos;s users. Owners submit the monthly updates and manage contributors; contributors enter
          figures and upload files.
        </CardDescription>
        {canManageUsers ? (
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link href={usersHref}>
                <UsersIcon data-icon="inline-start" />
                Manage users
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No users yet"
            description={
              canManageUsers
                ? "Invite the company owner from Users; they can then invite their own contributors."
                : "A Super Admin invites the company owner."
            }
            action={
              canManageUsers ? (
                <Button asChild>
                  <Link href={usersHref}>Invite users</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ContributorAllowance members={members} limit={settings.owner_contributor_limit} />
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-3">Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-3">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const state = memberState(member);
                    return (
                      <TableRow key={member.user_id} className={member.is_active ? undefined : "text-muted-foreground"}>
                        <TableCell className="pl-3">
                          <div className="font-medium">{personName(member.profile)}</div>
                          {member.profile?.job_title ? (
                            <div className="text-xs text-muted-foreground">{member.profile.job_title}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {member.profile?.email ? (
                            <a href={`mailto:${member.profile.email}`} className="underline-offset-4 hover:underline">
                              {member.profile.email}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{COMPANY_ROLE_LABELS[member.role]}</TableCell>
                        <TableCell>
                          <ToneBadge tone={state.tone} title={state.title}>
                            {state.label}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="pr-3 tabular-nums">{formatDate(member.created_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
