"use client";

import { EllipsisIcon, LinkIcon, UserCheckIcon, UserXIcon, XCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { issueContributorLinkAction, revokeTeamLinkAction, setContributorActiveAction } from "../actions";
import type { TeamMember } from "./team-model";
import { AccessLinkDialog } from "@/app/access/_components/access-link-dialog";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ToneBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCESS_LINK_VALIDITY_LABELS } from "@/lib/auth-admin/purpose";
import { ACCESS_LINK_PURPOSE_LABELS } from "@/lib/auth-admin/status";
import type { InviteOutcome } from "@/lib/auth-admin/types";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";

type ConfirmSpec = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<void>;
};

/**
 * The company's team. Owners of an active company (`canManage`) get a menu on each contributor's row:
 * a new invitation link for someone who has not joined yet (BRD B29: people who have joined sign in as
 * usual, and ScaleUp sends sign-in links, B23), revoke a pending link they (or a co-owner) sent,
 * deactivate / reactivate. With no contributor place left (`reactivateBlockedReason`, BRD B29)
 * "Reactivate" is disabled and explained.
 */
export function TeamTable({
  companyId,
  companyName,
  members,
  canManage,
  reactivateBlockedReason = null,
}: {
  companyId: string;
  companyName: string;
  members: TeamMember[];
  canManage: boolean;
  reactivateBlockedReason?: string | null;
}) {
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);

  function askToInvite(member: TeamMember) {
    setConfirm({
      title: `Create a new invitation link for ${member.name}?`,
      description: `Any earlier invitation link for ${member.name} stops working. The new link works once, for ${ACCESS_LINK_VALIDITY_LABELS.invite}.`,
      confirmLabel: "Create link",
      destructive: false,
      run: async () => {
        const result = await issueContributorLinkAction({ companyId, userId: member.userId });
        if (!result.ok) throw new Error(result.error);
        setOutcome(result.data);
      },
    });
  }

  function askToRevoke(member: TeamMember) {
    const link = member.pendingLink;
    if (!link) return;
    const label = ACCESS_LINK_PURPOSE_LABELS[link.purpose].toLowerCase();
    setConfirm({
      title: `Revoke ${member.name}'s ${label}?`,
      description: member.hasJoined
        ? "The link stops working immediately."
        : `The link stops working immediately. You can send ${member.name} a new invitation at any time.`,
      confirmLabel: "Revoke link",
      destructive: true,
      run: async () => {
        const result = await revokeTeamLinkAction({ companyId, linkId: link.id });
        if (!result.ok) throw new Error(result.error);
        toast.success("Link revoked");
      },
    });
  }

  function askToSetActive(member: TeamMember, active: boolean) {
    setConfirm(
      active
        ? {
            title: `Reactivate ${member.name}?`,
            description: `${member.name} will see ${companyName} again the next time they sign in.`,
            confirmLabel: "Reactivate",
            destructive: false,
            run: async () => {
              const result = await setContributorActiveAction({ companyId, userId: member.userId, active: true });
              if (!result.ok) throw new Error(result.error);
              toast.success(`${member.name} has been reactivated`);
            },
          }
        : {
            title: `Deactivate ${member.name}?`,
            description: `${member.name} will no longer see or enter anything for ${companyName}, and pending links that you or a co-owner sent them stop working. Their earlier entries stay in the history, and you can reactivate them later.`,
            confirmLabel: "Deactivate",
            destructive: true,
            run: async () => {
              const result = await setContributorActiveAction({ companyId, userId: member.userId, active: false });
              if (!result.ok) throw new Error(result.error);
              toast.success(`${member.name} has been deactivated`);
            },
          },
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? (
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.userId} className={member.membershipActive ? undefined : "text-muted-foreground"}>
                <TableCell className="max-w-72 py-2.5">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="truncate">{member.name}</span>
                      {member.isSelf ? <ToneBadge tone="neutral">You</ToneBadge> : null}
                    </span>
                    {member.email && member.email !== member.name ? (
                      <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                    ) : null}
                    {member.jobTitle ? (
                      <span className="truncate text-xs text-muted-foreground">{member.jobTitle}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">{COMPANY_ROLE_LABELS[member.role]}</TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <ToneBadge tone={member.status.tone} title={member.status.description}>
                      {member.status.label}
                    </ToneBadge>
                    {member.pendingLink && member.membershipActive ? (
                      <span className="text-xs text-muted-foreground">
                        {ACCESS_LINK_PURPOSE_LABELS[member.pendingLink.purpose]} from {member.pendingLink.sentBy},
                        expires {formatDate(member.pendingLink.expiresAt)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    {member.manageable ? (
                      <MemberMenu
                        member={member}
                        reactivateBlockedReason={reactivateBlockedReason}
                        onInvite={askToInvite}
                        onRevoke={askToRevoke}
                        onSetActive={askToSetActive}
                      />
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

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
    </>
  );
}

function MemberMenu({
  member,
  reactivateBlockedReason,
  onInvite,
  onRevoke,
  onSetActive,
}: {
  member: TeamMember;
  reactivateBlockedReason: string | null;
  onInvite: (member: TeamMember) => void;
  onRevoke: (member: TeamMember) => void;
  onSetActive: (member: TeamMember, active: boolean) => void;
}) {
  const reasonId = useId();
  // Owners only invite people who have not joined yet (BRD B29). Whoever holds a link can sign in as
  // the person, so someone who has joined signs in as usual, or asks ScaleUp for a sign-in link (B23).
  const canInvite = member.membershipActive && member.accountActive && !member.hasJoined;
  const revocableLink = member.pendingLink?.revocable ? member.pendingLink : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate">{member.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canInvite ? (
          <DropdownMenuItem onSelect={() => onInvite(member)}>
            <LinkIcon />
            New invitation link
          </DropdownMenuItem>
        ) : null}
        {revocableLink ? (
          <DropdownMenuItem onSelect={() => onRevoke(member)}>
            <XCircleIcon />
            Revoke {ACCESS_LINK_PURPOSE_LABELS[revocableLink.purpose].toLowerCase()}
          </DropdownMenuItem>
        ) : null}
        {canInvite || revocableLink ? <DropdownMenuSeparator /> : null}
        {member.membershipActive ? (
          <DropdownMenuItem variant="destructive" onSelect={() => onSetActive(member, false)}>
            <UserXIcon />
            Deactivate
          </DropdownMenuItem>
        ) : reactivateBlockedReason ? (
          <>
            <DropdownMenuItem disabled aria-describedby={reasonId}>
              <UserCheckIcon />
              Reactivate
            </DropdownMenuItem>
            <DropdownMenuLabel id={reasonId} className="font-normal text-pretty">
              {reactivateBlockedReason}
            </DropdownMenuLabel>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => onSetActive(member, true)}>
            <UserCheckIcon />
            Reactivate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
