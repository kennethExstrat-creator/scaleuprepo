/** A fund on /admin/funds, with its company counts. */
export type FundListRow = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  description: string | null;
  isActive: boolean;
  /** Companies mapped to the fund (any status). */
  companies: number;
  /** Of which active (not exited or written off). */
  activeCompanies: number;
};
