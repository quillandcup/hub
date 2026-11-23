import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { getTestSupabaseAdminClient, getTestSupabaseClient } from "@/tests/helpers/supabase";

/**
 * The private bucket for photos on milestones, against the real storage service (docs/product/FINISHERS.md, "Photos"): only the
 * server's key reaches a file. No visitor and no signed-in member can read, list, sign or write one, and the bucket has no public address.
 */
const admin = getTestSupabaseAdminClient();
const RUN = `mph${Date.now()}`;
const MEMBER_FOLDER = `mbr_${RUN}`;
const PATH = `${MEMBER_FOLDER}/${"a".repeat(32)}.webp`;
let userClient: ReturnType<typeof getTestSupabaseClient>;
let userId = "";
let bytes: Buffer;

beforeAll(async () => {
  bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#48a" } }).webp().toBuffer();
  const email = `${RUN}@example.com`;
  const password = `pw-${RUN}-Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;
  userClient = getTestSupabaseClient();
  const signedIn = await userClient.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(signedIn.error.message);
  const uploaded = await admin.storage.from("milestone-photos").upload(PATH, bytes, { contentType: "image/webp" });
  if (uploaded.error) throw new Error(uploaded.error.message);
}, 60_000);

afterAll(async () => {
  await admin.storage.from("milestone-photos").remove([PATH]);
  await admin.auth.admin.deleteUser(userId);
}, 60_000);

describe("the milestone-photos bucket", () => {
  it("is private, small and WebP only", async () => {
    const { data, error } = await admin.storage.getBucket("milestone-photos");
    expect(error).toBeNull();
    expect(data).toMatchObject({ public: false, file_size_limit: 5242880, allowed_mime_types: ["image/webp"] });
  });

  it("hands the file to the server's key", async () => {
    const { data, error } = await admin.storage.from("milestone-photos").download(PATH);
    expect(error).toBeNull();
    expect(Buffer.from(await data!.arrayBuffer())).toEqual(bytes);
  });

  it("has no public address: the public URL of a file in it does not serve it", async () => {
    const { publicUrl } = admin.storage.from("milestone-photos").getPublicUrl(PATH).data;
    const response = await fetch(publicUrl);
    expect(response.ok).toBe(false);
  });

  it("gives nothing to a visitor with no sign-in: not to read, list, sign or write", async () => {
    const visitor = getTestSupabaseClient();
    expect((await visitor.storage.from("milestone-photos").download(PATH)).error).not.toBeNull();
    expect((await visitor.storage.from("milestone-photos").createSignedUrl(PATH, 60)).error).not.toBeNull();
    const listed = await visitor.storage.from("milestone-photos").list(MEMBER_FOLDER);
    expect(listed.data ?? []).toEqual([]);
    expect((await visitor.storage.from("milestone-photos").upload(`${MEMBER_FOLDER}/${"b".repeat(32)}.webp`, bytes, { contentType: "image/webp" })).error).not.toBeNull();
  });

  it("gives nothing to a signed-in member either, not even the folder named after them", async () => {
    const bucket = userClient.storage.from("milestone-photos");
    expect((await bucket.download(PATH)).error).not.toBeNull();
    expect((await bucket.createSignedUrl(PATH, 60)).error).not.toBeNull();
    expect((await bucket.list(MEMBER_FOLDER)).data ?? []).toEqual([]);
    expect((await bucket.upload(`${MEMBER_FOLDER}/${"c".repeat(32)}.webp`, bytes, { contentType: "image/webp" })).error).not.toBeNull();
    expect((await bucket.remove([PATH])).data ?? []).toEqual([]);
    // Still there afterwards.
    expect((await admin.storage.from("milestone-photos").download(PATH)).error).toBeNull();
  });

  it("refuses to store anything but a small WebP, even for the server's key", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#48a" } }).png().toBuffer();
    expect((await admin.storage.from("milestone-photos").upload(`${MEMBER_FOLDER}/x.png`, png, { contentType: "image/png" })).error).not.toBeNull();
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    expect((await admin.storage.from("milestone-photos").upload(`${MEMBER_FOLDER}/huge.webp`, huge, { contentType: "image/webp" })).error).not.toBeNull();
  });
});
