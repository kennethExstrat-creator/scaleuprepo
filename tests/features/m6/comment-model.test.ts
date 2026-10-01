import { describe, expect, it } from "vitest";

import {
  authorInitials,
  buildCommentThreads,
  commentExcerpt,
  countThreadsByTarget,
  describeAuthor,
  groupThreadsByTarget,
  hiddenAuthorIds,
  normaliseCommentTarget,
  partitionThreads,
  sameTarget,
  summariseThreads,
  threadsForTarget,
  type CommentProfile,
  type CommentRowWithProfiles,
  type CommentViewer,
} from "@/components/comments/model";

import { IDS } from "./fixtures";

const SUB = IDS.sep;
const partner: CommentProfile = { id: IDS.partner, full_name: "Renuka Sena", email: "renuka@scaleup.test", scaleup_role: "partner" };
const fundAdmin: CommentProfile = { id: IDS.fundAdmin, full_name: null, email: "ops@scaleup.test", scaleup_role: "fund_admin" };
const owner: CommentProfile = { id: IDS.owner, full_name: "Aisha Rahman", email: "aisha@batik.test", scaleup_role: null };
const contributor: CommentProfile = { id: IDS.contributor, full_name: "  ", email: "finance@batik.test", scaleup_role: null };
const memberRoles = { [IDS.owner]: "owner", [IDS.contributor]: "contributor" } as const;

function row(
  id: string,
  opts: Partial<CommentRowWithProfiles> & { author: CommentProfile | null; author_id: string; created_at: string },
): CommentRowWithProfiles {
  return {
    id,
    submission_id: SUB,
    parent_id: null,
    target: "general",
    visibility: "shared",
    body: `Comment ${id}`,
    resolved_at: null,
    resolved_by: null,
    resolver: null,
    ...opts,
  };
}

const id = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A ScaleUp view of four threads: a shared GP question with replies (resolved by the owner), an internal
// note, a shared general question and a reply whose root is not visible.
const ROWS: CommentRowWithProfiles[] = [
  row(id(3), {
    target: "general",
    author: fundAdmin,
    author_id: IDS.fundAdmin,
    created_at: "2026-10-03T01:00:00.000000+00:00",
  }),
  row(id(1), {
    target: "field:gross_profit",
    author: partner,
    author_id: IDS.partner,
    created_at: "2026-10-01T01:00:00.000000+00:00",
    body: "Why did gross profit drop?",
    resolved_at: "2026-10-02T09:00:00.000000+00:00",
    resolved_by: IDS.owner,
    resolver: owner,
  }),
  row(id(11), {
    parent_id: id(1),
    target: "field:gross_profit",
    author: owner,
    author_id: IDS.owner,
    created_at: "2026-10-01T05:00:00.000000+00:00",
    body: "Seasonal discounting.",
  }),
  row(id(12), {
    parent_id: id(1),
    target: "field:gross_profit",
    author: contributor,
    author_id: IDS.contributor,
    created_at: "2026-10-01T03:00:00.000000+00:00",
    body: "Checking the numbers.",
  }),
  row(id(2), {
    target: `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`,
    visibility: "internal",
    author: partner,
    author_id: IDS.partner,
    created_at: "2026-10-02T01:00:00.000000+00:00",
    body: "Internal: The Row looks weak.",
  }),
  row(id(21), {
    parent_id: id(2),
    visibility: "internal",
    author: fundAdmin,
    author_id: IDS.fundAdmin,
    created_at: "2026-10-04T01:00:00.000000+00:00",
    body: "Agreed.",
  }),
  row(id(99), {
    parent_id: id(98),
    author: owner,
    author_id: IDS.owner,
    created_at: "2026-10-04T02:00:00.000000+00:00",
  }),
];

// What staff_display_names returns for the ScaleUp ids (BRD B28): "<full name> (ScaleUp)", or "ScaleUp"
// for someone without a name; nothing for company-side ids.
const STAFF_NAMES = { [IDS.partner]: "Renuka Sena (ScaleUp)", [IDS.fundAdmin]: "ScaleUp" };
const REMOVED_MEMBER = "a1000000-0000-4000-8000-000000000077";

