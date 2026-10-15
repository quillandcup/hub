import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../setup-msw";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { EMAIL_FROM } from "@/lib/config";
import { sendEmail } from "@/lib/email";

const RESEND = "https://api.resend.com/emails";
const message = { to: "alice@example.com", subject: "Hello", html: "<p>Hi</p>", text: "Hi" };

function captureSends(respond: () => Response = () => HttpResponse.json({ id: "e1" })) {
  const bodies: any[] = [];
  server.use(
    http.post(RESEND, async ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer re_test");
      bodies.push(await request.json());
      return respond();
    })
  );
  return bodies;
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_TEST_MODE", "false");
  vi.stubEnv("EMAIL_DEV_ADDRESS", "dev@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail", () => {
  const fake = useFakeClock();

  it("sends the message from the configured address", async () => {
    const sent = captureSends();
    await sendEmail(message);

    expect(sent).toEqual([
      { from: EMAIL_FROM, to: ["alice@example.com"], subject: "Hello", html: "<p>Hi</p>", text: "Hi" },
    ]);
  });

  it("redirects to EMAIL_DEV_ADDRESS in test mode, saying who it was for", async () => {
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    const sent = captureSends();
    await sendEmail(message);

    expect(sent[0].to).toEqual(["dev@example.com"]);
    expect(sent[0].subject).toContain("alice@example.com");
    expect(sent[0].subject).toContain("Hello");
  });

  it("is in test mode by default outside production", async () => {
    vi.stubEnv("EMAIL_TEST_MODE", "");
    const sent = captureSends();
    await sendEmail(message);

    expect(sent[0].to).toEqual(["dev@example.com"]);
  });

  it("throws in test mode without a dev address, rather than risk a real send or report one", async () => {
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_DEV_ADDRESS", "");
    const sent = captureSends();

    await expect(sendEmail(message)).rejects.toThrow("EMAIL_DEV_ADDRESS");
    expect(sent).toEqual([]);
  });

  it("throws without an API key, so callers don't report an unsent email as sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const sent = captureSends();

    await expect(sendEmail(message)).rejects.toThrow("RESEND_API_KEY");
    expect(sent).toEqual([]);
  });

  it("waits out a rate limit and tries again", async () => {
    let calls = 0;
    const sent = captureSends(() =>
      ++calls === 1 ? new HttpResponse("slow down", { status: 429, headers: { "retry-after": "2" } }) : HttpResponse.json({ id: "e1" })
    );
    await sendEmail(message);

    expect(sent).toHaveLength(2);
    expect(fake.clock.slept).toBe(2000);
  });

  it("gives up after repeated rate limits", async () => {
    const sent = captureSends(() => new HttpResponse("slow down", { status: 429 }));

    await expect(sendEmail(message)).rejects.toThrow("429");
    expect(sent).toHaveLength(3);
  });

  it("throws on other failures without retrying", async () => {
    const sent = captureSends(() => new HttpResponse("bad domain", { status: 403 }));

    await expect(sendEmail(message)).rejects.toThrow("403: bad domain");
    expect(sent).toHaveLength(1);
  });
});
