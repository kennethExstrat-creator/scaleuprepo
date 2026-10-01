"use client";

import { LandmarkIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { useDialogState } from "@/app/admin/companies/_components/form-controls";

import { FundFormDialog } from "./fund-form-dialog";
import type { FundListRow } from "./fund-types";

/** "Add fund" in the page header (Super Admin). */
export function AddFundButton() {
  const dialog = useDialogState<FundListRow>();
  return (
    <>
      <Button onClick={() => dialog.show(null)}>
        <PlusIcon data-icon="inline-start" />
        Add fund
      </Button>
      <FundFormDialog key={dialog.key} fund={null} open={dialog.open} onOpenChange={dialog.setOpen} />
    </>
  );
}

function companiesLabel(count: number): string {
  return `${count} ${count === 1 ? "company" : "companies"}`;
}

/** The funds with their company counts; Super Admins edit them. */
export function FundsTable({ funds, canManage }: { funds: FundListRow[]; canManage: boolean }) {
  const dialog = useDialogState<FundListRow>();

  if (funds.length === 0) {
    return (
      <>
        <EmptyState
          icon={LandmarkIcon}
          title="No funds yet"
          description={
            canManage
              ? "Add ScaleUp's funds (for example SV1 and SFF), then map each company to the funds that hold it."
              : "Funds are added by a Super Admin."
          }
          action={
            canManage ? (
              <Button onClick={() => dialog.show(null)}>
                <PlusIcon data-icon="inline-start" />
                Add fund
              </Button>
            ) : undefined
          }
        />
        <FundFormDialog key={dialog.key} fund={null} open={dialog.open} onOpenChange={dialog.setOpen} />
      </>
    );
  }

  return (
    <>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24 pl-4">Code</TableHead>
              <TableHead>Fund</TableHead>
              <TableHead className="text-right">Companies</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead className="w-0 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {funds.map((fund) => (
              <TableRow key={fund.id}>
                <TableCell className="pl-4 align-top font-semibold tracking-wide">{fund.code}</TableCell>
                <TableCell className="max-w-md align-top whitespace-normal">
                  <div className="font-medium">{fund.name}</div>
                  {fund.legalName && fund.legalName !== fund.name ? (
                    <div className="text-xs text-muted-foreground">{fund.legalName}</div>
                  ) : null}
                  {fund.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={fund.description}>
                      {fund.description}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {fund.companies > 0 ? (
                    <Link
                      href={`/admin/companies?fund=${encodeURIComponent(fund.code)}`}
                      className="font-medium underline-offset-4 hover:underline"
                      title={`Show the companies in ${fund.code}`}
                    >
                      {companiesLabel(fund.companies)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No companies</span>
                  )}
                  {fund.companies > 0 && fund.activeCompanies !== fund.companies ? (
                    <div className="text-xs text-muted-foreground">{fund.activeCompanies} active</div>
                  ) : null}
                </TableCell>
                <TableCell className="align-top">
                  <ToneBadge tone={fund.isActive ? "success" : "neutral"}>
                    {fund.isActive ? "Active" : "Inactive"}
                  </ToneBadge>
                </TableCell>
                {canManage ? (
                  <TableCell className="pr-4 text-right align-top">
                    <Button variant="ghost" size="sm" onClick={() => dialog.show(fund)}>
                      <PencilIcon data-icon="inline-start" />
                      Edit<span className="sr-only"> {fund.code}</span>
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {canManage ? (
        <FundFormDialog key={dialog.key} fund={dialog.item} open={dialog.open} onOpenChange={dialog.setOpen} />
      ) : null}
    </>
  );
}
