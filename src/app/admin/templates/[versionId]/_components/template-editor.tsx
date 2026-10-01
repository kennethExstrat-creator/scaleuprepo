"use client";

import { ChevronDownIcon, ChevronUpIcon, LockIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteFieldAction, deleteSectionAction, moveFieldAction, moveSectionAction } from "../../actions";
import { plural } from "../../_lib/display";
import {
  SYSTEM_FIELD_TOOLTIP,
  SYSTEM_SECTION_TOOLTIP,
  fieldSettingsSummary,
  isSystemSectionKind,
  sectionAcceptsFields,
  type LockedField,
} from "../../_lib/rules";
import { FieldDialog, type FieldDialogMode } from "./field-dialog";
import { SectionDialog, type SectionDialogMode } from "./section-dialog";
import { useRetained } from "./use-retained";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ToneBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIELD_TYPE_LABELS, SECTION_KIND_LABELS } from "@/lib/constants";
import type { TemplateFieldRow, TemplateSectionFull, TemplateVersionFull } from "@/lib/types/domain";

type Direction = "up" | "down";

type DeleteTarget =
  | { type: "section"; section: TemplateSectionFull }
  | { type: "field"; section: TemplateSectionFull; field: TemplateFieldRow };

/** What the editor needs of the version compared with (for a draft, the published version it replaces). */
export type BaseOutline = {
  /** Its sections' keys and titles (a narrative or founder-pulse title names the section's C4 row). */
  sections: { key: string; title: string }[];
  /** Its fields' keys. */
  fields: string[];
};

export type TemplateEditorProps = {
  version: TemplateVersionFull;
  /** Draft and the viewer manages templates: show the editing controls. */
  editable: boolean;
  /** Fields of earlier published or archived versions, by key (their key and type are fixed). */
  lockedFields: Record<string, LockedField>;
  /** The version compared with ("New" markers, the C4 note when renaming); null when there is none. */
  base: BaseOutline | null;
};

/**
 * The structure of a template version: sections in form order with their fields. For a draft it is
 * the editor (add, rename, describe, reorder and delete sections; add, edit, reorder and delete fields);
 * otherwise a read-only outline. Every change is saved at once and the page refreshes with it.
 */
