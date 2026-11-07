// @vitest-environment jsdom
/**
 * The project page keys its client on the two values the client copies into state (phase, show on profile), because a
 * change no longer reloads the page: refreshing the server data in place must start the client again when the project
 * moved to another phase on the server (publishing a book does that), or it would keep showing the old one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ProjectDetailPage from "@/app/(member)/projects/[id]/page";
import ProjectDetailClient from "@/app/(member)/projects/[id]/ProjectDetailClient";
import { MEMBER_IDENTITY, MEMBER_USER, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import * as actions from "@/app/(member)/projects/actions";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/app/(member)/projects/actions", () => ({ getProject: vi.fn(), getArchivedGoals: vi.fn() }));
vi.mock("@/app/(member)/projects/[id]/ProjectDetailClient", () => ({ default: () => null }));
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
  return findElement(tree as ReactNode, ProjectDetailClient);
}

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
});

describe("project page", () => {
  it("starts the client again when the phase or the profile setting changed on the server", async () => {
    const drafting = await clientFor({ phase: "drafting", showOnProfile: false });
    const published = await clientFor({ phase: "published", showOnProfile: false });
    const shown = await clientFor({ phase: "drafting", showOnProfile: true });
    expect(drafting?.key).toBe("drafting:false");
    expect(new Set([drafting?.key, published?.key, shown?.key]).size).toBe(3);
  });

  it("keeps the same client while those two values are unchanged", async () => {
    const first = await clientFor({ phase: "drafting", showOnProfile: false, title: "Lantern" });
    const second = await clientFor({ phase: "drafting", showOnProfile: false, title: "Lantern, renamed" });
    expect(second?.key).toBe(first?.key);
  });
});
