"use client";

import {
  Building2Icon,
  EllipsisIcon,
  InfoIcon,
  LinkIcon,
  MailIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldOffIcon,
  UserCheckIcon,
  UsersIcon,
  UserXIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  issueUserLinkAction,
  resetUserMfaAction,
  revokeAccessLinkAction,
  setUserActiveAction,
} from "../actions";
import { CompanyAccessDialog } from "./company-access-dialog";
import {
  describeAccess,
  matchesQuery,
  type CompanyOption,
  type DirectoryLink,
  type DirectoryUser,
  type UsersTab,
} from "./directory-model";
import { EditScaleUpUserDialog } from "./edit-scaleup-user-dialog";
import { InviteCompanyUserDialog } from "./invite-company-user-dialog";
import { AccountStatusCell, LastSignInCell, MembershipList, MfaCell, PersonCell } from "./user-cells";
import { AccessLinkDialog } from "@/app/access/_components/access-link-dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { ToneBadge } from "@/components/app/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ACCESS_LINK_VALIDITY_LABELS, type AccessLinkPurpose } from "@/lib/auth-admin/purpose";
import { ACCESS_LINK_PURPOSE_LABELS, displayName } from "@/lib/auth-admin/status";
import type { InviteOutcome } from "@/lib/auth-admin/types";
import { COMPANY_STATUS_LABELS, SCALEUP_ROLE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

const ALL_COMPANIES = "all";

/** Dialogs that edit something (they read the person from the latest page data while open). */
type EditDialog =
  | { kind: "edit"; userId: string }
  | { kind: "companies"; userId: string }
  | { kind: "add-company"; userId: string };

/** Dialogs that only confirm one action (their wording is fixed when they open). */
type ConfirmRequest =
  | { kind: "link"; userId: string; purpose: AccessLinkPurpose }
  | { kind: "reset-mfa"; userId: string }
  | { kind: "active"; userId: string; active: boolean }
  | { kind: "revoke"; linkId: string };

type DirectoryDialog = EditDialog | ConfirmRequest;

type ConfirmSpec = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<void>;
};