export function TemplateEditor({ version, editable, lockedFields, base }: TemplateEditorProps) {
  const [sectionDialog, setSectionDialog] = useState<SectionDialogMode | null>(null);
  const [fieldDialog, setFieldDialog] = useState<FieldDialogMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const shownDelete = useRetained(deleteTarget);
  const [moving, startMoving] = useTransition();

  const versionKeys = useMemo(
    () => version.sections.flatMap((section) => section.fields.map((field) => field.key)),
    [version.sections],
  );
  const baseSectionTitles = useMemo(
    () => (base ? new Map(base.sections.map((section) => [section.key, section.title])) : null),
    [base],
  );
  const baseFieldKeys = useMemo(() => (base ? new Set(base.fields) : null), [base]);
  const fieldCount = versionKeys.length;

  function move(kind: "section" | "field", id: string, direction: Direction) {
    if (moving) return;
    startMoving(async () => {
      const result = kind === "section" ? await moveSectionAction({ id, direction }) : await moveFieldAction({ id, direction });
      if (!result.ok) toast.error(result.error);
    });
  }

  function openAddSection() {
    setSectionDialog({
      type: "add",
      versionId: version.id,
      sections: version.sections.map((section) => ({ id: section.id, title: section.title, kind: section.kind })),
    });
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    const result =
      target.type === "section"
        ? await deleteSectionAction({ sectionId: target.section.id })
        : await deleteFieldAction({ fieldId: target.field.id });
    if (!result.ok) throw new Error(result.error);
    toast.success(
      target.type === "section" ? `Section “${target.section.title}” deleted` : `Field “${target.field.label}” deleted`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-heading text-base font-semibold">Structure</h2>
          <p className="text-sm text-muted-foreground">
            {plural(version.sections.length, "section")} · {plural(fieldCount, "field")}
          </p>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" role="status">
            {moving ? (
              <>
                <Spinner className="size-3.5" aria-hidden="true" />
                Saving the new order…
              </>
            ) : null}
          </span>
        </div>
        {editable ? (
          <Button variant="outline" size="sm" onClick={openAddSection}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add section
          </Button>
        ) : null}
      </div>

      {version.sections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          index={index}
          count={version.sections.length}
          editable={editable}
          busy={moving}
          isNew={baseSectionTitles !== null && !baseSectionTitles.has(section.key)}
          isNewField={(field) => baseFieldKeys !== null && !baseFieldKeys.has(field.key)}
          onMove={(direction) => move("section", section.id, direction)}
          onEdit={() =>
            setSectionDialog({ type: "edit", section, publishedTitle: baseSectionTitles?.get(section.key) ?? null })
          }
          onDelete={() => setDeleteTarget({ type: "section", section })}
          onAddField={() => setFieldDialog({ section, field: null })}
          onEditField={(field) => setFieldDialog({ section, field })}
          onDeleteField={(field) => setDeleteTarget({ type: "field", section, field })}
          onMoveField={(field, direction) => move("field", field.id, direction)}
        />
      ))}

      {editable ? (
        <Button variant="outline" className="border-dashed" onClick={openAddSection}>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add section
        </Button>
      ) : null}

      <SectionDialog mode={sectionDialog} onOpenChange={(open) => !open && setSectionDialog(null)} />
      <FieldDialog
        mode={fieldDialog}
        onOpenChange={(open) => !open && setFieldDialog(null)}
        versionKeys={versionKeys}
        lockedFields={lockedFields}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        destructive
        title={
          shownDelete?.type === "section"
            ? `Delete the “${shownDelete.section.title}” section?`
            : shownDelete
              ? `Delete the “${shownDelete.field.label}” field?`
              : "Delete?"
        }
        description={
          shownDelete?.type === "section"
            ? shownDelete.section.fields.length === 0
              ? "The empty section is removed from this draft."
              : `The section and its ${plural(shownDelete.section.fields.length, "field")} are removed from this draft. Months already opened keep their own version, so no answers are lost.`
            : shownDelete
              ? Object.hasOwn(lockedFields, shownDelete.field.key)
                ? "Months already opened keep their answers. Months opened after you publish will no longer ask this question."
                : "The field is removed from this draft."
              : undefined
        }
        confirmLabel={shownDelete?.type === "section" ? "Delete section" : "Delete field"}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function SectionCard({
  section,
  index,
  count,
  editable,
  busy,
  isNew,
  isNewField,
  onMove,
  onEdit,
  onDelete,
  onAddField,
  onEditField,
  onDeleteField,
  onMoveField,
}: {
  section: TemplateSectionFull;
  index: number;
  count: number;
  editable: boolean;
  busy: boolean;
  isNew: boolean;
  isNewField: (field: TemplateFieldRow) => boolean;
  onMove: (direction: Direction) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddField: () => void;
  onEditField: (field: TemplateFieldRow) => void;
  onDeleteField: (field: TemplateFieldRow) => void;
  onMoveField: (field: TemplateFieldRow, direction: Direction) => void;
}) {
  const system = isSystemSectionKind(section.kind);
  const acceptsFields = sectionAcceptsFields(section.kind);
  const titleId = `structure-section-${section.id}`;

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-start gap-2 border-b bg-muted/30 px-3 py-2.5">
        {editable ? (
          <MoveButtons label={`section “${section.title}”`} index={index} count={count} busy={busy} onMove={onMove} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={titleId} className="font-medium">
              {section.title}
            </h3>
            {system ? <LockHint label={SYSTEM_SECTION_TOOLTIP} /> : null}
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {SECTION_KIND_LABELS[section.kind]}
            </Badge>
            {isNew ? <ToneBadge tone="info">New</ToneBadge> : null}
          </div>
          {section.description ? <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p> : null}
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit the “${section.title}” section`}>
              <PencilIcon aria-hidden="true" />
            </Button>
            {system ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label={`Delete the “${section.title}” section`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {section.kind === "kpis" ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Shows each company&apos;s own KPIs, as set up for the company. This section has no template fields.
        </p>
      ) : section.fields.length > 0 ? (
        <ul className="divide-y">
          {section.fields.map((field, fieldIndex) => (
            <FieldRow
              key={field.id}
              field={field}
              index={fieldIndex}
              count={section.fields.length}
              editable={editable}
              busy={busy}
              isNew={!isNew && isNewField(field)}
              onMove={(direction) => onMoveField(field, direction)}
              onEdit={() => onEditField(field)}
              onDelete={() => onDeleteField(field)}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">No fields yet.</p>
      )}

      {editable && acceptsFields ? (
        <div className="border-t px-2 py-1.5">
          <Button variant="ghost" size="sm" onClick={onAddField}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            Add field
            <span className="sr-only"> to “{section.title}”</span>
          </Button>
        </div>
      ) : null}
      {editable && (section.kind === "financials" || section.kind === "headcount") ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Built-in figures only. To ask for other figures, add an additional numbers section.
        </p>
      ) : null}
    </section>
  );
}

function FieldRow({
  field,
  index,
  count,
  editable,
  busy,
  isNew,
  onMove,
  onEdit,
  onDelete,
}: {
  field: TemplateFieldRow;
  index: number;
  count: number;
  editable: boolean;
  busy: boolean;
  isNew: boolean;
  onMove: (direction: Direction) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const required = field.is_required || field.is_system;
  const notes = fieldSettingsSummary(field);

  return (
    <li className="flex items-start gap-2 px-3 py-2.5">
      {editable ? <MoveButtons label={`“${field.label}”`} index={index} count={count} busy={busy} onMove={onMove} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{field.label}</span>
          {field.is_system ? <LockHint label={SYSTEM_FIELD_TOOLTIP} /> : null}
          <code className="rounded bg-muted px-1 py-px font-mono text-xs text-muted-foreground">{field.key}</code>
          {isNew ? <ToneBadge tone="info">New</ToneBadge> : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <Badge variant="secondary" className="font-normal">
            {FIELD_TYPE_LABELS[field.field_type]}
          </Badge>
          {required ? (
            <Badge variant="outline" className="font-normal">
              Required
            </Badge>
          ) : (
            <span className="text-muted-foreground">Optional</span>
          )}
          {notes.map((note) => (
            <span key={note} className="text-muted-foreground">
              · {note}
            </span>
          ))}
        </div>
        {field.help_text ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{field.help_text}</p> : null}
      </div>
      {editable ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit “${field.label}”`}>
            <PencilIcon aria-hidden="true" />
          </Button>
          {field.is_system ? null : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              aria-label={`Delete “${field.label}”`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Up / down buttons. At the ends (or while a move is saving) they are marked aria-disabled rather
 * than disabled, so keyboard focus stays on the button while the list reorders.
 */
function MoveButtons({
  label,
  index,
  count,
  busy,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  busy: boolean;
  onMove: (direction: Direction) => void;
}) {
  if (count < 2) return <span className="w-6 shrink-0" aria-hidden="true" />;
  const atTop = index === 0;
  const atBottom = index === count - 1;
  const button = (direction: Direction, blocked: boolean) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Move ${label} ${direction}`}
      aria-disabled={blocked || busy || undefined}
      className="text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-35"
      onClick={() => {
        if (!blocked && !busy) onMove(direction);
      }}
    >
      {direction === "up" ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
    </Button>
  );
  return (
    <div className="-my-0.5 flex shrink-0 flex-col">
      {button("up", atTop)}
      {button("down", atBottom)}
    </div>
  );
}

/** Lock icon with a tooltip, reachable by keyboard. */
function LockHint({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex cursor-help rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <LockIcon className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