const scaleUpViewer: CommentViewer = { userId: IDS.partner, audience: "scaleup", memberRoles, canReply: true, canResolve: true };
const companyViewer: CommentViewer = {
  userId: IDS.owner,
  audience: "company",
  memberRoles,
  staffNames: STAFF_NAMES,
  canReply: true,
  canResolve: true,
};

describe("describeAuthor", () => {
  it("shows ScaleUp staff by name and role to ScaleUp viewers", () => {
    expect(describeAuthor(partner, IDS.partner, scaleUpViewer)).toEqual({
      name: "Renuka Sena",
      roleLabel: "Partner",
      side: "scaleup",
      isViewer: true,
    });
    expect(describeAuthor(fundAdmin, IDS.fundAdmin, scaleUpViewer)).toMatchObject({ name: "ops@scaleup.test", roleLabel: "Fund Admin" });
  });

  it("shows ScaleUp staff to company users as '<name> (ScaleUp)', never with their email or role (BRD B28)", () => {
    // Company users cannot read ScaleUp profiles (null); a leaked one is still only named by staff_display_names.
    for (const profile of [null, partner]) {
      expect(describeAuthor(profile, IDS.partner, companyViewer)).toEqual({
        name: "Renuka Sena (ScaleUp)",
        roleLabel: null,
        side: "scaleup",
        isViewer: false,
      });
    }
    // Ids are matched case-insensitively (the RPC's map is keyed by lower-case id).
    expect(describeAuthor(null, IDS.partner.toUpperCase(), companyViewer).name).toBe("Renuka Sena (ScaleUp)");
    // A staff member without a name, and a leaked profile with no display name: "ScaleUp", never the email.
    expect(describeAuthor(null, IDS.fundAdmin, companyViewer)).toMatchObject({ name: "ScaleUp", roleLabel: null, side: "scaleup" });
    expect(describeAuthor(fundAdmin, IDS.fundAdmin, { ...companyViewer, staffNames: {} })).toMatchObject({
      name: "ScaleUp",
      roleLabel: null,
    });
    // Names not loaded at all: every hidden author reads "ScaleUp".
    expect(describeAuthor(null, IDS.partner, { ...companyViewer, staffNames: undefined })).toEqual({
      name: "ScaleUp",
      roleLabel: null,
      side: "scaleup",
      isViewer: false,
    });
  });

  it("shows a hidden author who is not ScaleUp staff to company users as a former team member", () => {
    expect(describeAuthor(null, REMOVED_MEMBER, companyViewer)).toEqual({
      name: "Former team member",
      roleLabel: null,
      side: "company",
      isViewer: false,
    });
  });

  it("shows company people by name with their company role to both audiences", () => {
    expect(describeAuthor(owner, IDS.owner, companyViewer)).toEqual({
      name: "Aisha Rahman",
      roleLabel: "Company Owner",
      side: "company",
      isViewer: true,
    });
    expect(describeAuthor(contributor, IDS.contributor, scaleUpViewer)).toEqual({
      name: "finance@batik.test",
      roleLabel: "Contributor",
      side: "company",
      isViewer: false,
    });
    expect(describeAuthor(owner, IDS.owner, { ...scaleUpViewer, memberRoles: {} })).toMatchObject({ roleLabel: "Company user" });
    expect(describeAuthor(null, "someone", scaleUpViewer)).toMatchObject({ name: "Unknown user", roleLabel: null });
  });
});

