import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { COMPANY_STATUS_META, NOT_YET_REPORTING_META } from "@/lib/constants";
import { monthLabel } from "@/lib/periods";
import type { CompanyRow } from "@/lib/types/domain";

/** Title block of the company page: name, status, reporting state and the key facts. */
export function CompanyHeader({ company }: { company: CompanyRow }) {
  const status = COMPANY_STATUS_META[company.status];
  const currency = company.reporting_currency.trim();
  const facts = [
    company.legal_name && company.legal_name !== company.name ? company.legal_name : null,
    company.sector,
    company.country,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <PageHeader
      className="mb-4"
      breadcrumbs={[{ label: "Companies", href: "/admin/companies" }, { label: company.name }]}
      title={company.name}
      description={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
          {company.reporting_start_month ? (
            <ToneBadge tone="info">Reporting from {monthLabel(company.reporting_start_month)}</ToneBadge>
          ) : (
            <ToneBadge tone={NOT_YET_REPORTING_META.tone} title={NOT_YET_REPORTING_META.description}>
              {NOT_YET_REPORTING_META.label}
            </ToneBadge>
          )}
          {currency !== "MYR" ? <Badge variant="outline">Reports in {currency}</Badge> : null}
          {facts.length > 0 ? <span>{facts.join(" · ")}</span> : null}
        </div>
      }
    />
  );
}
