"use client";

// The companies list (/admin/companies): search and filters (fund, status, partner-in-charge, reporting)
// applied in the browser over every company (the portfolio is small), kept in the URL with
// history.replaceState so a filtered view can be bookmarked or shared without a server round trip.

import { Building2Icon, SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { StatusBadge, ToneBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COMPANY_STATUS_META, NOT_YET_REPORTING_META } from "@/lib/constants";
import { monthLabel } from "@/lib/periods";
import { COMPANY_STATUSES, type CompanyStatus } from "@/lib/types/enums";
import { cn } from "@/lib/utils";

import {
  filterCompanies,
  filtersToQueryString,
  hasActiveFilters,
  NO_FILTERS,
  summariseCompanies,
  UNASSIGNED_PARTNER,
  type CompanyFilters,
  type CompanyListRow,
  type ReportingFilter,
} from "./company-list";
import type { FundOption } from "./types";

const ALL = "all";

function toReportingFilter(value: string): ReportingFilter | null {
  return value === "yes" || value === "no" ? value : null;
}

type Props = {
  rows: CompanyListRow[];
  funds: FundOption[];
  partners: { id: string; name: string; isActive: boolean }[];
  initialFilters: CompanyFilters;
  canCreate: boolean;
};

export function CompaniesExplorer({ rows, funds, partners, initialFilters, canCreate }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<CompanyFilters>(initialFilters);
  const visible = useMemo(() => filterCompanies(rows, filters), [rows, filters]);
  const summary = useMemo(() => summariseCompanies(rows), [rows]);
  const filtered = hasActiveFilters(filters);

  function apply(next: CompanyFilters) {
    setFilters(next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${filtersToQueryString(next)}`);
  }

  function openCompany(event: React.MouseEvent<HTMLTableRowElement>, href: string) {
    // Links and buttons inside the row handle their own clicks; keep text selection possible.
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="search" aria-label="Filter companies" className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <InputGroup className="xl:max-w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={filters.q}
            onChange={(event) => apply({ ...filters, q: event.target.value })}
            placeholder="Search by name"
            aria-label="Search companies by name"
            maxLength={100}
          />
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect
            label="Filter by fund"
            value={filters.fund ?? ALL}
            onValueChange={(value) => apply({ ...filters, fund: value === ALL ? null : value })}
            options={[
              { value: ALL, label: "All funds" },
              ...funds.map((fund) => ({ value: fund.code.toUpperCase(), label: `${fund.code} · ${fund.name}` })),
            ]}
          />
          <FilterSelect
            label="Filter by status"
            value={filters.status ?? ALL}
            onValueChange={(value) =>
              apply({ ...filters, status: value === ALL ? null : COMPANY_STATUSES.find((s) => s === value) ?? null })
            }
            options={[
              { value: ALL, label: "All statuses" },
              ...COMPANY_STATUSES.map((status: CompanyStatus) => ({
                value: status,
                label: COMPANY_STATUS_META[status].label,
              })),
            ]}
          />
          <FilterSelect
            label="Filter by partner-in-charge"
            value={filters.partner ?? ALL}
            onValueChange={(value) => apply({ ...filters, partner: value === ALL ? null : value })}
            options={[
              { value: ALL, label: "All partners" },
              { value: UNASSIGNED_PARTNER, label: "No partner assigned" },
              ...partners.map((partner) => ({
                value: partner.id,
                label: partner.isActive ? partner.name : `${partner.name} (inactive)`,
              })),
            ]}
          />
          <FilterSelect
            label="Filter by reporting"
            value={filters.reporting ?? ALL}
            onValueChange={(value) =>
              apply({ ...filters, reporting: toReportingFilter(value) })
            }
            options={[
              { value: ALL, label: "Reporting or not" },
              { value: "yes", label: "Reporting" },
              { value: "no", label: NOT_YET_REPORTING_META.label },
            ]}
          />
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => apply(NO_FILTERS)} className="justify-self-start">
              <XIcon data-icon="inline-start" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered
          ? `Showing ${visible.length} of ${rows.length} ${rows.length === 1 ? "company" : "companies"}`
          : `${summary.total} ${summary.total === 1 ? "company" : "companies"} · ${summary.active} active · ${summary.reporting} reporting · ${summary.notYetReporting} not yet reporting`}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No companies yet"
          description="Add the portfolio companies to start collecting their monthly updates."
          action={
            canCreate ? (
              <Button asChild>
                <Link href="/admin/companies/new">Add company</Link>
              </Button>
            ) : undefined
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={SearchXIcon}
          title="No companies match these filters"
          description="Try a different search or clear the filters."
          action={
            <Button variant="outline" onClick={() => apply(NO_FILTERS)}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Company</TableHead>
                <TableHead>Funds</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reporting</TableHead>
                <TableHead>Latest month</TableHead>
                <TableHead className="pr-4">Partner-in-charge</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => {
                const href = `/admin/companies/${row.id}`;
                const statusMeta = COMPANY_STATUS_META[row.status];
                return (
                  <TableRow key={row.id} className="cursor-pointer" onClick={(event) => openCompany(event, href)}>
                    <TableCell className="max-w-72 pl-4">
                      <div className="flex items-center gap-2">
                        <Link href={href} className="truncate font-medium underline-offset-4 hover:underline">
                          {row.name}
                        </Link>
                        {row.reportingCurrency !== "MYR" ? (
                          <Badge variant="outline" title={`Reports in ${row.reportingCurrency}`}>
                            {row.reportingCurrency}
                          </Badge>
                        ) : null}
                      </div>
                      {row.legalName && row.legalName !== row.name ? (
                        <div className="truncate text-xs text-muted-foreground">{row.legalName}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.funds.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.funds.map((fund) => (
                            <Badge key={fund.id} variant="secondary" title={fund.name}>
                              {fund.code}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 truncate">
                      {row.sector ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={statusMeta.tone}>{statusMeta.label}</ToneBadge>
                    </TableCell>
                    <TableCell>
                      {row.reportingStartMonth ? (
                        <span className="tabular-nums">From {monthLabel(row.reportingStartMonth)}</span>
                      ) : (
                        <ToneBadge tone={NOT_YET_REPORTING_META.tone} title={NOT_YET_REPORTING_META.description}>
                          {NOT_YET_REPORTING_META.label}
                        </ToneBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.latest ? (
                        <Link
                          href={`/admin/review/${row.latest.submissionId}`}
                          className="inline-flex items-center gap-2 rounded-md underline-offset-4 hover:underline"
                          title={
                            row.latest.isOverdue
                              ? `${monthLabel(row.latest.month)}: ${row.latest.daysOverdue} ${row.latest.daysOverdue === 1 ? "day" : "days"} overdue`
                              : `Open ${monthLabel(row.latest.month)}`
                          }
                        >
                          <span className="text-muted-foreground tabular-nums">{monthLabel(row.latest.month)}</span>
                          <StatusBadge status={row.latest.status} overdue={row.latest.isOverdue} />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 truncate pr-4">
                      {row.partner ? (
                        <span className={row.partner.isActive ? undefined : "text-muted-foreground"}>
                          {row.partner.name}
                          {row.partner.isActive ? null : " (inactive)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("w-full sm:w-auto sm:min-w-40", value !== ALL && "border-primary/40 bg-primary/5")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
