import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signMuxToken } from "../../__checks__/mux-token";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyBase64 = Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" })).toString("base64");
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("signMuxToken", () => {
  const base = { keyId: "kid1", privateKeyBase64, playbackId: "pb1", ttlSeconds: 300, nowMs: 1_700_000_000_000 };

  it("makes an RS256 JWT with the key id, playback id, audience and expiry Mux expects", () => {
    const [h, c, s] = signMuxToken({ ...base, type: "video" }).split(".");
    expect(decode(h)).toMatchObject({ alg: "RS256", kid: "kid1" });
    expect(decode(c)).toMatchObject({ sub: "pb1", aud: "v", exp: 1_700_000_300 });
    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it.each([
    ["video", "v"],
    ["thumbnail", "t"],
    ["storyboard", "s"],
  ] as const)("uses audience %s -> %s", (type, aud) => {
    expect(decode(signMuxToken({ ...base, type }).split(".")[1]).aud).toBe(aud);
  });
});
