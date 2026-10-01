// Input schemas (zod v4) for the Users and Team Server Actions. Separate from the "use server" files,
// which may only export async functions. Client-safe: forms may use them for hints, the actions parse
// every input with them (Server Actions are public endpoints).
import { z } from "zod";

import { COMPANY_ROLES, SCALEUP_ROLES } from "@/lib/types/enums";

import { ACCESS_LINK_PURPOSES } from "./purpose";

const uuid = (label: string) => z.uuid(`Choose a valid ${label}.`);

/** Trimmed, lower-cased email address (Supabase Auth stores emails in lower case). */
export const emailSchema = z
  .string("Enter their email address.")
  .trim()
  .toLowerCase()
  .min(1, "Enter their email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address, e.g. name@company.com."));

export const fullNameSchema = z
  .string("Enter their full name.")
  .trim()
  .min(1, "Enter their full name.")
  .max(200, "Use 200 characters or fewer.");

/** Optional job title: blank clears it. */
export const jobTitleSchema = z
  .string()
  .trim()
  .max(200, "Use 200 characters or fewer.")
  .optional()
  .transform((value) => value ?? "");

export const scaleupRoleSchema = z.enum(SCALEUP_ROLES, "Choose a role.");
export const companyRoleSchema = z.enum(COMPANY_ROLES, "Choose a company role.");
export const accessLinkPurposeSchema = z.enum(ACCESS_LINK_PURPOSES, "Choose what the link is for.");

/** Super Admin: invite a ScaleUp team member. */
export const inviteScaleUpUserSchema = z.object({
  email: emailSchema,
  fullName: fullNameSchema,
  jobTitle: jobTitleSchema,
  role: scaleupRoleSchema,
});
export type InviteScaleUpUserInput = z.input<typeof inviteScaleUpUserSchema>;

/** Super Admin: invite a company owner or contributor (or add an existing account to a company). */
export const inviteCompanyUserSchema = z.object({
  companyId: uuid("company"),
  role: companyRoleSchema,
  email: emailSchema,
  fullName: fullNameSchema,
});
export type InviteCompanyUserInput = z.input<typeof inviteCompanyUserSchema>;

/** Company owner: invite a contributor to their own company. */
export const inviteContributorSchema = z.object({
  companyId: uuid("company"),
  email: emailSchema,
  fullName: fullNameSchema,
});
export type InviteContributorInput = z.input<typeof inviteContributorSchema>;

/** Super Admin: edit a ScaleUp team member's name, job title and role. */
export const updateScaleUpUserSchema = z.object({
  userId: uuid("user"),
  fullName: fullNameSchema,
  jobTitle: jobTitleSchema,
  role: scaleupRoleSchema,
});
export type UpdateScaleUpUserInput = z.input<typeof updateScaleUpUserSchema>;

export const userIdSchema = z.object({ userId: uuid("user") });

export const setUserActiveSchema = z.object({ userId: uuid("user"), active: z.boolean() });

export const issueUserLinkSchema = z.object({ userId: uuid("user"), purpose: accessLinkPurposeSchema });

export const linkIdSchema = z.object({ linkId: uuid("link") });

/** Super Admin: change a membership's role and/or switch it on or off. */
export const updateMembershipSchema = z
  .object({
    companyId: uuid("company"),
    userId: uuid("user"),
    role: companyRoleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.active !== undefined, {
    message: "Nothing to change.",
    path: ["role"],
  });

/** Company owner: team actions on one member of their company. */
export const teamMemberSchema = z.object({ companyId: uuid("company"), userId: uuid("user") });
export const teamMemberActiveSchema = teamMemberSchema.extend({ active: z.boolean() });
/**
 * Company owner: a new INVITATION link for a contributor who has not joined yet (BRD B29). Owners never
 * get sign-in links: someone who forgot their password asks ScaleUp for one (BRD B23).
 */
export const teamMemberLinkSchema = teamMemberSchema.extend({
  purpose: z.literal("invite", "Only ScaleUp can send sign-in links.").default("invite"),
});
export const teamLinkSchema = z.object({ companyId: uuid("company"), linkId: uuid("link") });
