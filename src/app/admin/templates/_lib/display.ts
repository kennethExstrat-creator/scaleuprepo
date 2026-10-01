// Small display helpers of the template pages (client-safe).

/**
 * The name shown for whoever created or published a version: their full name (or email) from
 * `people`; "System" when there is no person (seed data, scheduled jobs); "A former user" when the
 * profile cannot be found.
 */
export function personName(people: Readonly<Record<string, string>>, id: string | null | undefined): string {
  if (!id) return "System";
  return people[id] ?? "A former user";
}

/** "1 field", "3 fields". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
