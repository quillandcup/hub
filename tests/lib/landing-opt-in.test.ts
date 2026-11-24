/**
 * The opt-in relay (src/app/api/landing/opt-in) and its Kajabi destination. Kajabi is a mocked endpoint (a stubbed fetch):
 * no test here reaches the real API, and every name and address is made up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  allow: true,
  hits: [] as string[],
  page: null as { data: unknown } | null,
  /** When set, the relay reads pages from this real repository instead of the canned page. */
  real: null as { published: (slug: string) => Promise<{ data: unknown } | null> } | null,
};
vi.mock("@/lib/data/server", () => ({
  getServiceRepos: () => ({
    rateLimit: {
      hit: async (bucket: string) => {
        state.hits.push(bucket);
        return state.allow;
      },
    },
    landingPages: { published: async (slug: string) => (state.real ? state.real.published(slug) : state.page) },
  }),
}));

import { DISPOSABLE_EMAIL_MESSAGE } from "@/lib/disposable-email";
import { POST } from "@/app/api/landing/opt-in/route";
import { optInDestination } from "@/lib/landing/opt-in-destination";
import { findOptInTarget, type OptInDestination } from "@/lib/landing/opt-in";
import { KajabiOptInDestination } from "@/lib/landing/opt-in-kajabi";

const FORM = "form-123";
const page = (props: Record<string, unknown> = {}) => ({
  data: { content: [{ type: "Section", props: { id: "s", content: [{ type: "OptInForm", props: { id: "o", kajabiFormId: FORM, instagramField: "custom_1", ...props } }] } }], root: {} },
});
const valid = { page: "spring", formId: FORM, name: "Ada Example", email: "Ada@Example.test", instagram: "@ada.example", website: "" };

function post(body: unknown, raw = false) {
  return POST(new NextRequest("http://localhost/api/landing/opt-in", { method: "POST", body: raw ? (body as string) : JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } }));
}

const submit = vi.fn<OptInDestination["submit"]>();
const original = optInDestination.current;

beforeEach(() => {
  state.allow = true;
  state.hits = [];
  state.page = page();
  state.real = null;
  submit.mockReset().mockResolvedValue({ ok: true });
  optInDestination.current = { submit };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  optInDestination.current = original;
  vi.restoreAllMocks();
});

