import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCurrentUser, download, from } = vi.hoisted(() => {
  const download = vi.fn();
  return { getCurrentUser: vi.fn(), download, from: vi.fn(() => ({ download })) };
});
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ storage: { from } }) }));

import { GET } from "@/app/(member)/help/images/[scene]/[file]/route";

const call = (scene: string, file: string) => GET(new Request("http://localhost/help/images/x"), { params: Promise.resolve({ scene, file }) });

describe("GET /help/images/[scene]/[file]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1", email: "a@example.test" });
    download.mockResolvedValue({ data: new Blob(["png-bytes"], { type: "image/png" }), error: null });
  });

  it("serves the screenshot from the private bucket to a signed-in member, cached by the browser only", async () => {
    const res = await call("join-a-prickle", "01-dashboard.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(await res.text()).toBe("png-bytes");
    expect(from).toHaveBeenCalledWith("help-images");
    expect(download).toHaveBeenCalledWith("local/join-a-prickle/01-dashboard.png");
  });

  it("refuses a signed-out visitor without touching storage", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await call("join-a-prickle", "01-dashboard.png")).status).toBe(401);
    expect(download).not.toHaveBeenCalled();
  });

  it("answers 404 for a name that could leave the bucket folder, without touching storage", async () => {
    for (const [scene, file] of [["..", "x.png"], ["a", "../x.png"], ["a", "x.svg"]]) {
      expect((await call(scene, file)).status).toBe(404);
    }
    expect(download).not.toHaveBeenCalled();
  });

  it("answers 404 when the image isn't in the bucket", async () => {
    download.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    expect((await call("join-a-prickle", "09-missing.png")).status).toBe(404);
  });
});
