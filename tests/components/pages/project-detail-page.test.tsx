// @vitest-environment jsdom
/**
 * The project page keys its view on the two values the client copies into state (phase, show on profile), because a
 * change no longer reloads the page: refreshing the server data in place must start the client again when the project
 * moved to another phase on the server (publishing a book does that), or it would keep showing the old one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ProjectDetailPage from "@/app/(member)/projects/[id]/page";
import ProjectDetailView from "@/app/(member)/projects/[id]/ProjectDetailView";
import { ProjectMilestonesSection } from "@/components/writing/Milestones";
import { MEMBER_IDENTITY, MEMBER_USER, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import * as actions from "@/app/(member)/projects/actions";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/app/(member)/projects/actions", () => ({ getProject: vi.fn(), getArchivedGoals: vi.fn() }));
vi.mock("@/app/(member)/projects/[id]/ProjectDetailView", () => ({ default: () => null }));
const milestoneContext = vi.hoisted(() => ({
  value: { milestones: [] as unknown[], books: [] as unknown[], firstJoinedAt: null as string | null, web: { available: false, on: false } },
}));
vi.mock("@/app/(member)/projects/milestoneData", () => ({ loadMilestoneContext: vi.fn(async () => milestoneContext.value) }));
vi.mock("@/components/ReturnToTab", () => ({ ReturnToTabLink: () => null }));

/** The first element of this type in the tree a server component returned (not rendered: keys only exist there). */
function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

async function clientFor(project: Record<string, unknown>) {
  vi.mocked(actions.getProject).mockResolvedValue({ project: { id: "wpr_AAAAAAAAAAA1", title: "Lantern", ...project }, entries: [] } as never);
  vi.mocked(actions.getArchivedGoals).mockResolvedValue([]);
  const tree = await ProjectDetailPage({ params: Promise.resolve({ id: "wpr_AAAAAAAAAAA1" }) });
  const view = findElement(tree as ReactNode, ProjectDetailView);
  // The view keys the page below it on this value; the milestone dialog above that key survives a status change.
  return { key: (view?.props as { viewKey?: string } | undefined)?.viewKey };
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
});

describe("project page", () => {
  it("starts the client again when the phase or who can see it changed on the server", async () => {
    const drafting = await clientFor({ phase: "drafting", visibility: "private" });
    const published = await clientFor({ phase: "published", visibility: "private" });
    const shown = await clientFor({ phase: "drafting", visibility: "community" });
    const open = await clientFor({ phase: "drafting", visibility: "public" });
    expect(drafting.key).toBe("drafting:private");
    expect(new Set([drafting.key, published.key, shown.key, open.key]).size).toBe(4);
  });

  it("keeps the same client while those two values are unchanged", async () => {
    const first = await clientFor({ phase: "drafting", visibility: "private", title: "Lantern" });
    const second = await clientFor({ phase: "drafting", visibility: "private", title: "Lantern, renamed" });
    expect(second.key).toBe(first.key);
  });

  it("puts the project's own milestones under the page, with the book's Published, and nobody else's", async () => {
    milestoneContext.value = {
      milestones: [
        { id: "mlst_1", kind: "the_end", projectId: "wpr_AAAAAAAAAAA1", bookId: null, title: null, status: "confirmed" },
        { id: "mlst_2", kind: "the_end", projectId: "wpr_OTHER", bookId: null, title: null, status: "confirmed" },
      ],
      books: [{ id: "book_1", title: "Lantern, the book", projectId: "wpr_AAAAAAAAAAA1", publishedDate: "2026-01-01" }],
      firstJoinedAt: null,
      web: { available: true, on: false },
    };
    try {
      vi.mocked(actions.getProject).mockResolvedValue({ project: { id: "wpr_AAAAAAAAAAA1", title: "Lantern", phase: "drafting", visibility: "private" }, entries: [] } as never);
      vi.mocked(actions.getArchivedGoals).mockResolvedValue([]);
      const tree = await ProjectDetailPage({ params: Promise.resolve({ id: "wpr_AAAAAAAAAAA1" }) });
      const section = findElement(tree as ReactNode, ProjectMilestonesSection)?.props as { work: { projectId: string; published: boolean; milestones: Record<string, { id: string }> }; readOnly: boolean; web: { available: boolean } };
      expect(section.work.projectId).toBe("wpr_AAAAAAAAAAA1");
      expect(section.work.published).toBe(true);
      expect(Object.values(section.work.milestones).map((m) => m.id)).toEqual(["mlst_1"]);
      expect(section.readOnly).toBe(false);
      expect(section.web.available).toBe(true);
    } finally {
      milestoneContext.value = { milestones: [], books: [], firstJoinedAt: null, web: { available: false, on: false } };
    }
  });
});
