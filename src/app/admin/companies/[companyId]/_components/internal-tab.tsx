import { LockIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { canAssignPartner, canEditInternal } from "@/lib/auth/permissions";
import type { ScaleUpAccessContext } from "@/lib/auth/types";
import { getCompanyInternal } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";

import { loadPartnerOptions, loadPersonName } from "../../_components/queries";
import type { PartnerOption } from "../../_components/types";
import { InternalFieldsForm, PartnerCard, type CurrentPartner, type InternalValues } from "./internal-forms";

/**
 * Internal (ScaleUp only, BRD §6.3): partner-in-charge (Super Admins assign it) and the internal rating,
 * exit strategy and notes (Super Admin, Fund Admin, the partner-in-charge). Never shown to companies.
 */
export async function InternalTab({ ctx, company }: { ctx: ScaleUpAccessContext; company: CompanyRow }) {
  const sb = await createClient();
  const internal = await getCompanyInternal(sb, company.id);
  if (!internal) {
    return (
      <EmptyState
        icon={LockIcon}
        title="Internal details are not available"
        description="Reload the page. If this keeps happening, the company's internal record is missing."
      />
    );
  }

  const canAssign = canAssignPartner(ctx);
  const [partners, updatedByName] = await Promise.all([
    canAssign
      ? loadPartnerOptions(sb, internal.partner_in_charge_id ? [internal.partner_in_charge_id] : [])
      : Promise.resolve<PartnerOption[]>([]),
    loadPersonName(sb, internal.updated_by),
  ]);

  const current: CurrentPartner | null = internal.partner
    ? {
        id: internal.partner.id,
        name: internal.partner.full_name?.trim() || internal.partner.email,
        email: internal.partner.email,
        role: internal.partner.scaleup_role,
        isActive: internal.partner.is_active,
      }
    : null;
  const lastUpdated =
    internal.updated_at !== internal.created_at
      ? `Last updated ${formatDateTime(internal.updated_at)}${updatedByName ? ` by ${updatedByName}` : ""}.`
      : null;
  const fields: InternalValues = {
    internalRating: internal.internal_rating ?? "",
    exitStrategyStatus: internal.exit_strategy_status ?? "",
    exitStrategyNotes: internal.exit_strategy_notes ?? "",
    notes: internal.notes ?? "",
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LockIcon className="size-4 shrink-0" aria-hidden="true" />
        ScaleUp only. Nothing on this tab is ever shown to the company.
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <InternalFieldsForm
            // Keyed on its own saved values (not company_internal.updated_at, which assigning the partner
            // changes too), so unsaved edits survive a save of the partner card.
            key={JSON.stringify(fields)}
            companyId={company.id}
            initial={fields}
            canEdit={canEditInternal(ctx, internal)}
            lastUpdated={lastUpdated}
          />
        </div>
        <PartnerCard
          key={internal.partner_in_charge_id ?? "none"}
          companyId={company.id}
          current={current}
          partners={partners}
          canAssign={canAssign}
        />
      </div>
    </div>
  );
}
