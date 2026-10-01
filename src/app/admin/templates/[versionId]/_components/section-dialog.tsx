"use client";

import { useState } from "react";
import { toast } from "sonner";

import { addSectionAction, updateSectionAction } from "../../actions";
import {
  ADDABLE_SECTION_KINDS,
  MAX_SECTION_DESCRIPTION_LENGTH,
  MAX_SECTION_TITLE_LENGTH,
  SECTION_KIND_HELP,
  c4TitleHint,
  defaultPlacement,
  isSystemSectionKind,
  type AddableSectionKind,
} from "../../_lib/rules";
import { EditorDialog } from "./editor-dialog";
import { useRetained } from "./use-retained";
import { FormError } from "@/components/app/form-error";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { SECTION_KIND_LABELS } from "@/lib/constants";
import type { TemplateSectionFull } from "@/lib/types/domain";
import type { SectionKind } from "@/lib/types/enums";

export type SectionDialogMode =
  | { type: "add"; versionId: string; sections: { id: string; title: string; kind: SectionKind }[] }
  | {
      type: "edit";
      section: TemplateSectionFull;
      /**
       * Its title in the published version, which months already opened report under in the C4 export;
       * null when the section is new in this draft.
       */
      publishedTitle: string | null;
    };

const POSITION_END = "__end__";
const POSITION_START = "__start__";

/** Add a section (title, kind, position, description) or rename / re-describe one. */
export function SectionDialog({
  mode,
  onOpenChange,
}: {
  /** null = closed. */
  mode: SectionDialogMode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const shown = useRetained(mode);

  const title =
    shown?.type === "edit" ? `Edit “${shown.section.title}”` : "Add a section";
  const description =
    shown?.type === "edit"
      ? isSystemSectionKind(shown.section.kind)
        ? "This is a system section: you can rename it and change its description."
        : "Rename the section or change its description."
      : "Sections group the questions of the monthly update. Add fields to it once it is created.";

  return (
    <EditorDialog open={mode !== null} onOpenChange={onOpenChange} pending={pending} title={title} description={description}>
      {shown ? (
        <SectionForm
          key={shown.type === "edit" ? shown.section.id : "new"}
          mode={shown}
          pending={pending}
          setPending={setPending}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </EditorDialog>
  );
}

/** The form inside the dialog (exported for the server-render tests; dialogs render into portals). */
export function SectionForm({
  mode,
  pending,
  setPending,
  onDone,
}: {
  mode: SectionDialogMode;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const editing = mode.type === "edit" ? mode.section : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [kind, setKind] = useState<AddableSectionKind>("narrative");
  // Until the admin picks a position, it follows the kind (see defaultPlacement).
  const [chosenPosition, setChosenPosition] = useState<string | null>(null);
  const position =
    chosenPosition ?? (mode.type === "add" ? (defaultPlacement(kind, mode.sections) ?? POSITION_END) : POSITION_END);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Narrative and founder-pulse titles name C4 rows: say so before a rename splits one.
  const titleHint = mode.type === "edit" ? c4TitleHint(mode.section.kind, mode.publishedTitle) : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (title.trim() === "") {
      setErrors({ title: "Enter a title." });
      setFormError(null);
      document.getElementById("section-title")?.focus();
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const result =
        mode.type === "add"
          ? await addSectionAction({
              versionId: mode.versionId,
              title,
              description,
              kind,
              afterSectionId: position === POSITION_END ? undefined : position === POSITION_START ? null : position,
            })
          : await updateSectionAction({ sectionId: mode.section.id, title, description });
      if (!result.ok) {
        const fieldErrors = result.fieldErrors ?? {};
        // Problems with inputs this form does not show (e.g. an id) are spelled out instead.
        const unshown = Object.entries(fieldErrors)
          .filter(([key]) => !["title", "kind", "description"].includes(key))
          .map(([, message]) => message);
        setErrors(fieldErrors);
        setFormError(unshown.length > 0 ? unshown.join(" ") : result.error);
        return;
      }
      toast.success(mode.type === "add" ? `Section “${title.trim()}” added` : "Section saved");
      onDone();
    } finally {
      setPending(false);
    }
  }

  const invalid = (name: string) => (errors[name] ? true : undefined);
  const describedBy = (name: string, hint?: string) =>
    [errors[name] ? `section-${name}-error` : null, hint ?? null].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Field data-invalid={invalid("title")}>
          <FieldLabel htmlFor="section-title">Title</FieldLabel>
          <Input
            id="section-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={MAX_SECTION_TITLE_LENGTH}
            required
            autoFocus
            disabled={pending}
            aria-invalid={invalid("title")}
            aria-describedby={describedBy("title", titleHint ? "section-title-hint" : undefined)}
          />
          {titleHint ? <FieldDescription id="section-title-hint">{titleHint}</FieldDescription> : null}
          {errors.title ? <FieldError id="section-title-error">{errors.title}</FieldError> : null}
        </Field>

        {mode.type === "add" ? (
          <>
            <Field data-invalid={invalid("kind")}>
              <FieldLabel htmlFor="section-kind">Kind</FieldLabel>
              <Select
                value={kind}
                onValueChange={(value) => {
                  const next = ADDABLE_SECTION_KINDS.find((item) => item === value);
                  if (next) setKind(next);
                }}
                disabled={pending}
              >
                <SelectTrigger id="section-kind" className="w-full" aria-describedby={describedBy("kind", "section-kind-hint")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADDABLE_SECTION_KINDS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {SECTION_KIND_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id="section-kind-hint">{SECTION_KIND_HELP[kind]}</FieldDescription>
              {errors.kind ? <FieldError id="section-kind-error">{errors.kind}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="section-position">Position</FieldLabel>
              <Select value={position} onValueChange={setChosenPosition} disabled={pending}>
                <SelectTrigger id="section-position" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={POSITION_END}>At the end</SelectItem>
                  <SelectItem value={POSITION_START}>At the top</SelectItem>
                  {mode.sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      After “{section.title}”
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Kind: <span className="font-medium text-foreground">{SECTION_KIND_LABELS[mode.section.kind]}</span>
            <span className="mx-1.5" aria-hidden="true">
              ·
            </span>
            Key: <code className="font-mono text-xs">{mode.section.key}</code>
          </p>
        )}

        <Field data-invalid={invalid("description")}>
          <FieldLabel htmlFor="section-description">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Textarea
            id="section-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={MAX_SECTION_DESCRIPTION_LENGTH}
            rows={3}
            disabled={pending}
            placeholder="Shown under the section title in the form."
            aria-invalid={invalid("description")}
            aria-describedby={describedBy("description")}
          />
          {errors.description ? <FieldError id="section-description-error">{errors.description}</FieldError> : null}
        </Field>
      </FieldGroup>

      <FormError message={formError} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {mode.type === "add" ? "Add section" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
