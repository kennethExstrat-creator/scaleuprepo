import Image from "next/image";

import { cn } from "@/lib/utils";

import scaleupLogo from "../../../public/brand/scaleup-logo.png";

/**
 * ScaleUp Malaysia logo (transparent PNG, 368×205). Size it by height, e.g.
 * `<Logo className="h-8" />`; pass `priority` above the fold (login screen).
 */
export function Logo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src={scaleupLogo}
      alt="ScaleUp Malaysia"
      className={cn("h-8 w-auto select-none", className)}
      sizes="160px"
      loading={priority ? "eager" : undefined}
      fetchPriority={priority ? "high" : undefined}
      draggable={false}
    />
  );
}
