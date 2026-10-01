import { LayoutTemplateIcon } from "lucide-react";
import type { Metadata } from "next";

import { TemplateCard } from "./_components/template-card";
import { loadTemplatesOverview } from "./_lib/queries";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { canManageTemplates } from "@/lib/auth/permissions";
import { requireScaleUp } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Templates" };

/** Template builder home (BRD A3): templates with their versions; Super Admin and Fund Admin only. */
export default async function TemplatesPage() {
  const ctx = await requireScaleUp(["super_admin", "fund_admin"]);
  const sb = await createClient();
  const { templates, people } = await loadTemplatesOverview(sb);
  const canManage = canManageTemplates(ctx);

  return (
    <>
      <PageHeader
        title="Templates"
        description="The monthly update form companies fill in. Changes are made in a draft and reach companies once you publish it: months opened from then on use the new version, while months already opened keep the version they started with."
      />
      {templates.length === 0 ? (
        <EmptyState
          icon={LayoutTemplateIcon}
          title="No templates yet"
          description="The Portfolio Update template is created when the database is set up. Please ask your platform administrator to run the database seed."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {templates.map((overview) => (
            <TemplateCard
              key={overview.template.id}
              overview={overview}
              people={people}
              canManage={canManage}
              showMakeDefault={templates.length > 1}
            />
          ))}
        </div>
      )}
    </>
  );
}
