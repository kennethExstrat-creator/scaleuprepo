import { ArrowRightIcon, Building2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/app/status-badge";
import { Logo } from "@/components/shell/logo";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { UserMenu } from "@/components/shell/user-menu";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { COMPANY_ROLE_LABELS, COMPANY_STATUS_LABELS } from "@/lib/constants";

export const metadata: Metadata = { title: "Your companies" };

/** Company picker for founders with several companies; one company → straight to it. */
export default async function PortalIndexPage() {
  const ctx = await requireUser();
  if (ctx.scaleupRole) redirect("/admin");
  if (ctx.memberships.length === 1) redirect(`/portal/${ctx.memberships[0].companyId}`);

  const roleLabel =
    ctx.memberships.length > 0 && ctx.memberships.every((m) => m.role === ctx.memberships[0].role)
      ? COMPANY_ROLE_LABELS[ctx.memberships[0].role]
      : "Company user";

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background px-4 md:px-6">
        <Link href="/portal" aria-label="Your companies">
          <Logo className="h-8" />
        </Link>
        <UserMenu name={ctx.fullName} email={ctx.email} roleLabel={roleLabel} />
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col p-4 md:p-8">
        {ctx.memberships.length === 0 ? (
          <EmptyState
            className="mt-10"
            icon={Building2Icon}
            title="You haven't been added to a company yet"
            description="Ask your company owner or your ScaleUp contact to invite you. You'll see your company here once you've been added."
            action={<SignOutButton />}
          />
        ) : (
          <>
            <PageHeader
              title="Choose a company"
              description="You have access to more than one company. Pick the one you want to report for."
            />
            <ul className="grid gap-4 sm:grid-cols-2">
              {ctx.memberships.map((membership) => (
                <li key={membership.companyId}>
                  <Link
                    href={`/portal/${membership.companyId}`}
                    className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Card className="transition-shadow group-hover:shadow-md group-hover:ring-primary/40">
                      <CardHeader>
                        <div className="flex items-start gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Building2Icon className="size-5" />
                          </span>
                          <div className="min-w-0 flex-1 space-y-1">
                            <CardTitle className="truncate">{membership.companyName}</CardTitle>
                            <CardDescription className="flex flex-wrap items-center gap-2">
                              {COMPANY_ROLE_LABELS[membership.role]}
                              {membership.companyStatus !== "active" ? (
                                <ToneBadge tone="neutral">{COMPANY_STATUS_LABELS[membership.companyStatus]}</ToneBadge>
                              ) : null}
                            </CardDescription>
                          </div>
                          <ArrowRightIcon className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        </div>
                      </CardHeader>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
