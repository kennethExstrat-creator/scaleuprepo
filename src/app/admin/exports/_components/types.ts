import type { CompanyStatus } from "@/lib/types/enums";

/** A company offered on the exports page. */
export type ExportCompanyOption = {
  id: string;
  name: string;
  status: CompanyStatus;
  /** No reporting start month (BRD B16). */
  notYetReporting: boolean;
  /** At least one monthly update exists (something to put in a C4 workbook). */
  hasMonths: boolean;
};

export type ExportFundOption = { id: string; code: string; name: string; isActive: boolean };
