"use client";

import { EyeIcon, ListTreeIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type View = "structure" | "preview";

/**
 * Structure and live preview side by side on wide screens (the preview sticks below the header);
 * below that a switch shows one at a time, so the builder stays usable on a laptop or phone.
 */
export function EditorShell({ structure, preview }: { structure: ReactNode; preview: ReactNode }) {
  const [view, setView] = useState<View>("structure");

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(value) => {
          if (value === "structure" || value === "preview") setView(value);
        }}
        aria-label="Show the structure or the preview"
        className="xl:hidden"
      >
        <ToggleGroupItem value="structure">
          <ListTreeIcon aria-hidden="true" />
          Structure
        </ToggleGroupItem>
        <ToggleGroupItem value="preview">
          <EyeIcon aria-hidden="true" />
          Preview
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
        <div className={cn("min-w-0", view !== "structure" && "max-xl:hidden")}>{structure}</div>
        <div
          className={cn(
            "min-w-0 xl:sticky xl:top-18 xl:max-h-[calc(100svh-5.5rem)] xl:overflow-y-auto xl:rounded-xl",
            view !== "preview" && "max-xl:hidden",
          )}
        >
          {preview}
        </div>
      </div>
    </div>
  );
}