export function UsersDirectory({
  users,
  links,
  companies,
  initialTab,
  initialCompanyId,
  authUnavailable,
  linksUnavailable,
}: {
  users: DirectoryUser[];
  links: DirectoryLink[];
  companies: CompanyOption[];
  initialTab: UsersTab;
  initialCompanyId: string | null;
  authUnavailable: boolean;
  linksUnavailable: boolean;
}) {
  const [tab, setTab] = useState<UsersTab>(initialTab);
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>(initialCompanyId ?? ALL_COMPANIES);
  const [dialog, setDialog] = useState<EditDialog | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const staff = useMemo(() => users.filter((user) => user.scaleupRole !== null), [users]);
  const companyUsers = useMemo(() => users.filter((user) => user.scaleupRole === null), [users]);
  const activeCompanies = useMemo(() => companies.filter((company) => company.status === "active"), [companies]);

  const visibleStaff = staff.filter((user) => matchesQuery(user, query));
  const visibleCompanyUsers = companyUsers.filter(
    (user) =>
      (companyFilter === ALL_COMPANIES || user.memberships.some((m) => m.companyId === companyFilter)) &&
      matchesQuery(user, query),
  );
  const visibleLinks = links.filter((link) => {
    const q = query.trim().toLowerCase();
    return !q || `${link.name} ${link.email} ${link.access}`.toLowerCase().includes(q);
  });

  function syncUrl(nextTab: UsersTab, nextCompany: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    if (nextCompany === ALL_COMPANIES) url.searchParams.delete("company");
    else url.searchParams.set("company", nextCompany);
    window.history.replaceState(window.history.state, "", url);
  }

  const dialogUser = dialog ? (usersById.get(dialog.userId) ?? null) : null;

  function openDialog(next: DirectoryDialog) {
    if (next.kind === "edit" || next.kind === "companies" || next.kind === "add-company") {
      setDialog(next);
      return;
    }
    const user = next.kind === "revoke" ? null : (usersById.get(next.userId) ?? null);
    setConfirm(confirmSpec(next, user, links, setOutcome));
  }

  return (
    <div className="flex flex-col gap-4">
      {authUnavailable ? (
        <Alert className="border-warning/30 bg-warning/5">
          <InfoIcon className="text-warning" aria-hidden="true" />
          <AlertDescription className="text-foreground">
            Sign-in details (last sign-in and two-factor status) can&apos;t be loaded right now. Everything else is up
            to date.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = value === "company" || value === "pending" ? value : "scaleup";
          setTab(next);
          syncUrl(next, companyFilter);
        }}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList>
              <TabsTrigger value="scaleup">
                ScaleUp team <Count value={staff.length} />
              </TabsTrigger>
              <TabsTrigger value="company">
                Company users <Count value={companyUsers.length} />
              </TabsTrigger>
              <TabsTrigger value="pending">
                Pending invitations <Count value={links.length} />
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {tab === "company" ? (
              <Select
                value={companyFilter}
                onValueChange={(value) => {
                  setCompanyFilter(value);
                  syncUrl(tab, value);
                }}
              >
                <SelectTrigger className="w-full sm:w-56" aria-label="Filter by company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                      {company.status !== "active" ? ` (${COMPANY_STATUS_LABELS[company.status]})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <InputGroup className="w-full sm:w-64">
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or email"
                aria-label="Search people by name or email"
              />
            </InputGroup>
          </div>
        </div>

        <TabsContent value="scaleup" className="mt-2">
          {visibleStaff.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No one matches your search" description="Try another name or email." />
          ) : (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Person</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">2FA</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleStaff.map((user) => (
                    <TableRow key={user.id} className={user.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="max-w-72 py-2.5">
                        <PersonCell user={user} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {user.scaleupRole ? SCALEUP_ROLE_LABELS[user.scaleupRole] : null}
                      </TableCell>
                      <TableCell>
                        <AccountStatusCell user={user} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <MfaCell enrolled={user.mfaEnrolled} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <LastSignInCell at={user.lastSignInAt} hasSignedIn={user.hasSignedIn} />
                      </TableCell>
                      <TableCell className="text-right">
                        <UserActionsMenu user={user} onOpen={openDialog} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="company" className="mt-2">
          {companyUsers.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No company users yet"
              description="Invite each company's owner with “Invite company user”. Owners can then invite their own contributors."
            />
          ) : visibleCompanyUsers.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No company users match"
              description={
                companyFilter === ALL_COMPANIES
                  ? "Try another name or email."
                  : "No one matches this company and search. Invite someone with “Invite company user”."
              }
            />
          ) : (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Person</TableHead>
                    <TableHead>Companies</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">2FA</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCompanyUsers.map((user) => (
                    <TableRow key={user.id} className={user.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="max-w-72 py-2.5">
                        <PersonCell user={user} />
                      </TableCell>
                      <TableCell className="min-w-48">
                        <MembershipList memberships={user.memberships} />
                      </TableCell>
                      <TableCell>
                        <AccountStatusCell user={user} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <MfaCell enrolled={user.mfaEnrolled} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <LastSignInCell at={user.lastSignInAt} hasSignedIn={user.hasSignedIn} />
                      </TableCell>
                      <TableCell className="text-right">
                        <UserActionsMenu user={user} onOpen={openDialog} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-2">
          {linksUnavailable ? (
            <Alert className="border-warning/30 bg-warning/5">
              <InfoIcon className="text-warning" aria-hidden="true" />
              <AlertDescription className="text-foreground">
                Pending links can&apos;t be loaded right now. Please try again in a minute.
              </AlertDescription>
            </Alert>
          ) : links.length === 0 ? (
            <EmptyState
              icon={MailIcon}
              title="No pending invitations"
              description="Invitation and sign-in links that haven't been used yet appear here until they expire."
            />
          ) : visibleLinks.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No pending links match your search" />
          ) : (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead>Person</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead className="hidden md:table-cell">Access</TableHead>
                    <TableHead className="hidden lg:table-cell">Issued by</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-24">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLinks.map((link) => (
                    <TableRow key={link.id}>
                      <TableCell className="max-w-72 py-2.5">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{link.name}</span>
                          {link.name !== link.email ? (
                            <span className="truncate text-xs text-muted-foreground">{link.email}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={link.purpose === "invite" ? "info" : "neutral"}>
                          {ACCESS_LINK_PURPOSE_LABELS[link.purpose]}
                        </ToneBadge>
                      </TableCell>
                      <TableCell className="hidden max-w-64 truncate md:table-cell">{link.access}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-col">
                          <span>{link.issuedBy}</span>
                          <span className="text-xs whitespace-nowrap text-muted-foreground">
                            {formatDateTime(link.createdAt)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(link.expiresAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => openDialog({ kind: "revoke", linkId: link.id })}
                          aria-label={`Revoke the ${ACCESS_LINK_PURPOSE_LABELS[link.purpose].toLowerCase()} for ${link.name}`}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EditScaleUpUserDialog user={dialog?.kind === "edit" ? dialogUser : null} onClose={() => setDialog(null)} />
      <CompanyAccessDialog
        user={dialog?.kind === "companies" ? dialogUser : null}
        onClose={() => setDialog(null)}
        onAddToCompany={(user) => setDialog({ kind: "add-company", userId: user.id })}
      />
      <InviteCompanyUserDialog
        open={dialog?.kind === "add-company" && dialogUser !== null}
        onOpenChange={(open) => (open ? undefined : setDialog(null))}
        companies={activeCompanies.filter(
          (company) => !dialogUser?.memberships.some((m) => m.companyId === company.id && m.isActive),
        )}
        defaults={dialogUser ? { email: dialogUser.email, fullName: dialogUser.fullName ?? "" } : undefined}
        onInvited={(result) => {
          setDialog(null);
          setOutcome(result);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        destructive={confirm?.destructive ?? false}
        onConfirm={async () => {
          if (confirm) await confirm.run();
        }}
      />
      <AccessLinkDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </div>
  );
}

function Count({ value }: { value: number }) {
  return <span className="ml-1 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{value}</span>;
}

/** The "…" menu of a person's row. */
function UserActionsMenu({ user, onOpen }: { user: DirectoryUser; onOpen: (dialog: DirectoryDialog) => void }) {
  const name = displayName(user.fullName, user.email);
  const isStaff = user.scaleupRole !== null;
  const linkPurpose: AccessLinkPurpose = user.hasSignedIn ? "signin" : "invite";
  const canIssueLink = user.isActive && !user.isSelf;
  const canResetMfa = !user.isSelf && user.hasSignedIn && user.mfaEnrolled !== false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isStaff ? (
          <DropdownMenuItem onSelect={() => onOpen({ kind: "edit", userId: user.id })}>
            <PencilIcon />
            Edit details and role
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onOpen({ kind: "companies", userId: user.id })}>
              <Building2Icon />
              Manage company access
            </DropdownMenuItem>
            {user.isActive ? (
              <DropdownMenuItem onSelect={() => onOpen({ kind: "add-company", userId: user.id })}>
                <PlusIcon />
                Add to a company
              </DropdownMenuItem>
            ) : null}
          </>
        )}
        {canIssueLink ? (
          <DropdownMenuItem onSelect={() => onOpen({ kind: "link", userId: user.id, purpose: linkPurpose })}>
            <LinkIcon />
            {linkPurpose === "invite" ? "New invitation link" : "Send sign-in link"}
          </DropdownMenuItem>
        ) : null}
        {canResetMfa ? (
          <DropdownMenuItem onSelect={() => onOpen({ kind: "reset-mfa", userId: user.id })}>
            <ShieldOffIcon />
            Reset two-factor authentication
          </DropdownMenuItem>
        ) : null}
        {user.isSelf ? null : (
          <>
            <DropdownMenuSeparator />
            {user.isActive ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onOpen({ kind: "active", userId: user.id, active: false })}
              >
                <UserXIcon />
                Deactivate account
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onOpen({ kind: "active", userId: user.id, active: true })}>
                <UserCheckIcon />
                Reactivate account
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Wording and server call of the confirmation for a dialog state (null for non-confirm dialogs). */
function confirmSpec(
  dialog: ConfirmRequest,
  user: DirectoryUser | null,
  links: readonly DirectoryLink[],
  showOutcome: (outcome: InviteOutcome) => void,
): ConfirmSpec | null {
  if (dialog.kind === "revoke") {
    const link = links.find((candidate) => candidate.id === dialog.linkId);
    if (!link) return null;
    const label = ACCESS_LINK_PURPOSE_LABELS[link.purpose].toLowerCase();
    return {
      title: `Revoke this ${label}?`,
      description: `The ${label} for ${link.name} (${link.email}) stops working immediately. You can create a new one at any time.`,
      confirmLabel: "Revoke link",
      destructive: true,
      run: async () => {
        const result = await revokeAccessLinkAction({ linkId: link.id });
        if (!result.ok) throw new Error(result.error);
        toast.success("Link revoked");
      },
    };
  }
  if (!user) return null;
  const name = displayName(user.fullName, user.email);

  switch (dialog.kind) {
    case "link":
      return {
        title:
          dialog.purpose === "invite" ? `Create a new invitation link for ${name}?` : `Create a sign-in link for ${name}?`,
        description:
          dialog.purpose === "invite"
            ? `Any earlier invitation link for ${name} stops working. The new link works once, for ${ACCESS_LINK_VALIDITY_LABELS.invite}.`
            : `Use this when ${name} can't sign in, for example after forgetting their password. The link works once, for ${ACCESS_LINK_VALIDITY_LABELS.signin}: they confirm with their authenticator app and choose a new password. Any earlier sign-in link stops working.`,
        confirmLabel: "Create link",
        destructive: false,
        run: async () => {
          const result = await issueUserLinkAction({ userId: user.id, purpose: dialog.purpose });
          if (!result.ok) throw new Error(result.error);
          showOutcome(result.data);
        },
      };
    case "reset-mfa":
      return {
        title: `Reset two-factor authentication for ${name}?`,
        description: `Their authenticator app is removed and they're signed out everywhere. They set up a new one the next time they sign in. Only do this after confirming it's really them, for example on a call.`,
        confirmLabel: "Reset 2FA",
        destructive: true,
        run: async () => {
          const result = await resetUserMfaAction({ userId: user.id });
          if (!result.ok) throw new Error(result.error);
          toast.success(`Two-factor authentication reset for ${name}`, {
            description:
              result.data.removed === 0
                ? "They had no authenticator set up."
                : "They'll set up a new authenticator the next time they sign in.",
          });
        },
      };
    case "active":
      return dialog.active
        ? {
            title: `Reactivate ${name}?`,
            description: `${name} can sign in again with their existing password. If they've forgotten it, send them a sign-in link afterwards.`,
            confirmLabel: "Reactivate",
            destructive: false,
            run: async () => {
              const result = await setUserActiveAction({ userId: user.id, active: true });
              if (!result.ok) throw new Error(result.error);
              toast.success(`${name} has been reactivated`);
            },
          }
        : {
            title: `Deactivate ${name}?`,
            description: `${name} can no longer sign in, and any pending links stop working. Nothing is deleted: their work and the audit trail are kept (${describeAccess(user)}), and you can reactivate them later.`,
            confirmLabel: "Deactivate",
            destructive: true,
            run: async () => {
              const result = await setUserActiveAction({ userId: user.id, active: false });
              if (!result.ok) throw new Error(result.error);
              toast.success(`${name} has been deactivated`);
            },
          };
  }
}
