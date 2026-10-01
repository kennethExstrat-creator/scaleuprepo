import { redirect } from "next/navigation";

import { requireScaleUp } from "@/lib/auth/session";

/** /admin/review has no list of its own: months are opened for review from the tracker. */
export default async function ReviewIndexPage() {
  await requireScaleUp();
  redirect("/admin/tracker");
}
