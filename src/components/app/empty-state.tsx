import * as React from "react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type IconLike = React.ReactNode | React.ElementType;

/**
 * Empty state for lists and pages. `icon` may be an element (`<InboxIcon />`) or a
 * component (`InboxIcon`); `action` is usually a Button or Link.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconLike;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed bg-card", className)}>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{renderIcon(icon)}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

function renderIcon(icon: IconLike): React.ReactNode {
  if (React.isValidElement(icon)) return icon;
  // Components: plain functions or forwardRef/memo objects (lucide icons are forwardRef).
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in icon)) {
    return React.createElement(icon as React.ElementType);
  }
  return icon as React.ReactNode;
}
