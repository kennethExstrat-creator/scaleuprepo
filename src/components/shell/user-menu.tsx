"use client";

import { ChevronsUpDownIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type UserMenuProps = {
  name: string | null;
  email: string;
  /** e.g. "Fund Admin" or "Company Owner". */
  roleLabel: string;
};

/** Header account menu: name, email, role label, "Change password" and "Sign out" (POST /auth/signout). */
export function UserMenu({ name, email, roleLabel }: UserMenuProps) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const displayName = name?.trim() || email;

  return (
    <>
      <form ref={signOutForm} action="/auth/signout" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2" aria-label="Account menu">
            <Avatar size="sm">
              <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-44 flex-col items-start leading-tight sm:flex">
              <span className="w-full truncate text-sm font-medium">{displayName}</span>
              <span className="w-full truncate text-xs font-normal text-muted-foreground">{roleLabel}</span>
            </span>
            <ChevronsUpDownIcon className="hidden text-muted-foreground sm:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5 font-normal">
            <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
            <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/set-password">
              <KeyRoundIcon />
              Change password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => signOutForm.current?.requestSubmit()}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function initials(value: string): string {
  const words = value.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
