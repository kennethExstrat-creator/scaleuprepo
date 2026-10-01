import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManagePlatform } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { INTERNAL_RATING_META } from "@/lib/constants";
import { getCompanyInternal, getPlatformSettings } from "@/lib/data";
import { formatDate, formatNumberTrimmed } from "@/lib/format";
import { monthLabel, todayMYT } from "@/lib/periods";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";

import { DetailList, EmptyValue } from "../../_components/detail-list";
import {
  hasReportedFigures,
  loadCompanyInvestments,
  loadLatestMonth,
  loadSectorSuggestions,
} from "../../_components/queries";
import { startMonthBounds, startMonthOptions } from "../../_components/reporting";
import { DeleteCompanyCard } from "./delete-company-card";
import { ProfileForm, type ProfileValues } from "./profile-form";
import { ReportingCard } from "./reporting-card";
import { StatusCard } from "./status-card";
import { companyTabHref } from "./tabs";

/** Overview: key facts, the profile (editable by Super Admins), reporting start, status and deletion. */
export async function OverviewTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const canManage = canManagePlatform(ctx);
  const [settings, investments, internal, latest, sectors, currencyLocked] = await Promise.all([
    getPlatformSettings(sb),
    loadCompanyInvestments(sb, company.id),
    getCompanyInternal(sb, company.id),
    loadLatestMonth(sb, company.id),
    canManage ? loadSectorSuggestions(sb) : Promise.resolve<string[]>([]),
    canManage ? hasReportedFigures(sb, company.id) : Promise.resolve(false),
  ]);
  const today = todayMYT();
  const months = startMonthOptions(startMonthBounds(settings.default_reporting_start, today), company.reporting_start_month);
  const rating = internal?.internal_rating ? INTERNAL_RATING_META[internal.internal_rating] : null;
  const profile: ProfileValues = {
    name: company.name,
    legalName: company.legal_name ?? "",
    registrationNo: company.registration_no ?? "",
    sector: company.sector ?? "",
    country: company.country ?? "",
    website: company.website ?? "",
    description: company.description ?? "",
    reportingCurrency: company.reporting_currency.trim(),
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="At a glance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GlanceTile label="Funds" href={companyTabHref(company.id, "funds")} linkLabel="Funds & investment">
          {investments.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {investments.map((investment) => (
                <li key={investment.id} className="flex items-baseline gap-2">
                  <span className="font-medium">{investment.fundCode}</span>
                  {investment.ownershipPct !== null ? (
                    <span className="text-muted-foreground tabular-nums">
                      {formatNumberTrimmed(investment.ownershipPct, 4)}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyValue>Not in a fund</EmptyValue>
          )}
        </GlanceTile>
        <GlanceTile label="Partner-in-charge" href={companyTabHref(company.id, "internal")} linkLabel="Internal">
          {internal?.partner ? (
            <span className="font-medium">
              {internal.partner.full_name?.trim() || internal.partner.email}
              {internal.partner.is_active ? null : <span className="font-normal text-muted-foreground"> (inactive)</span>}
            </span>
          ) : (
            <EmptyValue>Not assigned</EmptyValue>
          )}
        </GlanceTile>
        <GlanceTile label="Latest month" href={companyTabHref(company.id, "updates")} linkLabel="Monthly updates">
          {latest ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium tabular-nums">{monthLabel(latest.month)}</span>
              <StatusBadge status={latest.status} overdue={latest.isOverdue} />
            </span>
          ) : (
            <EmptyValue>{company.reporting_start_month ? "No months opened yet" : "Not yet reporting"}</EmptyValue>
          )}
        </GlanceTile>
        <GlanceTile label="Internal rating" href={companyTabHref(company.id, "internal")} linkLabel="Internal">
          {rating ? <ToneBadge tone={rating.tone}>{rating.label}</ToneBadge> : <EmptyValue>Not rated</EmptyValue>}
        </GlanceTile>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {canManage ? (
            <ProfileForm
              // Keyed on its own saved values (not companies.updated_at, which the start month and status
              // cards change too), so it starts afresh only when the profile itself changed.
              key={JSON.stringify(profile)}
              companyId={company.id}
              initial={profile}
              sectors={sectors}
              currencyLocked={currencyLocked}
            />
          ) : (
            <ProfileDetails company={company} />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <ReportingCard
            key={company.reporting_start_month ?? "none"}
            companyId={company.id}
            companyName={company.name}
            companyStatus={company.status}
            startMonth={company.reporting_start_month}
            months={months}
            today={today}
            dueDay={settings.due_day}
            graceDays={settings.backfill_grace_days}
            canManage={canManage}
          />
          <StatusCard
            companyId={company.id}
            companyName={company.name}
            status={company.status}
            changedAt={company.status_changed_at}
            reason={company.status_reason}
            canManage={canManage}
          />
          {canManage ? <DeleteCompanyCard companyId={company.id} companyName={company.name} /> : null}
        </div>
      </div>
    </div>
  );
}

function GlanceTile({
  label,
  href,
  linkLabel,
  children,
}: {
  label: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader className="flex items-center justify-between gap-2">
        <CardDescription className="text-xs font-medium">{label}</CardDescription>
        <Button asChild variant="ghost" size="icon-xs" className="-my-1 text-muted-foreground">
          <Link href={href} scroll={false} aria-label={`Open ${linkLabel}`} title={`Open ${linkLabel}`}>
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="text-sm">{children}</CardContent>
    </Card>
  );
}

/** The profile for roles that cannot edit it. */
function ProfileDetails({ company }: { company: CompanyRow }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Company profile</h2>
        </CardTitle>
        <CardDescription>Only Super Admins can change the profile.</CardDescription>
      </CardHeader>
      <CardContent>
        <DetailList
          items={[
            { label: "Legal name", value: company.legal_name ?? <EmptyValue /> },
            { label: "Registration number", value: company.registration_no ?? <EmptyValue /> },
            { label: "Sector", value: company.sector ?? <EmptyValue /> },
            { label: "Country", value: company.country ?? <EmptyValue /> },
            {
              label: "Website",
              value: company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {company.website.replace(/^https?:\/\//i, "")}
                </a>
              ) : (
                <EmptyValue />
              ),
            },
            { label: "Reporting currency", value: company.reporting_currency.trim() },
            { label: "Added", value: formatDate(company.created_at) },
            { label: "Description", value: company.description ?? <EmptyValue /> },
          ]}
        />
      </CardContent>
    </Card>
  );
}
