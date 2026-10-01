import { ArrowLeftIcon, LockIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

/**
 * /admin/companies/new for ScaleUp staff who are not Super Admins: the page's guard
 * (requireScaleUp(["super_admin"])) calls notFound(), and this explains it inside the admin shell.
 */
export default function NewCompanyNotFound() {
  return (
    <EmptyState
      className="mt-6"
      icon={LockIcon}
      title="Only Super Admins can add companies"
      description="Ask a Super Admin to add the company. You can still open every portfolio company from the companies list."
      action={
        <Button asChild variant="outline">
          <Link href="/admin/companies">
            <ArrowLeftIcon data-icon="inline-start" />
            Back to companies
          </Link>
        </Button>
      }
    />
  );
}
