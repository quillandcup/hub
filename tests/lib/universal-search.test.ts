import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getTestSupabaseAdminClient } from "../helpers/supabase";
import { parseUniversal } from "@/lib/search/syntax";
import { universalSearch, type SearchContext } from "@/lib/search/universal";

/**
 * The per-kind queries against the real local schema (the embeds and `or()` filters are only
 * checked by PostgREST). Seeds fictional rows that share a unique token, so every search is
 * scoped to this test's data in the shared DB, and removes exactly what it made.
 */
describe("universalSearch (local database)", () => {
  const supabase = getTestSupabaseAdminClient();
  const token = `unisearch${Date.now()}`;
  const hiddenWord = `hiddenretreat${Date.now()}`;
  const made = { members: [] as string[], books: [] as string[], awards: [] as string[], events: [] as string[], prickles: [] as string[], types: [] as string[] };
  let hostId = "";
  let otherId = "";

  const ctx = (over: Partial<SearchContext> = {}): SearchContext => ({
    supabase,
    viewerMemberId: null,
    isActingAsAdmin: false,
    chatChannels: [],
    limit: 10,
    ...over,
  });
  const run = (input: string, over: Partial<SearchContext> = {}) =>
    universalSearch(ctx(over), parseUniversal(input), { skip: ["chat", "channels"] });
  /** Rows from a seeding insert, or the database's own error. */
  const seeded = <T,>(res: { data: T[] | null; error: { message: string } | null }): T[] => {
    if (res.error || !res.data) throw new Error(res.error?.message ?? "insert returned nothing");
    return res.data;
  };
  const hitsOf = (results: Awaited<ReturnType<typeof run>>, kind: string) => results.find((r) => r.kind === kind)?.hits ?? [];

  beforeAll(async () => {
    const { data: members, error } = await supabase
      .from("members")
      .insert([
        { name: `${token} Hostess`, email: `${token}-host@example.com`, joined_at: "2020-01-01", status: "active" },
        { name: `${token} Bystander`, email: `${token}-other@example.com`, joined_at: "2020-01-01", status: "cancelled" },
      ])
      .select("id, name");
    if (error) throw error;
    hostId = members!.find((m) => m.name.endsWith("Hostess"))!.id;
    otherId = members!.find((m) => m.name.endsWith("Bystander"))!.id;
    made.members.push(hostId, otherId);

    const books = seeded(
      await supabase
        .from("member_books")
        .insert({ member_id: hostId, title: `${token} Chronicles`, description: "dragons", cover_url: "https://example.com/cover.png", purchase_url: "https://example.com/buy", published_date: "2026-03-05" })
        .select("id")
    );
    made.books.push(...books.map((b) => b.id));
    // A book and an award their owner deleted: the rows stay, and search never finds them.
    const deletedAt = new Date().toISOString();
    const deletedBooks = seeded(
      await supabase
        .from("member_books")
        .insert({ member_id: hostId, title: `${token} Retired Chronicles`, description: "dragons", cover_url: "https://example.com/cover.png", purchase_url: "https://example.com/buy", published_date: "2026-03-06", deleted_at: deletedAt })
        .select("id")
    );
    made.books.push(...deletedBooks.map((b) => b.id));

    const awards = seeded(
      await supabase
        .from("member_awards")
        .insert({ member_id: hostId, award_name: `${token} Prize`, work_title: "A Poem", category: "Poetry", award_date: "2026-04-01" })
        .select("id")
    );
    made.awards.push(...awards.map((a) => a.id));
    const deletedAwards = seeded(
      await supabase
        .from("member_awards")
        .insert({ member_id: hostId, award_name: `${token} Retired Prize`, work_title: "A Poem", category: "Poetry", award_date: "2026-04-02", deleted_at: deletedAt })
        .select("id")
    );
    made.awards.push(...deletedAwards.map((a) => a.id));

    const events = seeded(
      await supabase
        .from("events")
        .insert({ slug: `${token}-retreat`, title: `${token} Retreat`, event_type: "other", location: "Lakeside", starts_at: "2026-05-01", ends_at: "2026-05-03" })
        .select("id")
    );
    made.events.push(...events.map((e) => e.id));
    // An event an admin hid: members never find it, admins still do.
    const hidden = seeded(
      await supabase
        .from("events")
        .insert({ slug: `${hiddenWord}-retreat`, title: `${hiddenWord} Retreat`, event_type: "other", starts_at: "2020-05-01", ends_at: "2020-05-03", deleted_at: new Date().toISOString() })
        .select("id")
    );
    made.events.push(...hidden.map((e) => e.id));
    // Rows go away with the event and member (ON DELETE CASCADE).
    seeded(await supabase.from("event_attendees").insert({ event_id: events[0].id, member_id: otherId }).select("id"));

    const [type] = seeded(
      await supabase.from("prickle_types").insert({ name: `${token} Sprint`, normalized_name: `${token} sprint`, description: "test" }).select("id")
    );
    made.types.push(type.id);
    const prickles = seeded(
      await supabase
        .from("prickles")
        .insert({ type_id: type.id, host: hostId, start_time: "2099-01-05T10:00:00Z", end_time: "2099-01-05T11:00:00Z", source: "calendar" })
        .select("id")
    );
    made.prickles.push(...prickles.map((p) => p.id));
    const [webinarType] = seeded(
      await supabase.from("prickle_types").insert({ name: `${token} Webinar`, normalized_name: `${token} webinar`, description: "test" }).select("id")
    );
    made.types.push(webinarType.id);
    const titled = seeded(
      await supabase
        .from("prickles")
        .insert({ type_id: webinarType.id, title: `Tiny Things Practice Workshop ${token}`, start_time: "2099-01-06T10:00:00Z", end_time: "2099-01-06T11:00:00Z", source: "calendar" })
        .select("id")
    );
    made.prickles.push(...titled.map((p) => p.id));
  });

  afterAll(async () => {
    await supabase.from("prickles").delete().in("id", made.prickles);
    await supabase.from("prickle_types").delete().in("id", made.types);
    await supabase.from("events").delete().in("id", made.events);
    await supabase.from("member_awards").delete().in("id", made.awards);
    await supabase.from("member_books").delete().in("id", made.books);
    await supabase.from("members").delete().in("id", made.members);
  });

  it("finds members by name in the directory, without their email or status", async () => {
    const hits = hitsOf(await run(`in:members ${token}`), "members");
    expect(hits.map((h) => h.title).sort()).toEqual([`${token} Bystander`, `${token} Hostess`]);
    expect(hits[0]).toMatchObject({ href: expect.stringMatching(/^\/members\//) });
    expect(hits.every((h) => !h.badge && !h.subtitle?.includes("@"))).toBe(true);
  });

  it("lets an admin searching as themselves use email: and status:", async () => {
    const byEmail = hitsOf(await run(`in:members email:${token}-host`, { isActingAsAdmin: true }), "members");
    expect(byEmail.map((h) => h.id)).toEqual([hostId]);
    expect(byEmail[0]).toMatchObject({ subtitle: `${token}-host@example.com`, badge: "active", href: `/admin/members/${hostId}` });

    const byStatus = hitsOf(await run(`in:members ${token} status:cancelled`, { isActingAsAdmin: true }), "members");
    expect(byStatus.map((h) => h.id)).toEqual([otherId]);
  });

  it("finds a member by display name, legal name, email or nickname, showing the display name and only saying why when it isn't in it", async () => {
    // Its own token: the shared one would add a third member to the paging test below.
    const own = `dispname${Date.now()}`;
    const { data, error } = await supabase
      .from("members")
      .insert({ name: `${own} Legalname`, display_name: `Penny${own}`, email: `${own}-penny@example.com`, joined_at: "2020-01-01", status: "active" })
      .select("id")
      .single();
    if (error) throw error;
    made.members.push(data.id);

    const asAdmin = async (input: string) => hitsOf(await run(input, { isActingAsAdmin: true }), "members");
    const asMember = async (input: string) => hitsOf(await run(input), "members");

    // The display name explains itself: just the name.
    const byDisplay = await asAdmin(`in:members Penny${own}`);
    expect(byDisplay).toHaveLength(1);
    expect(byDisplay[0]).toMatchObject({ id: data.id, title: `Penny${own}`, badge: "active", href: `/admin/members/${data.id}` });
    expect(byDisplay[0].subtitle).toBeUndefined();

    // The legal name, or the email, is the reason: that is what shows.
    expect((await asAdmin(`in:members ${own} legalname`))[0]).toMatchObject({ id: data.id, title: `Penny${own}`, subtitle: `${own} Legalname` });
    expect((await asAdmin(`in:members ${own}-penny`))[0]).toMatchObject({ id: data.id, subtitle: `${own}-penny@example.com` });

    // Members see the same name, never the email.
    const byDisplayMember = await asMember(`in:members Penny${own}`);
    expect(byDisplayMember.map((h) => h.title)).toEqual([`Penny${own}`]);
    expect(byDisplayMember[0].subtitle).toBeUndefined();
    expect((await asMember(`in:members ${own} legalname`))[0]).toMatchObject({ id: data.id, subtitle: `${own} Legalname` });

    // A nickname finds them for staff and members alike; the hint says which one.
    const { error: aliasError } = await supabase.from("member_name_aliases").insert([
      { member_id: data.id, alias: `Nick${own}`, source: "zoom", active: true },
      { member_id: data.id, alias: `Retired${own}`, source: "zoom", active: false },
    ]);
    if (aliasError) throw aliasError;
    const hint = `also known as “Nick${own}”`;
    expect((await asAdmin(`in:members nick${own}`))[0]).toMatchObject({ id: data.id, title: `Penny${own}`, subtitle: hint });
    expect((await asMember(`in:members nick${own}`))[0]).toMatchObject({ id: data.id, title: `Penny${own}`, subtitle: hint });
    expect(await asAdmin(`in:members retired${own}`)).toEqual([]);
    expect(await asMember(`in:members retired${own}`)).toEqual([]);
  });

  it("finds a prickle by its type's name or its host's name, titled like the detail page", async () => {
    for (const input of [`in:prickles ${token} sprint`, `in:prickles ${token} hostess`]) {
      const hits = hitsOf(await run(input), "prickles");
      expect(hits).toHaveLength(1);
      expect(hits[0].title).toContain(`${token} Sprint`);
      expect(hits[0].href).toBe(`/prickles/${hits[0].id}`);
    }
  });

  it("finds a prickle by its own title and shows that title", async () => {
    const hits = hitsOf(await run(`in:prickles tiny workshop ${token}`), "prickles");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe(`Tiny Things Practice Workshop ${token}`);
  });

  it("filters prickles by host (from:) and by date", async () => {
    expect(hitsOf(await run(`in:prickles from:${token} after:2098-12-31`), "prickles")).toHaveLength(1);
    expect(hitsOf(await run(`in:prickles ${token} before:2099-01-01`), "prickles")).toHaveLength(0);
    expect(hitsOf(await run(`in:prickles from:nobodyhasthisname${token}`), "prickles")).toHaveLength(0);
  });

  it("finds books with their author, and narrows by author and date", async () => {
    const hits = hitsOf(await run(`in:books ${token} chronicles`), "books");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: `${token} Chronicles`, subtitle: `${token} Hostess`, date: "2026-03-05" });
    expect(hitsOf(await run(`in:books chronicles from:bystander`), "books")).toHaveLength(0);
    expect(hitsOf(await run(`in:books ${token} before:2026-01-01`), "books")).toHaveLength(0);
  });

  it("never finds a book or award its owner deleted", async () => {
    const books = hitsOf(await run(`in:books ${token} chronicles`), "books");
    expect(books.map((b) => b.title)).toEqual([`${token} Chronicles`]);
    const awards = hitsOf(await run(`in:awards ${token} prize`), "awards");
    expect(awards.map((a) => a.title)).toEqual([`${token} Prize`]);
  });

  it("finds awards and events", async () => {
    expect(hitsOf(await run(`in:awards ${token} poetry`), "awards")[0]).toMatchObject({ title: `${token} Prize`, subtitle: "A Poem · Poetry" });
    const event = hitsOf(await run(`in:events lakeside ${token}`), "events")[0];
    expect(event).toMatchObject({ title: `${token} Retreat`, href: `/events/${token}-retreat` });
    expect(hitsOf(await run(`in:events ${token}`, { isActingAsAdmin: true }), "events")[0].href).toMatch(/^\/admin\/events\//);
  });

  it("leaves a hidden event out for members and keeps it for admins", async () => {
    expect(hitsOf(await run(`in:events ${hiddenWord}`), "events")).toHaveLength(0);
    expect(hitsOf(await run(`in:events ${hiddenWord}`, { isActingAsAdmin: true }), "events").map((e) => e.title)).toEqual([`${hiddenWord} Retreat`]);
  });

  it("filters events by who attended (from:)", async () => {
    expect(hitsOf(await run(`in:events ${token} from:bystander`), "events")).toHaveLength(1);
    expect(hitsOf(await run(`in:events ${token} from:hostess`), "events")).toHaveLength(0);
    expect(hitsOf(await run(`in:events from:nobodyhasthisname${token}`), "events")).toHaveLength(0);
  });

  it("searches every kind when none is named, and only chat for chat-only filters", async () => {
    const kinds = (await run(token)).map((r) => r.kind).sort();
    expect(kinds).toEqual(["awards", "books", "events", "members", "prickles"]);
    expect(await run("has:link")).toEqual([]);
  });

  it("finds channels by name, joined first, without group messages", async () => {
    const channel = (id: string, label: string, over: Record<string, unknown> = {}) => ({
      id, kind: "channel", label, visibility: "public", restricted: false, archived: false, joined: false, slackChannelId: null, ...over,
    });
    const chatChannels = [
      channel("c1", "#general"),
      channel("c2", "#general-chat", { joined: true }),
      channel("c3", "#old-general", { archived: true }),
      channel("c4", "#writing-sprints", { visibility: "private", joined: true }),
      channel("c5", "Fern, Gale", { kind: "group_dm", joined: true }),
    ] as unknown as SearchContext["chatChannels"];
    const hits = hitsOf(await universalSearch(ctx({ chatChannels }), parseUniversal("in:channels GENERAL"), {}), "channels");
    expect(hits.map((h) => h.title)).toEqual(["#general-chat", "#general", "#old-general"]);
    expect(hits.map((h) => h.badge)).toEqual(["joined", undefined, "archived"]);
    expect(hits.map((h) => h.muted)).toEqual([false, false, true]);
    expect(hits[0]).toMatchObject({ href: "/chat/c2", subtitle: "Public channel" });
    expect(hitsOf(await universalSearch(ctx({ chatChannels }), parseUniversal("in:channels sprints"), {}), "channels")[0].subtitle).toBe("Private channel");
    expect(hitsOf(await universalSearch(ctx({ chatChannels }), parseUniversal("fern"), { skip: ["chat"] }), "channels")).toEqual([]);
    expect(hitsOf(await universalSearch(ctx({ chatChannels }), parseUniversal("in:channels general from:fern"), {}), "channels")).toEqual([]);
  });

  it("only looks up chat channels when chat is searched", async () => {
    const chatChannels = vi.fn().mockResolvedValue([]);
    await universalSearch(ctx({ chatChannels }), parseUniversal(`in:members ${token}`), {});
    await universalSearch(ctx({ chatChannels }), parseUniversal(token), { skip: ["chat", "channels"] });
    expect(chatChannels).not.toHaveBeenCalled();
    await universalSearch(ctx({ chatChannels, viewerMemberId: hostId }), parseUniversal(`in:chat ${token}`), {});
    expect(chatChannels).toHaveBeenCalledTimes(1);
  });

  it("reports an empty list for an unknown kind or no criteria", async () => {
    expect(await run("in:nonsense " + token)).toEqual([]);
    expect(await run("   ")).toEqual([]);
  });

  it("pages with offset and says when there is more", async () => {
    const first = (await run(`in:members ${token}`, { limit: 1 })).find((r) => r.kind === "members")!;
    expect(first.hits).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = (await run(`in:members ${token}`, { limit: 1, offset: 1 })).find((r) => r.kind === "members")!;
    expect(second.hits).toHaveLength(1);
    expect(second.hits[0].id).not.toBe(first.hits[0].id);
    expect(second.hasMore).toBe(false);
  });
});
