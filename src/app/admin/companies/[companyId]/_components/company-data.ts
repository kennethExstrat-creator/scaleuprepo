import "server-only";

import { cache } from "react";

import { getCompany } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/types/domain";

/**
 * The company for /admin/companies/[companyId], once per request (the page and its metadata share it).
 * Null when it does not exist, is not visible or the id is not a UUID.
 */
export const loadCompany = cache(async (companyId: string): Promise<CompanyRow | null> => {
  const sb = await createClient();
  return getCompany(sb, companyId);
});