describe("buildCommentThreads", () => {
  it("groups replies under their roots, oldest first, and drops replies whose root is not visible", () => {
    const threads = buildCommentThreads(ROWS, scaleUpViewer);
    expect(threads.map((t) => t.id)).toEqual([id(1), id(2), id(3)]);
    const gp = threads[0];
    expect(gp.target).toBe("field:gross_profit");
    expect(gp.root.body).toBe("Why did gross profit drop?");
    expect(gp.replies.map((r) => r.id)).toEqual([id(12), id(11)]);
    expect(gp.lastActivityAt).toBe("2026-10-01T05:00:00.000000+00:00");
    expect(gp.resolved).toBe(true);
    expect(gp.resolvedBy).toMatchObject({ name: "Aisha Rahman", roleLabel: "Company Owner" });
    expect(threads[1]).toMatchObject({ visibility: "internal", resolved: false, resolvedBy: null, canReply: true, canResolve: true });
    expect(threads[1].replies[0].author).toMatchObject({ name: "ops@scaleup.test", side: "scaleup" });
  });

  it("never gives company users internal threads and names ScaleUp authors '<name> (ScaleUp)'", () => {
    // Row Level Security hides internal comments and ScaleUp profiles from company users; the builder
    // enforces the same even if a row slips through.
    const asCompany = ROWS.map((r) => (r.author?.scaleup_role ? { ...r, author: null } : r));
    const threads = buildCommentThreads(asCompany, companyViewer);
    expect(threads.map((t) => t.id)).toEqual([id(1), id(3)]);
    expect(threads.every((t) => t.visibility === "shared")).toBe(true);
    expect(threads[0].root.author).toEqual({ name: "Renuka Sena (ScaleUp)", roleLabel: null, side: "scaleup", isViewer: false });
    expect(threads[0].replies.map((r) => r.author.name)).toEqual(["finance@batik.test", "Aisha Rahman"]);
    expect(threads[0].replies[1].author.isViewer).toBe(true);
    expect(threads[0].resolvedBy).toMatchObject({ name: "Aisha Rahman", isViewer: true });
    expect(threads[1].root.author).toMatchObject({ name: "ScaleUp", side: "scaleup" });
    // No ScaleUp email, role or internal note reaches the company.
    const json = JSON.stringify(threads);
    for (const hidden of ["renuka@scaleup.test", "ops@scaleup.test", "Partner", "Fund Admin", "The Row looks weak"]) {
      expect(json).not.toContain(hidden);
    }
  });

  it("names ScaleUp resolvers for company users too", () => {
    const resolvedByPartner = ROWS.map((r) =>
      r.id === id(1) ? { ...r, author: null, resolved_by: IDS.partner, resolver: null } : r.author?.scaleup_role ? { ...r, author: null } : r,
    );
    const [gp] = buildCommentThreads(resolvedByPartner, companyViewer);
    expect(gp.resolvedBy).toEqual({ name: "Renuka Sena (ScaleUp)", roleLabel: null, side: "scaleup", isViewer: false });
  });

  it("limits reply and resolve to what the viewer may do", () => {
    const viewer: CommentViewer = { ...scaleUpViewer, canReply: false, canResolve: false };
    for (const thread of buildCommentThreads(ROWS, viewer)) {
      expect(thread).toMatchObject({ canReply: false, canResolve: false });
    }
    const readOnlyCompany: CommentViewer = { ...companyViewer, canReply: false, canResolve: false };
    expect(buildCommentThreads(ROWS, readOnlyCompany).every((t) => !t.canReply && !t.canResolve)).toBe(true);
    // A company viewer who may reply acts on shared threads (the only ones they get).
    expect(buildCommentThreads(ROWS, companyViewer).every((t) => t.canReply && t.canResolve)).toBe(true);
  });

  it("orders roots with the same timestamp by id and returns [] for no rows", () => {
    const same = "2026-10-01T01:00:00.000000+00:00";
    const threads = buildCommentThreads(
      [row(id(5), { author: partner, author_id: IDS.partner, created_at: same }), row(id(4), { author: partner, author_id: IDS.partner, created_at: same })],
      scaleUpViewer,
    );
    expect(threads.map((t) => t.id)).toEqual([id(4), id(5)]);
    expect(buildCommentThreads([], scaleUpViewer)).toEqual([]);
  });
});

describe("thread helpers", () => {
  const threads = buildCommentThreads(ROWS, scaleUpViewer);

  it("counts threads and unresolved threads per target", () => {
    expect(countThreadsByTarget(threads)).toEqual({
      "field:gross_profit": { total: 1, unresolved: 0 },
      [`kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`]: { total: 1, unresolved: 1 },
      general: { total: 1, unresolved: 1 },
    });
    expect(summariseThreads(threads)).toEqual({ total: 3, unresolved: 2 });
    expect(Object.keys(groupThreadsByTarget(threads))).toEqual([
      "field:gross_profit",
      `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.theRow}`,
      "general",
    ]);
  });

  it("puts open threads first and the most recently resolved first", () => {
    const resolvedLater = { ...threads[2], id: "later", resolved: true, resolvedAt: "2026-10-09T00:00:00Z" };
    const { open, resolved } = partitionThreads([...threads, resolvedLater]);
    expect(open.map((t) => t.id)).toEqual([id(2), id(3)]);
    expect(resolved.map((t) => t.id)).toEqual(["later", id(1)]);
  });

  it("matches targets the way the database stores them (ids lower-case)", () => {
    const upper = `KPI:${IDS.kpiRevenuePerOutlet.toUpperCase()}:${IDS.theRow.toUpperCase()}`;
    expect(threadsForTarget(threads, upper).map((t) => t.id)).toEqual([id(2)]);
    expect(sameTarget("general", " general ")).toBe(true);
    expect(sameTarget("field:gross_profit", "field:net_profit")).toBe(false);
  });
});

