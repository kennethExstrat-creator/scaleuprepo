"use client";

import { InfoIcon, ListTreeIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REVENUE_SEGMENT_KIND_META } from "@/lib/constants";

import {
  addRevenueLineAction,
  deleteRevenueLineAction,
  moveRevenueLineAction,
  renameRevenueLineAction,
  setRevenueLineActiveAction,
} from "../../actions";
import { AddNameForm } from "./config-controls";
import { ConfigItemList, type ConfigItem } from "./config-item-list";

/**
 * ScaleUp revenue lines of a company (BRD §6.1, B30; `revenue_segments.kind = 'scaleup'`): named to suit
 * the company, required in every monthly update, and they need not add up to total revenue. Super Admins
 * and Fund Admins manage them. The company's own revenue segments are a separate breakdown (read-only on
 * this page; the company owner sets them).
 */
export function RevenueLinesEditor({
  companyId,
  companyName,
  lines,
  canManage,
}: {
  companyId: string;
  companyName: string;
  /** ScaleUp revenue lines only, in display order. */
  lines: ConfigItem[];
  canManage: boolean;
}) {
  const activeCount = lines.filter((line) => line.is_active).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{REVENUE_SEGMENT_KIND_META.scaleup.plural}</h2>
        </CardTitle>
        <CardDescription>
          Lines ScaleUp asks {companyName} to report every month, named to suit the company (for example by product
          or business). They need not add up to total revenue, which the company reports separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {lines.length === 0 ? (
          <EmptyState
            icon={ListTreeIcon}
            title="No ScaleUp revenue lines"
            description={`${companyName} isn't asked for any revenue lines.${canManage ? " Add lines to collect the revenue of the products or businesses ScaleUp follows." : ""}`}
          />
        ) : (
          <>
            {activeCount === 0 ? (
              <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Every line is inactive, so monthly updates don&apos;t ask for any of them.
              </p>
            ) : null}
            <ConfigItemList
              items={lines}
              canManage={canManage}
              noun={{ singular: "revenue line" }}
              deactivateEffect="It is no longer asked for in monthly updates that are still open."
              onMove={(id, direction) => moveRevenueLineAction({ companyId, id, direction })}
              onRename={(id, name) => renameRevenueLineAction({ companyId, id, name })}
              onSetActive={(id, active) => setRevenueLineActiveAction({ companyId, id, active })}
              onDelete={(id) => deleteRevenueLineAction({ companyId, id })}
            />
          </>
        )}
        {canManage ? (
          <AddNameForm
            id="add-revenue-line"
            label="New revenue line"
            placeholder="New revenue line, e.g. Subscriptions"
            buttonLabel="Add line"
            successMessage={(name) => `${name} added`}
            onAdd={(name) => addRevenueLineAction({ companyId, name })}
            className="sm:max-w-md"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
