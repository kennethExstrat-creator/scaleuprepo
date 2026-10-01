import type { Metadata } from "next";

import {
  buildDirectory,
  initialUsersTab,
  type CompanyOption,
  type MembershipInput,
  type ProfileInput,
} from "./_components/directory-model";
import { InviteCompanyUserButton } from "./_components/invite-company-user-dialog";
import { InviteScaleUpUserButton } from "./_components/invite-scaleup-user-dialog";
import { UsersDirectory } from "./_components/users-directory";
import { PageHeader } from "@/components/app/page-header";
import { listAuthUsers, listPendingAccessLinks, type AuthUserSummary, type PendingAccessLink } from "@/lib/auth-admin";
import { firstParam } from "@/lib/auth/redirects";
import { isUuid, requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Users" };

type Settled<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(promise: Promise<T>, what: string): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    console.error(`[users] could not load ${what}`, error instanceof Error ? error.name : "unknown");
    return { ok: false };
  }
}

/**
 * /admin/users (BRD A2; Super Admin only): the ScaleUp team, company users and pending links, with
 * invitations, roles, memberships, deactivation, 2FA resets and new sign-in links.
 * `?company=<id>` opens the Company users tab filtered to that company (linked from the company page);
 * `?tab=scaleup|company|pending` opens a tab.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireScaleUp(["super_admin"]);
  const params = await searchParams;
  const companyParam = firstParam(params.company);
  const companyId = isUuid(companyParam) ? companyParam : undefined;

  const sb = await createClient();
  const [profilesRes, membersRes, companiesRes, authUsers, pendingLinks] = await Promise.all([
    sb.from("profiles").select("id, email, full_name, job_title, scaleup_role, is_active, terms_accepted_at"),
    sb.from("company_members").select("company_id, user_id, role, is_active"),
    sb.from("companies").select("id, name, status").order("name"),
    settle<AuthUserSummary[]>(listAuthUsers(), "the sign-in accounts"),
    settle<PendingAccessLink[]>(listPendingAccessLinks(), "the pending links"),
  ]);
  if (profilesRes.error) throw new Error(`Could not load the users: ${profilesRes.error.message}`);
  if (membersRes.error) throw new Error(`Could not load the company memberships: ${membersRes.error.message}`);
  if (companiesRes.error) throw new Error(`Could not load the companies: ${companiesRes.error.message}`);

  const profiles: ProfileInput[] = profilesRes.data;
  const memberships: MembershipInput[] = membersRes.data;
  const companies: CompanyOption[] = companiesRes.data;

  const { users, links } = buildDirectory({
    currentUserId: ctx.userId,
    profiles,
    memberships,
    companies,
    authUsers: authUsers.ok ? authUsers.value : null,
    pendingLinks: pendingLinks.ok ? pendingLinks.value : null,
  });
  const filterCompanyId = companyId && companies.some((company) => company.id === companyId) ? companyId : undefined;
  const activeCompanies = companies.filter((company) => company.status === "active");

  return (
    <>
      <PageHeader
        title="Users"
        description="Invite people, manage roles and company access, and help anyone who can't sign in. Links are single-use: copy them and send them yourself by email or chat."
        actions={
          <>
            <InviteCompanyUserButton companies={activeCompanies} defaultCompanyId={filterCompanyId} />
            <InviteScaleUpUserButton />
          </>
        }
      />
      <UsersDirectory
        users={users}
        links={links}
        companies={companies}
        initialTab={initialUsersTab(firstParam(params.tab), filterCompanyId)}
        initialCompanyId={filterCompanyId ?? null}
        authUnavailable={!authUsers.ok}
        linksUnavailable={!pendingLinks.ok}
      />
    </>
  );
}