describe("POST /api/landing/opt-in", () => {
  it("sends a valid sign-up to the destination with the form the page names", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledWith({ formId: FORM, instagramField: "custom_1" }, { name: "Ada Example", email: "ada@example.test", instagram: "ada.example" });
    expect(state.hits).toHaveLength(2);
  });

  it("answers 400 to a malformed or non-object body", async () => {
    expect((await post("{not json", true)).status).toBe(400);
    expect((await post("[]", true)).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("answers 400 to a missing name, a bad address or a bad handle, and sends nothing", async () => {
    expect((await post({ ...valid, name: " " })).status).toBe(400);
    expect((await post({ ...valid, email: "nope" })).status).toBe(400);
    expect((await post({ ...valid, instagram: "not a handle!" })).status).toBe(400);
    expect((await post({ ...valid, page: "Not A Slug!" })).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a temporary-mail address and sends nothing", async () => {
    const res = await post({ ...valid, email: "ada@mailinator.com" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(DISPOSABLE_EMAIL_MESSAGE);
    expect(submit).not.toHaveBeenCalled();
  });

  it("looks like success to a bot that fills the hidden field, and sends nothing", async () => {
    const res = await post({ ...valid, website: "https://spam.example" });
    expect(res.status).toBe(200);
    expect(submit).not.toHaveBeenCalled();
    expect(state.hits).toHaveLength(0);
  });

  it("answers 429 when a rate limit is spent", async () => {
    state.allow = false;
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    expect(state.hits[0]).toBe("landing_opt_in:ip:203.0.113.9");
  });

  it("answers 404 for a form the published page does not show, or a page that is not published", async () => {
    expect((await post({ ...valid, formId: "other-form" })).status).toBe(404);
    state.page = null;
    expect((await post(valid)).status).toBe(404);
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a form on a template, even a published one: a template is never public", async () => {
    const { InMemoryDataset } = await import("@/lib/data/in-memory");
    const { InMemoryLandingPageRepository } = await import("@/lib/data/landing-pages");
    const repo = new InMemoryLandingPageRepository(new InMemoryDataset());
    state.real = repo;
    const template = await repo.create({ title: "Kit", slug: "spring", data: page().data as never, createdBy: null, kind: "template" });
    await repo.publish(template.id);
    expect((await post(valid)).status).toBe(404);
    expect(submit).not.toHaveBeenCalled();
    // The same document on a page is served.
    await repo.remove(template.id, null);
    const real = await repo.create({ title: "Page", slug: "spring", data: page().data as never, createdBy: null });
    await repo.publish(real.id);
    expect((await post(valid)).status).toBe(200);
  });

  it("tells the visitor to check their details when the destination refuses them", async () => {
    submit.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await post(valid)).status).toBe(422);
  });

  it("answers a calm 502 when the destination fails, with no name or email in the answer or the logs", async () => {
    submit.mockResolvedValue({ ok: false, reason: "unavailable" });
    const res = await post(valid);
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json()) + JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(text).not.toContain("ada@example.test");
    expect(text).not.toContain("Ada Example");
  });
});

describe("findOptInTarget", () => {
  it("finds a form inside a section, reads the Instagram field from the block, and refuses unknown values", () => {
    expect(findOptInTarget(page().data, FORM)).toEqual({ formId: FORM, instagramField: "custom_1" });
    expect(findOptInTarget(page({ instagramField: "address_zip" }).data, FORM)?.instagramField).toBe("none");
    expect(findOptInTarget(page().data, "missing")).toBeNull();
    expect(findOptInTarget(page().data, "bad id!")).toBeNull();
    expect(findOptInTarget(null, FORM)).toBeNull();
  });

  it("finds a form inside an exit popup, so the relay takes the sign-ups of the popup's form", () => {
    const popup = { content: [{ type: "ExitPopup", props: { id: "p", enabled: true, content: [{ type: "OptInForm", props: { id: "o", kajabiFormId: FORM, instagramField: "none" } }] } }], root: {} };
    expect(findOptInTarget(popup, FORM)).toEqual({ formId: FORM, instagramField: "none" });
    expect(findOptInTarget(popup, "another")).toBeNull();
  });
});

describe("KajabiOptInDestination (mocked Kajabi)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let formStatus = 201;

  beforeEach(() => {
    calls.length = 0;
    formStatus = 201;
    vi.stubEnv("KAJABI_CLIENT_ID", "test-client");
    vi.stubEnv("KAJABI_CLIENT_SECRET", "test-secret");
    vi.stubEnv("KAJABI_SITE_ID", "test-site");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/v1/oauth/token")) return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200 });
        return new Response(JSON.stringify({ errors: [{ detail: "ada@example.test is not valid" }] }), { status: formStatus });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("posts a JSON:API form submission with the name, email and the chosen custom field", async () => {
    const result = await new KajabiOptInDestination().submit({ formId: FORM, instagramField: "custom_2" }, { name: "Ada Example", email: "ada@example.test", instagram: "ada.example" });
    expect(result).toEqual({ ok: true });
    const form = calls.find((c) => c.url.includes("/v1/forms/"))!;
    expect(form.url).toBe(`https://api.kajabi.com/v1/forms/${FORM}/submit`);
    expect((form.init.headers as Record<string, string>)["Content-Type"]).toBe("application/vnd.api+json");
    expect(JSON.parse(form.init.body as string)).toEqual({ data: { type: "form_submissions", attributes: { name: "Ada Example", email: "ada@example.test", custom_2: "ada.example" } } });
  });

  it("leaves the handle out when the block keeps none", async () => {
    await new KajabiOptInDestination().submit({ formId: FORM, instagramField: "none" }, { name: "Ada Example", email: "ada@example.test", instagram: "ada.example" });
    const body = JSON.parse(calls.find((c) => c.url.includes("/v1/forms/"))!.init.body as string);
    expect(body.data.attributes).toEqual({ name: "Ada Example", email: "ada@example.test" });
  });

  it("maps a refusal to invalid and any other failure to unavailable, without logging the response body", async () => {
    formStatus = 422;
    expect(await new KajabiOptInDestination().submit({ formId: FORM, instagramField: "none" }, { name: "A", email: "ada@example.test", instagram: "" })).toEqual({ ok: false, reason: "invalid" });
    formStatus = 500;
    expect(await new KajabiOptInDestination().submit({ formId: FORM, instagramField: "none" }, { name: "A", email: "ada@example.test", instagram: "" })).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("ada@example.test");
  });

  it("is unavailable, not a crash, when the credentials are missing", async () => {
    vi.stubEnv("KAJABI_CLIENT_ID", "");
    expect(await new KajabiOptInDestination().submit({ formId: FORM, instagramField: "none" }, { name: "A", email: "a@example.test", instagram: "" })).toEqual({ ok: false, reason: "unavailable" });
  });
});
