import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Lookups that read members through their repository (in memory here): the email channel's
// addresses, Slack DM links, and badge recipients.

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { emailChannel } from "@/lib/channels/email";
import { getBadgeRecipients, type BadgeType } from "@/lib/badges";
import { getSlackDmLinksForMembers } from "@/lib/member-slack-links";

const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test", firstJoinedAt: "2024-01-05" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test", firstJoinedAt: "2025-06-01" };
const GALE = { id: "mbr_AAAAAAAAAAA3", name: "Gale Example", email: "gale@example.test" };

beforeEach(() => {
  repos = createInMemoryRepos(new InMemoryDataset({ members: [ADA, FERN, GALE] }));
});

describe("email channel addresses", () => {
  it("resolves each member's email, leaving out members that don't exist", async () => {
    const found = await emailChannel.resolveAddresses({} as never, [ADA.id, GALE.id, "mbr_ZZZZZZZZZZZZ"]);

    expect(found).toEqual(new Map([[ADA.id, ADA.email], [GALE.id, GALE.email]]));
  });

  it("logs and returns nothing when the members read fails, rather than failing the send run", async () => {
    vi.spyOn(repos.members, "byIds").mockRejectedValue(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await emailChannel.resolveAddresses({} as never, [ADA.id])).toEqual(new Map());
    expect(log).toHaveBeenCalledWith("[email] Loading member addresses failed", expect.any(Error));
  });
});

describe("Slack DM links", () => {
  it("links by confirmed Slack alias first, then by email match in the Slack directory", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA, FERN, GALE],
        slackUsers: [
          { user_id: "U_FERN", email: FERN.email },
          { user_id: "U_ADA_EMAIL", email: ADA.email },
        ],
        nameAliases: [
          { id: "nal_1", member_id: ADA.id, alias: "U_ADA_ALIAS", source: "slack", active: true },
          { id: "nal_2", member_id: FERN.id, alias: "U_FERN_OLD", source: "slack", active: false },
          { id: "nal_3", member_id: GALE.id, alias: "Gale E", source: "zoom", active: true },
        ],
      })
    );

    const links = await getSlackDmLinksForMembers([ADA.id, FERN.id, GALE.id]);

    expect(links.get(ADA.id)).toBe("https://quillandcup.slack.com/app_redirect?channel=U_ADA_ALIAS");
    expect(links.get(FERN.id)).toBe("https://quillandcup.slack.com/app_redirect?channel=U_FERN");
    expect(links.has(GALE.id)).toBe(false);
  });

  it("asks for nothing when there are no members", async () => {
    expect(await getSlackDmLinksForMembers([])).toEqual(new Map());
  });
});

describe("badge recipients", () => {
  const badge: BadgeType = {
    id: "bdgt_AAAAAAAAAAA1",
    key: "kind_words",
    name: "Kind Words",
    description: null,
    icon: "💛",
    category: "community",
    has_levels: false,
    is_automatic: false,
    program_id: null,
  };

  it("lists the members who were awarded a manual badge, by name", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        members: [ADA, FERN, GALE],
        badgeTypes: [badge],
        memberBadges: [
          { id: "mbdg_AAAAAAAAAAA1", memberId: FERN.id, badgeTypeId: badge.id, occurredAt: "2026-09-01", note: "for the welcome", eventId: null, awardedBy: null },
          { id: "mbdg_AAAAAAAAAAA2", memberId: ADA.id, badgeTypeId: badge.id, occurredAt: "2026-09-02", note: null, eventId: null, awardedBy: null },
        ],
      }),
    );
    const recipients = await getBadgeRecipients(repos, badge, []);

    expect(recipients.map((r) => r.memberName)).toEqual(["Ada Example", "Fern Example"]);
    expect(recipients.find((r) => r.memberId === FERN.id)).toMatchObject({ memberEmail: FERN.email, note: "for the welcome" });
  });
});
