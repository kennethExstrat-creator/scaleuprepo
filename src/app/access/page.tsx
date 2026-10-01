import { redirect } from "next/navigation";

/** `/access` without a token has nothing to show: continue to sign in. */
export default function AccessIndexPage() {
  redirect("/login");
}
