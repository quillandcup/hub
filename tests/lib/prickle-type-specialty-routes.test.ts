import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The create and update routes carry the "specialty" flag the Events page reads. A small recording
// client stands in for Supabase: it captures the written payload and answers "no name clash".

let written: Record<string, unknown> | undefined;
// The clash check answers "no other type has this name"; the write is captured.
const client = {
  from: () => ({
    select: () => ({ eq: () => ({ neq: () => ({ single: async () => ({ data: null }) }), single: async () => ({ data: null }) }) }),
    insert: (payload: Record<string, unknown>) => {
      written = payload;
      return { select: () => ({ single: async () => ({ data: { id: "prty_AAAAAAAAAAA1", ...payload }, error: null }) }) };
    },
    update: (payload: Record<string, unknown>) => {
      written = payload;
      return { eq: async () => ({ error: null }) };
    },
  }),
};
vi.mock("@/lib/supabase/api-auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin" }, supabase: client }),
}));
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: async () => {} }));

import { POST as create } from "@/app/api/prickle-types/create/route";
import { POST as update } from "@/app/api/prickle-types/update/route";

const post = (route: (request: NextRequest) => Promise<Response>, body: unknown) =>
  route(new NextRequest("http://localhost/api/prickle-types", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  written = undefined;
});

describe("prickle type routes: isSpecialty", () => {
  it("stores the flag when creating a type", async () => {
    const res = await post(create, { name: "Book Launch Party", isSpecialty: true });

    expect(res.status).toBe(201);
    expect(written).toMatchObject({ name: "Book Launch Party", is_specialty: true });
  });

  it("stores the flag when updating a type", async () => {
    const res = await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "Pitch Prickle", isSpecialty: false });

    expect(res.status).toBe(200);
    expect(written).toMatchObject({ is_specialty: false });
  });

  it("leaves the flag alone when the request doesn't mention it", async () => {
    await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "Pitch Prickle" });

    expect(written).not.toHaveProperty("is_specialty");
  });

  it("rejects a flag that isn't a boolean", async () => {
    expect((await post(create, { name: "X", isSpecialty: "yes" })).status).toBe(400);
    expect((await post(update, { typeId: "prty_AAAAAAAAAAA1", name: "X", isSpecialty: 1 })).status).toBe(400);
    expect(written).toBeUndefined();
  });
});
