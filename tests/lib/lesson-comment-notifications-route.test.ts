import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The daily route on the in-memory repositories, with auth, Slack and the heartbeat faked.
const requireApiPermission = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireApiPermission: (r: unknown) => requireApiPermission(r) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const heartbeat = vi.fn();
vi.mock("@/lib/cron-heartbeats", () => ({
  withCronHeartbeat: async (job: string, res: Response) => {
    heartbeat(job);
    return res;
  },
}));
vi.mock("@/lib/slack", () => ({ sendSlackDM: vi.fn(async () => {}) }));
vi.mock("@/lib/slack-member-ids", () => ({ resolveSlackUserIds: async () => new Map() }));

let dataset: InMemoryDataset;
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const { GET } = await import("@/app/api/internal/lesson-comment-notifications/route");

const NOW = Date.parse("2027-03-02T15:00:00Z");
const COURSE = "crs_AAAAAAAAAAA1";
const LESSON = "les_AAAAAAAAAAA1";
const ASKER = "mbr_AAAAAAAAAAA1";
const FOLLOWER = "mbr_AAAAAAAAAAA2";
const STAFF = "mbr_AAAAAAAAAAA3";
const request = () => new NextRequest("http://localhost/api/internal/lesson-comment-notifications");
const flag = (enabled: boolean) => ({ feature_key: "lesson_comment_notifications", enabled_globally: enabled, created_at: "2027-01-01T00:00:00Z", updated_at: "2027-01-01T00:00:00Z" });

function setup(enabled: boolean) {
  dataset = new InMemoryDataset({
    members: [ASKER, FOLLOWER, STAFF].map((id) => ({ id, name: `Member ${id}`, firstJoinedAt: "2024-01-01", userId: `u-${id}` })),
    userProfiles: [{ id: `u-${STAFF}`, email: "staff@example.test", role: "admin" }],
    featureFlags: [flag(enabled)],
    courses: [{ id: COURSE, slug: "story-basics", title: "Story Basics" } as never],
    courseLessons: [{ id: LESSON, course_id: COURSE, title: "Scene one" } as never],
    courseAccess: [ASKER, FOLLOWER].map((member_id) => ({ member_id, course_id: COURSE, starts_at: "2027-01-01T00:00:00Z", ends_at: null, origin: "purchase" })),
  });
  repos = createInMemoryRepos(dataset);
}

async function addNews() {
  await repos.courseComments.setFollowing(FOLLOWER, LESSON, true);
  await repos.courseComments.create({ lessonId: LESSON, memberId: ASKER, parentId: null, body: "A question", isStaffReply: false });
  await repos.courseComments.create({ lessonId: LESSON, memberId: ASKER, parentId: null, body: "Held", isStaffReply: false, held: true });
  vi.setSystemTime(NOW + 60_000);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  heartbeat.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireApiPermission.mockResolvedValue({ user: { id: "cron" }, forbidden: false });
  setup(true);
});

afterEach(() => vi.useRealTimers());

describe("GET /api/internal/lesson-comment-notifications", () => {
  it("refuses a visitor who is signed out, and one who is not an admin", async () => {
    requireApiPermission.mockResolvedValueOnce({ user: null });
    expect((await GET(request())).status).toBe(401);
    requireApiPermission.mockResolvedValueOnce({ user: { id: "u" }, forbidden: true });
    expect((await GET(request())).status).toBe(403);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("sends the members' digest and the staff note, once, and pings its heartbeat", async () => {
    await addNews();

    const body = await (await GET(request())).json();

    expect(body).toEqual({ members: { sent: 1, dryRun: 0 }, staff: { sent: 1, dryRun: 0 } });
    expect(heartbeat).toHaveBeenCalledWith("lesson-comment-notifications");
    expect(dataset.inAppNotifications.map((n) => n.memberId).sort()).toEqual([FOLLOWER, STAFF]);

    const again = await (await GET(request())).json();
    expect(again).toEqual({ members: { sent: 0, dryRun: 0 }, staff: { sent: 0, dryRun: 0 } });
  });

  it("only logs while the flag is off: nothing sent or recorded", async () => {
    setup(false);
    await addNews();

    const body = await (await GET(request())).json();

    expect(body).toEqual({ members: { sent: 0, dryRun: 1 }, staff: { sent: 0, dryRun: 1 } });
    expect(dataset.inAppNotifications).toEqual([]);
    expect(dataset.notificationLog).toEqual([]);
  });

  it("answers 500 without a heartbeat when one half fails, and still runs the other", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await addNews();
    vi.spyOn(repos.courseComments, "moderationBacklog").mockRejectedValue(new Error("db down"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ members: { sent: 1, dryRun: 0 }, staff: { error: "failed" } });
    expect(heartbeat).not.toHaveBeenCalled();
  });
});
