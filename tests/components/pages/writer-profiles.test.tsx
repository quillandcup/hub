// @vitest-environment jsdom
/**
 * A writer profile (/w/<handle>), its preview, the sitemap and robots.txt (docs/product/WRITER_PROFILES.md). The repository is
 * the in-memory twin; markup, metadata, redirects and the 404 are real. What matters here: a page that is off and a handle
 * nobody has are the same 404, a given-up handle redirects, the preview is member-only and never indexed, and nothing
 * but the chosen fields reaches the markup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { expectPermanentRedirect, expectRedirect, getCurrentUser, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { APP_URL, SITE_URL, WRITER_PROFILES } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { WRITER_PREVIEW_PATH } from "@/lib/writer-profile";
import { MILESTONE_DEFAULT_VISIBILITY } from "@/lib/finishers";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

const ADA = "mbr_AAAAAAAAAAA1";
const state = { dataset: undefined as never as InMemoryDataset, repos: undefined as never as ReturnType<typeof createInMemoryRepos> };
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import WriterProfile, { generateMetadata } from "@/app/w/[handle]/page";
import WriterProfilePreview, { metadata as previewMetadata } from "@/app/(member)/writer-profile/preview/page";
import sitemap, { generateSitemaps } from "@/app/w/sitemap";
import robots from "@/app/robots";

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });
const NOW = new Date("2027-03-01T12:00:00Z");
const flagRow = (enabled_globally: boolean) => ({ feature_key: "writer_profiles", enabled_globally, created_at: NOW.toISOString(), updated_at: NOW.toISOString() });
const GRACE = "mbr_AAAAAAAAAAA2";

async function makePage(handle: string, options: { on?: boolean; bio?: string; photo?: boolean } = {}) {
  await state.repos.writerProfiles.setHandle(ADA, handle, { reserveDays: WRITER_PROFILES.handleReservationDays, now: NOW });
  await state.repos.writerProfiles.update(ADA, { isPublic: options.on ?? true, bio: options.bio ?? null });
  if (options.photo) await state.repos.memberStatus.saveProfileVisibility(ADA, "photo", "public", null);
}

beforeEach(() => {
  resetServerPageMocks();
  state.dataset = new InMemoryDataset({
    members: [{ id: ADA, name: "Ada Legalname", displayName: "Ada Example", email: "ada.private@example.test", photoUrl: "https://photos.example.com/ada.png", userId: "user-ada" }],
    featureFlags: [flagRow(true)],
  });
  state.repos = createInMemoryRepos(state.dataset);
  signInAs(null);
});

describe("/w/[handle]", () => {
  it("shows a public page to a signed-out visitor: the name, the bio and a link back to the community, nothing else", async () => {
    await makePage("ada-example", { bio: "I write cozy mysteries.\nSecond line." });

    const { container } = await renderServerPage(WriterProfile, params("ada-example"));

    expect(screen.getByRole("heading", { level: 1, name: "Ada Example" })).toBeInTheDocument();
    expect(screen.getByText(/I write cozy mysteries\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quill & Cup" })).toHaveAttribute("href", SITE_URL);
    const html = container.innerHTML;
    for (const secret of ["Legalname", "ada.private@example.test", ADA]) expect(html).not.toContain(secret);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  describe("the Milestones strip", () => {
    const confirm = (kind: "the_end" | "publish_ready", title: string, extra: { storyAfter?: string; achievedOn?: string } = {}) =>
      state.repos.milestones.addOwn(
        {
          memberId: ADA,
          kind,
          work: { projectId: null, bookId: null, title },
          createdBy: "11111111-1111-4111-8111-111111111111",
          answer: { status: "confirmed", achievedOn: extra.achievedOn ?? null, storyBefore: null, storyAfter: extra.storyAfter ?? null, consent_testimonial: false },
        },
        NOW,
      );
    const level = async (id: string, visibility: "private" | "community" | "public") => state.repos.milestones.setVisibility(id, ADA, visibility, NOW);

    it("shows only the milestones at the globe, with the title, the work, the day and the story, and nothing more private", async () => {
      await makePage("ada-example");
      const shown = await confirm("the_end", "A Fake Novel", { storyAfter: "I finally did it.", achievedOn: "2026-05-01" });
      const members = await confirm("publish_ready", "A Community Fake Work", { storyAfter: "Community only words." });
      const hidden = await confirm("the_end", "A Private Fake Work", { storyAfter: "Private words." });
      expect(shown.milestone.visibility).toBe(MILESTONE_DEFAULT_VISIBILITY);
      await level(members.milestone.id, "community");
      await level(hidden.milestone.id, "private");

      const { container } = await renderServerPage(WriterProfile, params("ada-example"));

      const strip = screen.getByTestId("milestone-strip");
      expect(strip).toHaveTextContent("Finisher · Wrote THE END");
      expect(strip).toHaveTextContent("A Fake Novel");
      expect(strip).toHaveTextContent("May 1, 2026");
      expect(strip).toHaveTextContent("I finally did it.");
      for (const secret of ["Community only words.", "A Community Fake Work", "Private words.", "A Private Fake Work", "mlst_"]) expect(container.innerHTML).not.toContain(secret);
    });

    it("draws no strip when no milestone is at the globe", async () => {
      await makePage("ada-example");
      const { milestone } = await confirm("the_end", "A Fake Novel");
      await level(milestone.id, "community");
      await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.queryByTestId("milestone-strip")).not.toBeInTheDocument();
    });

    const book = (id: string, title: string, projectId: string | null = null, published = "2026-09-01") =>
      state.dataset.memberBooks.push({ id, member_id: ADA, title, published_date: published, cover_asset_id: null, project_id: projectId });

    it("lists each work with its milestones in order and Published from the Bookshelf, for one work and for several at different steps", async () => {
      await makePage("ada-example");
      const novel = await state.repos.writing.createProject(ADA, "A Fake Novel", "revising");
      book("book_AAAAAAAAAAA1", "A Fake Novel Book", novel);
      book("book_AAAAAAAAAAA2", "A Loose Fake Book");
      const projectWork = { projectId: novel, bookId: null, title: null };
      for (const kind of ["publish_ready", "the_end"] as const) {
        await state.repos.milestones.addOwn(
          { memberId: ADA, kind, work: projectWork, createdBy: "11111111-1111-4111-8111-111111111111", answer: { status: "confirmed", achievedOn: null, storyBefore: null, storyAfter: null, consent_testimonial: false } },
          NOW,
        );
      }
      await confirm("the_end", "A Fake Memoir");
      await renderServerPage(WriterProfile, params("ada-example"));

      const works = screen.getAllByTestId("milestone-work");
      expect(works).toHaveLength(3);
      const steps = (work: HTMLElement) => Array.from(work.querySelectorAll("li p:first-child")).map((p) => p.textContent);
      const byTitle = (title: string) => works.find((w) => w.querySelector("h3")?.textContent === title)!;
      // A project and its book are one work, all three steps in order; a book alone is only Published; a work with a title the member wrote has its one step.
      expect(steps(byTitle("A Fake Novel Book"))).toEqual(["Finisher · Wrote THE END", "Author · Manuscript ready to publish", "Published Author · Published"]);
      expect(steps(byTitle("A Loose Fake Book"))).toEqual(["Published Author · Published"]);
      expect(steps(byTitle("A Fake Memoir"))).toEqual(["Finisher · Wrote THE END"]);
    });

    it("shows Published for a Bookshelf book with no milestone at all, at the globe, in the preview too", async () => {
      await makePage("ada-example", { on: false });
      book("book_AAAAAAAAAAA1", "A Fake Book");
      signInAs({ id: "user-ada", email: "ada.private@example.test" } as never, { memberId: ADA, memberName: "Ada", memberEmail: "ada.private@example.test", isSudo: false });
      await renderServerPage(WriterProfilePreview, {});
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("A Fake Book");
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("Published Author · Published");
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("September 1, 2026");
    });

    it("leaves out Published for a book published before the owner first joined, on the page and in the preview, and keeps the one on the join day", async () => {
      await makePage("ada-example");
      state.dataset.members[0].firstJoinedAt = "2026-09-01T15:00:00Z";
      book("book_AAAAAAAAAAA1", "An Earlier Fake Book", null, "2026-08-31");
      book("book_AAAAAAAAAAA2", "A Join Day Fake Book", null, "2026-09-01");
      const page = await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("A Join Day Fake Book");
      expect(screen.getByTestId("milestone-strip")).not.toHaveTextContent("An Earlier Fake Book");
      page.unmount();

      signInAs({ id: "user-ada", email: "ada.private@example.test" } as never, { memberId: ADA, memberName: "Ada", memberEmail: "ada.private@example.test", isSudo: false });
      await renderServerPage(WriterProfilePreview, {});
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("A Join Day Fake Book");
      expect(screen.getByTestId("milestone-strip")).not.toHaveTextContent("An Earlier Fake Book");
    });

    it("draws no strip when every book is from before the owner joined", async () => {
      await makePage("ada-example");
      state.dataset.members[0].firstJoinedAt = "2026-09-01";
      book("book_AAAAAAAAAAA1", "An Earlier Fake Book", null, "2020-01-01");
      await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.queryByTestId("milestone-strip")).not.toBeInTheDocument();
    });

    it("draws no Published for a deleted book", async () => {
      await makePage("ada-example");
      book("book_AAAAAAAAAAA1", "A Deleted Fake Book");
      state.dataset.memberBooks[0].deleted_at = NOW.toISOString();
      await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.queryByTestId("milestone-strip")).not.toBeInTheDocument();
    });

    it("is behind the writer profiles flag and the page being on: with either off it is the same 404, and the strip is never read", async () => {
      await makePage("ada-example");
      book("book_AAAAAAAAAAA1", "A Fake Book");
      const { milestone } = await confirm("the_end", "A Fake Novel", { storyAfter: "I finally did it." });
      await level(milestone.id, "public");
      const reads = vi.spyOn(state.repos.milestones, "worksShownOnWeb");

      state.dataset.featureFlags[0].enabled_globally = false;
      await expect(WriterProfile(params("ada-example"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
      state.dataset.featureFlags[0].enabled_globally = true;
      await state.repos.writerProfiles.update(ADA, { isPublic: false });
      await expect(WriterProfile(params("ada-example"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
      expect(reads).not.toHaveBeenCalled();
    });

    it("shows a withdrawn milestone no more on the next read", async () => {
      await makePage("ada-example");
      const { milestone } = await confirm("the_end", "A Fake Novel", { storyAfter: "I finally did it." });
      await level(milestone.id, "public");
      const first = await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.getByTestId("milestone-strip")).toBeInTheDocument();
      first.unmount();
      await level(milestone.id, "community");
      await renderServerPage(WriterProfile, params("ada-example"));
      expect(screen.queryByTestId("milestone-strip")).not.toBeInTheDocument();
    });

    it("shows the globe milestones in the member's own preview too, whether or not the page is on", async () => {
      await makePage("ada-example", { on: false });
      const { milestone } = await confirm("publish_ready", "A Fake Novel", { storyAfter: "Ready at last." });
      await level(milestone.id, "public");
      signInAs({ id: "user-ada", email: "ada.private@example.test" } as never, { memberId: ADA, memberName: "Ada", memberEmail: "ada.private@example.test", isSudo: false });
      await renderServerPage(WriterProfilePreview, {});
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("Author · Manuscript ready to publish");
      expect(screen.getByTestId("milestone-strip")).toHaveTextContent("Ready at last.");
    });
  });

  it("shows the photo only when the member chose to", async () => {
    await makePage("ada-example", { photo: true });
    await renderServerPage(WriterProfile, params("ada-example"));
    expect(screen.getByRole("img", { name: "Ada Example" })).toHaveAttribute("src", "https://photos.example.com/ada.png");
  });

  it("shows the member's own bio only at the globe, and the social links the member opened, each over https", async () => {
    const ada = state.dataset.members.find((m) => m.id === ADA)!;
    Object.assign(ada, { bio: "My bio.", instagramUrl: "https://instagram.com/ada", facebookUrl: "https://facebook.com/ada", twitterUrl: "http://x.com/ada" });
    await makePage("ada-example");

    const closed = await renderServerPage(WriterProfile, params("ada-example"));
    expect(screen.queryByText("My bio.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Instagram" })).not.toBeInTheDocument();
    closed.unmount();

    for (const item of ["bio", "instagram", "x"] as const) await state.repos.memberStatus.saveProfileVisibility(ADA, item, "public", null);
    await renderServerPage(WriterProfile, params("ada-example"));
    expect(screen.getByText("My bio.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://instagram.com/ada");
    expect(screen.queryByRole("link", { name: "Facebook" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Twitter / X" })).not.toBeInTheDocument();
  });

  it("lists the opened social links as the person's other profiles in the structured data", async () => {
    state.dataset.members.find((m) => m.id === ADA)!.instagramUrl = "https://instagram.com/ada";
    await makePage("ada-example");
    await state.repos.memberStatus.saveProfileVisibility(ADA, "instagram", "public", null);

    const { container } = await renderServerPage(WriterProfile, params("ada-example"));

    expect(JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!).sameAs).toEqual(["https://instagram.com/ada"]);
  });

  it("renders a bio as text, never as markup", async () => {
    await makePage("ada-example", { bio: "<b>bold</b> <script>alert(1)</script>" });

    const { container } = await renderServerPage(WriterProfile, params("ada-example"));

    expect(container.querySelector("article b")).toBeNull();
    expect(screen.getByText(/<b>bold<\/b>/)).toBeInTheDocument();
  });

  it("answers the same 404 for a page that is off, a handle nobody has, and an address that cannot be a handle", async () => {
    await makePage("hidden-page", { on: false });

    for (const handle of ["hidden-page", "never-made", "Not Valid", "../etc", "a--b"]) {
      await expect(WriterProfile(params(handle))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    }
    const [hidden, missing] = await Promise.all([generateMetadata(params("hidden-page")), generateMetadata(params("never-made"))]);
    expect(hidden).toEqual(missing);
    expect(hidden.robots).toEqual({ index: false });
  });

  it("sends a handle the member gave up permanently to the one they use now, and 404s it while the page is off", async () => {
    await makePage("ada-old");
    await state.repos.writerProfiles.setHandle(ADA, "ada-new", { reserveDays: 90, now: NOW });

    await expectPermanentRedirect(WriterProfile, params("ada-old"), "/w/ada-new");
    await state.repos.writerProfiles.update(ADA, { isPublic: false });
    await expect(WriterProfile(params("ada-old"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("sends capital letters to the one lowercase address", async () => {
    await makePage("ada-example");
    await expectPermanentRedirect(WriterProfile, params("Ada-Example"), "/w/ada-example");
  });

  it("is indexed, with a canonical address, a social card and structured data for a person", async () => {
    await makePage("ada-example", { bio: "I write cozy mysteries.", photo: true });

    const metadata = await generateMetadata(params("ada-example"));

    expect(metadata.title).toBe("Ada Example");
    expect(metadata.description).toBe("I write cozy mysteries.");
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(`${APP_URL}/w/ada-example`);
    expect(metadata.openGraph).toMatchObject({ title: "Ada Example", url: `${APP_URL}/w/ada-example`, type: "profile", images: [{ url: "https://photos.example.com/ada.png" }] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: "Ada Example" });

    const { container } = await renderServerPage(WriterProfile, params("ada-example"));
    const json = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(json).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Ada Example",
      url: `${APP_URL}/w/ada-example`,
      description: "I write cozy mysteries.",
      image: "https://photos.example.com/ada.png",
    });
  });

  it("cannot be broken out of the structured data by what the bio says", async () => {
    await makePage("ada-example", { bio: "</script><script>alert(1)</script>" });

    const { container } = await renderServerPage(WriterProfile, params("ada-example"));

    expect(container.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    expect(container.querySelector('script[type="application/ld+json"]')!.innerHTML).not.toContain("</script>");
    expect(JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!).description).toBe("</script><script>alert(1)</script>");
  });
});

describe("the writer_profiles flag", () => {
  const MEMBER_USER = { id: "user-ada", email: "ada.private@example.test" };
  const IDENTITY = { memberId: ADA, memberName: "Ada Legalname", memberEmail: "ada.private@example.test", isSudo: false };
  const flagOff = () => {
    state.dataset.featureFlags = [flagRow(false)];
  };
  const notFoundError = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

  it("answers a public page whose owner lacks the flag with the same 404 as a page nobody has, in the page and its metadata", async () => {
    await makePage("ada-example", { bio: "Hidden by the flag." });
    flagOff();

    await expect(WriterProfile(params("ada-example"))).rejects.toMatchObject(notFoundError);
    const [flagged, missing] = await Promise.all([generateMetadata(params("ada-example")), generateMetadata(params("never-made"))]);
    expect(flagged).toEqual(missing);
    expect(flagged.robots).toEqual({ index: false });
  });

  it("serves it again when the flag comes back, with nothing changed", async () => {
    await makePage("ada-example", { bio: "Still here." });
    flagOff();
    await expect(WriterProfile(params("ada-example"))).rejects.toMatchObject(notFoundError);

    state.dataset.featureFlags = [];
    state.dataset.userFeaturePreviews = [{ user_id: "user-ada", feature_key: "writer_profiles", enabled_at: NOW.toISOString() }];
    await renderServerPage(WriterProfile, params("ada-example"));
    expect(screen.getByText("Still here.")).toBeInTheDocument();
  });

  it("does not redirect from a given-up handle either", async () => {
    await makePage("ada-old");
    await state.repos.writerProfiles.setHandle(ADA, "ada-new", { reserveDays: 90, now: NOW });
    flagOff();

    await expect(WriterProfile(params("ada-old"))).rejects.toMatchObject(notFoundError);
  });

  it("gives the owner's preview the same 404 while the flag is off, and keeps the page's data", async () => {
    signInAs(MEMBER_USER, IDENTITY);
    await makePage("ada-example", { on: false, bio: "Draft." });
    flagOff();

    await expect(WriterProfilePreview()).rejects.toMatchObject(notFoundError);
    expect(await state.repos.writerProfiles.ofMember(ADA)).toMatchObject({ handle: "ada-example", bio: "Draft." });
  });

  it("leaves the pages of owners without the flag out of the sitemap, whatever the other pages are, and keeps robots to the sitemap list", async () => {
    await makePage("ada-example");
    state.dataset.members.push({ id: GRACE, name: "Grace Example", userId: "user-grace" });
    await state.repos.writerProfiles.setHandle(GRACE, "grace-example", { reserveDays: 90, now: NOW });
    await state.repos.writerProfiles.update(GRACE, { isPublic: true });
    state.dataset.featureFlags = [flagRow(false)];
    state.dataset.userFeaturePreviews = [{ user_id: "user-grace", feature_key: "writer_profiles", enabled_at: NOW.toISOString() }];

    expect(await sitemap({ id: Promise.resolve("0") })).toEqual([{ url: `${APP_URL}/w/grace-example`, lastModified: expect.any(String) }]);

    state.dataset.userFeaturePreviews = [];
    expect(await sitemap({ id: Promise.resolve("0") })).toEqual([]);
    const rules = await robots();
    expect(JSON.stringify(rules)).not.toContain("grace-example");
    expect(rules.sitemap).toEqual([`${APP_URL}/w/sitemap/0.xml`]);
  });

  it("checks the owners of a whole sitemap file together, not one by one", async () => {
    for (const [i, name] of ["one", "two", "three"].entries()) {
      const id = `mbr_BBBBBBBBBBB${i}`;
      state.dataset.members.push({ id, name, userId: `user-${name}` });
      await state.repos.writerProfiles.setHandle(id, `writer-${name}`, { reserveDays: 90, now: NOW });
      await state.repos.writerProfiles.update(id, { isPublic: true });
    }
    state.dataset.featureFlags = [flagRow(false)];
    const spy = vi.spyOn(state.repos.featureFlags, "userIdsWithPreview");

    await sitemap({ id: Promise.resolve("0") });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the preview", () => {
  const MEMBER_USER = { id: "user-ada", email: "ada.private@example.test" };
  const IDENTITY = { memberId: ADA, memberName: "Ada Legalname", memberEmail: "ada.private@example.test", isSudo: false };

  it("is never indexed and its path is under the signed-in member routes", () => {
    expect(previewMetadata.robots).toEqual({ index: false, follow: false });
    expect(WRITER_PREVIEW_PATH).toBe("/writer-profile/preview");
  });

  it("shows the member their page when it is off, with a note that only they can see it", async () => {
    signInAs(MEMBER_USER, IDENTITY);
    await makePage("ada-example", { on: false, bio: "Not public yet." });

    await renderServerPage(WriterProfilePreview, {});

    expect(screen.getByRole("heading", { level: 1, name: "Ada Example" })).toBeInTheDocument();
    expect(screen.getByText("Not public yet.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your page is off: only you can see this.");
  });

  it("says the page is on when it is", async () => {
    signInAs(MEMBER_USER, IDENTITY);
    await makePage("ada-example");

    await renderServerPage(WriterProfilePreview, {});

    expect(screen.getByRole("status")).toHaveTextContent("Your page is on: anyone can open it.");
  });

  it("sends someone who is not signed in to sign in, and shows a member with no address how to set one up", async () => {
    await expectRedirect(WriterProfilePreview, {}, "/login");

    signInAs(MEMBER_USER, IDENTITY);
    await renderServerPage(WriterProfilePreview, {});
    expect(screen.getByText("You have not chosen an address for your page yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set it up in Settings" })).toHaveAttribute("href", "/settings/profile");
  });

  it("sends an admin with no member record to the admin area", async () => {
    signInAs(MEMBER_USER, null);
    await expectRedirect(WriterProfilePreview, {}, "/admin");
    expect(getCurrentUser).toHaveBeenCalled();
  });
});

describe("sitemap and robots", () => {
  it("lists the public pages, not the ones that are off, with when each last changed", async () => {
    await makePage("ada-example");
    state.dataset.members.push({ id: "mbr_AAAAAAAAAAA2", name: "Grace Example" });
    await state.repos.writerProfiles.setHandle("mbr_AAAAAAAAAAA2", "grace-hidden", { reserveDays: 90, now: NOW });

    const entries = await sitemap({ id: Promise.resolve("0") });

    expect(entries).toEqual([{ url: `${APP_URL}/w/ada-example`, lastModified: expect.any(String) }]);
  });

  it("makes one sitemap when there are none or a few, and more as the pages grow", async () => {
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    await makePage("ada-example");
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
    expect((await sitemap({ id: Promise.resolve("7") })).length).toBe(0);
    expect((await sitemap({ id: Promise.resolve("not-a-number") })).length).toBe(1);
  });

  it("allows crawling, keeps them out of the API and admin, and lists the sitemaps", async () => {
    await makePage("ada-example");

    expect(await robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/"] },
      sitemap: [`${APP_URL}/w/sitemap/0.xml`],
    });
  });

  it("still makes the first sitemap when the count cannot be read, so a build without a database does not fail", async () => {
    vi.spyOn(state.repos.writerProfiles, "publicCount").mockRejectedValue(new Error("down"));
    expect(await generateSitemaps()).toEqual([{ id: 0 }]);
  });

  it("still lists the first sitemap when the count cannot be read", async () => {
    vi.spyOn(state.repos.writerProfiles, "publicCount").mockRejectedValue(new Error("down"));
    expect((await robots()).sitemap).toEqual([`${APP_URL}/w/sitemap/0.xml`]);
  });
});
