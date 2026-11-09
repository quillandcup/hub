import { beforeEach, describe, expect, it, vi } from "vitest";

const { headerValue } = vi.hoisted(() => ({ headerValue: { current: null as string | null } }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => (name === "x-hub-path" ? headerValue.current : null) }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { GATES } from "@/lib/gates";
import { currentPath, redirectToGate } from "@/lib/gates.server";

beforeEach(() => {
  headerValue.current = null;
});

describe("currentPath", () => {
  it("is the address the proxy saw, query included", async () => {
    headerValue.current = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";
    expect(await currentPath()).toBe("/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1");
  });

  it("is null when there is none, or when it isn't a safe same-origin path", async () => {
    expect(await currentPath()).toBeNull();
    for (const bad of ["https://evil.example.com/", "//evil.example.com", "/login", "javascript:alert(1)"]) {
      headerValue.current = bad;
      expect(await currentPath()).toBeNull();
    }
  });
});

describe("redirectToGate", () => {
  it("sends the visitor to the gate with the page they asked for attached", async () => {
    headerValue.current = "/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1";

    await expect(redirectToGate(GATES.connectSlack)).rejects.toThrow(
      `redirect:/settings?slack=required&next=${encodeURIComponent("/chat/chn_AAAAAAAAAAA1?thread=msg_AAAAAAAAAAA1")}`,
    );
  });

  it("still sends them to the gate, without a destination, when the proxy didn't say where they were headed", async () => {
    await expect(redirectToGate(GATES.connectSlack)).rejects.toThrow("redirect:/settings?slack=required");
  });
});
