// Access-context types (docs/ARCHITECTURE.md §5.2). Type-only module: safe to import from
// Client Components with `import type`.
import type { CompanyRole, CompanyStatus, ScaleupRole } from "@/lib/types/enums";

export type { CompanyRole, CompanyStatus, ScaleupRole };

/** An active company membership of the signed-in user. */
export type Membership = {
  companyId: string;
  companyName: string;
  companyStatus: CompanyStatus;
  role: CompanyRole;
};

/** Who is signed in and what they may do. Built once per request by `getAccessContext()`. */
export type AccessContext = {
  userId: string;
  email: string;
  fullName: string | null;
  /** ScaleUp role; null for company users. */
  scaleupRole: ScaleupRole | null;
  isActive: boolean;
  /** Active memberships, sorted by company name. */
  memberships: Membership[];
  /** Authenticator assurance level of the current session (aal2 = TOTP verified). */
  aal: "aal1" | "aal2";
  /** `platform_settings.require_mfa`. */
  mfaRequired: boolean;
  /** Accepted the current `platform_settings.terms_version`. */
  termsAccepted: boolean;
};

/** Returned by `requireScaleUp` / `assertScaleUp`: `scaleupRole` is guaranteed. */
export type ScaleUpAccessContext = AccessContext & { scaleupRole: ScaleupRole };

/** Returned by `requireCompanyAccess` / `assertCompanyAccess`. */
export type CompanyAccessContext = AccessContext & { companyRole: CompanyRole };

/** Returned by `assertCanViewCompany`: `companyRole` is null for ScaleUp staff. */
export type CompanyViewContext = AccessContext & { companyRole: CompanyRole | null };