describe("normaliseCommentTarget", () => {
  it("accepts the §2.5 target formats and lower-cases ids like the comments trigger", () => {
    expect(normaliseCommentTarget(undefined)).toBe("general");
    expect(normaliseCommentTarget("   ")).toBe("general");
    expect(normaliseCommentTarget("general")).toBe("general");
    expect(normaliseCommentTarget(" field:gross_profit ")).toBe("field:gross_profit");
    expect(normaliseCommentTarget(`SEGMENT:${IDS.segOnline.toUpperCase()}`)).toBe(`segment:${IDS.segOnline}`);
    expect(normaliseCommentTarget(`kpi:${IDS.kpiDownloads}`)).toBe(`kpi:${IDS.kpiDownloads}`);
    expect(normaliseCommentTarget(`kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara.toUpperCase()}`)).toBe(
      `kpi:${IDS.kpiRevenuePerOutlet}:${IDS.montKiara}`,
    );
  });

  it("refuses what the database would refuse", () => {
    for (const bad of ["General", "field:", "field:Gross_Profit", "field:1abc", "segment:not-a-uuid", "kpi:x:y", "other:thing", `kpi:${IDS.kpiDownloads}:${IDS.theRow}:${IDS.montKiara}`]) {
      expect(normaliseCommentTarget(bad)).toBeNull();
    }
  });
});

describe("hiddenAuthorIds", () => {
  it("lists the shared comments' authors and resolvers a company user cannot name from profiles", () => {
    // As a company user reads them: ScaleUp profiles are null (RLS), the internal thread is not there.
    const asCompany = ROWS.filter((r) => r.visibility === "shared").map((r) =>
      r.author?.scaleup_role ? { ...r, author: null } : r,
    );
    expect(hiddenAuthorIds(asCompany)).toEqual([IDS.fundAdmin, IDS.partner]);
    const resolvedByStaff = asCompany.map((r) => (r.id === id(1) ? { ...r, resolved_by: IDS.fundAdmin, resolver: null } : r));
    expect(hiddenAuthorIds(resolvedByStaff)).toEqual([IDS.fundAdmin, IDS.partner]);
    // Readable company-side profiles need no lookup; a leaked ScaleUp profile still does.
    expect(hiddenAuthorIds(ROWS.filter((r) => r.author_id === IDS.owner))).toEqual([]);
    expect(hiddenAuthorIds([ROWS[1]])).toEqual([IDS.partner]);
    // Internal threads never reach company users, so their authors are never asked for.
    expect(hiddenAuthorIds(ROWS.filter((r) => r.visibility === "internal"))).toEqual([]);
  });
});

describe("authorInitials", () => {
  it("uses the person's name without the (ScaleUp) label", () => {
    expect(authorInitials("Renuka Sena (ScaleUp)")).toBe("RS");
    expect(authorInitials("Aisha binti Rahman")).toBe("AR");
    expect(authorInitials("finance@batik.test")).toBe("FI");
    expect(authorInitials("ScaleUp")).toBe("SU");
    expect(authorInitials("Former team member")).toBe("FM");
    expect(authorInitials("Mei")).toBe("ME");
    expect(authorInitials("  ")).toBe("?");
  });
});

describe("commentExcerpt", () => {
  it("collapses whitespace and shortens long bodies", () => {
    expect(commentExcerpt("  Why did\n\ngross profit   drop? ")).toBe("Why did gross profit drop?");
    const long = "word ".repeat(50);
    const excerpt = commentExcerpt(long, 20);
    expect(excerpt.length).toBeLessThanOrEqual(20);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});
