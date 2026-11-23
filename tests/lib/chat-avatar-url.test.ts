import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_AVATAR_BUCKET, personPhotoUrl } from "@/lib/chat/avatar-url";
import { SLACK_AVATAR_BUCKET, slackPhotoUrl } from "@/lib/slack-avatar-url";

const db = { storage: { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.test/${bucket}/${path}` } }) }) } } as unknown as SupabaseClient;

describe("chat avatar urls", () => {
  it("uses our own copy once there is one, and the transport's address until then", () => {
    expect(personPhotoUrl(db, { image_url: "https://slack.test/a.png", image_path: "U1/abc.png" })).toBe(`https://files.test/${CHAT_AVATAR_BUCKET}/U1/abc.png`);
    expect(personPhotoUrl(db, { image_url: "https://slack.test/a.png", image_path: null })).toBe("https://slack.test/a.png");
    expect(personPhotoUrl(db, { image_url: null })).toBeNull();
  });

  it("is the same bucket and function the Slack code uses", () => {
    expect(SLACK_AVATAR_BUCKET).toBe(CHAT_AVATAR_BUCKET);
    expect(slackPhotoUrl).toBe(personPhotoUrl);
  });
});
