// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { signVerificationToken } from "@/lib/email-verification";
import { useFakeClock } from "@/tests/helpers/fake-clock";

let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const { default: VerifyEmailPage } = await import("@/app/verify-email/page");
const { confirmEmailFromToken } = await import("@/app/verify-email/actions");

const ME = "mbr_AAAAAAAAAAA1";
const ADDRESS = "ada.old@example.com";
const fake = useFakeClock();
let aliasId: string;
let token: string;
const renderFor = (t: string | undefined) => renderServerPage(VerifyEmailPage, { searchParams: Promise.resolve({ t }) });
const form = (t: string) => {
  const f = new FormData();
  f.set("token", t);
  return f;
};

beforeEach(async () => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  revalidatePath.mockClear();
  repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: ME, name: "Ada Example", email: "ada@example.com" }] }));
  await repos.aliases.addEmail(ME, ADDRESS, "manual");
  aliasId = (await repos.aliases.findEmail(ADDRESS))!.id;
  token = signVerificationToken(aliasId, ADDRESS);
});

describe("/verify-email page", () => {
  it("asks for the button without confirming anything by being viewed", async () => {
    await renderFor(token);

    expect(screen.getByRole("heading")).toHaveTextContent("Is this your email address?");
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm this address" })).toBeInTheDocument();
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).toBeNull();
  });

  it("confirms with the button, then shows the address as confirmed", async () => {
    await confirmEmailFromToken(form(token));
    expect(revalidatePath).toHaveBeenCalledWith("/verify-email");
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).not.toBeNull();

    await renderFor(token);
    expect(screen.getByRole("heading")).toHaveTextContent(`${ADDRESS} is confirmed`);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains a link that is cut off, forged or expired, and a bad token confirms nothing", async () => {
    await renderFor("nope");
    expect(screen.getByRole("heading")).toHaveTextContent("This link doesn't work");

    await confirmEmailFromToken(form("nope"));
    expect((await repos.aliases.emailById(aliasId))!.verifiedAt).toBeNull();
  });

  it("says a link has expired", async () => {
    fake.clock.advance(8 * 24 * 3_600_000);
    await renderFor(token);
    expect(screen.getByRole("heading")).toHaveTextContent("This link has expired");
  });
});
