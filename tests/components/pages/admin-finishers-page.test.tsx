// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import FinishersPage from "@/app/(admin)/admin/finishers/page";

const page = vi.fn();
vi.mock("@/lib/admin-auth", () => ({ requirePermission: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/data/repos", () => ({
  createRepos: () => ({
    milestones: { counts: async () => ({ proposed: 0, confirmed: 0, declined: 0 }), page },
    members: { list: async () => [] },
  }),
}));
const clientProps = vi.fn();
vi.mock("@/app/(admin)/admin/finishers/FinishersClient", () => ({
  default: (props: unknown) => {
    clientProps(props);
    return null;
  },
}));

const milestone = (i: number) => ({ id: `mlst_${i}` });

describe("admin finishers page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads every row past the 1000-row limit for the filter", async () => {
    page.mockImplementation(async ({ limit, offset }: { limit: number; offset: number }) =>
      Array.from({ length: Math.max(0, Math.min(limit, 1500 - offset)) }, (_, i) => milestone(offset + i)),
    );
    const element = await FinishersPage({ searchParams: Promise.resolve({ status: "proposed" }) });
    expect(page).toHaveBeenCalledTimes(2);
    expect(page.mock.calls[0][0]).toMatchObject({ status: "proposed", limit: 1000, offset: 0 });
    expect(element.props.rows).toHaveLength(1500);
    expect(element.props.status).toBe("proposed");
  });

  it("ignores an unknown status", async () => {
    page.mockResolvedValue([]);
    const element = await FinishersPage({ searchParams: Promise.resolve({ status: "nonsense" }) });
    expect(element.props.status).toBeNull();
  });
});
