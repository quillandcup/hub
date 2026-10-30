import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A cover that is a link to somewhere else is read at most this large, and for at most this long. */
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const OWN_BUCKET = "book-covers";

export type FetchedCover = { bytes: Buffer } | { error: string };
export type Lookup = (host: string) => Promise<{ address: string }[]>;

/** Whether an address is somewhere on the open internet: not this machine, not a private or link-local network. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPublicAddress(mapped[1]);
    const first = a.split(":")[0];
    return !(a === "::" || a === "::1" || /^fe[89ab]/.test(first) || /^f[cdf]/.test(first));
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0)
  );
}

async function checkHost(url: URL, lookup: Lookup): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "not an http(s) link";
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return "unusual port";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "not a public address";
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host).catch(() => []);
  if (addresses.length === 0) return "the address doesn't resolve";
  return addresses.every((a) => isPublicAddress(a.address)) ? null : "not a public address";
}

async function readLimited(res: Response): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      void reader.cancel().catch(() => {}); // stop the download; don't wait for the other end to agree
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * The picture behind an older book cover's link. A cover in our own `book-covers` bucket is read from storage;
 * any other link is fetched from the internet with the care a link a member typed deserves: http(s) on the usual
 * ports only, never an address on this machine or a private network (checked again on every redirect, of which it
 * follows a few), a size limit and a time limit. What comes back is still only kept if it decodes as an image
 * (`inspectImage`). The address is checked, then fetched, so a hostile DNS server could still answer differently
 * the second time: this is for a script an admin runs, not for a request a visitor makes. `storage` needs the
 * service role.
 */
export async function fetchLegacyCover(
  storage: SupabaseClient["storage"],
  supabaseUrl: string,
  coverUrl: string,
  lookup: Lookup = (host) => dnsLookup(host, { all: true })
): Promise<FetchedCover> {
  const ownPrefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${OWN_BUCKET}/`;
  if (coverUrl.startsWith(ownPrefix)) {
    const { data, error } = await storage.from(OWN_BUCKET).download(decodeURIComponent(coverUrl.slice(ownPrefix.length).split("?")[0]));
    if (error || !data) return { error: "the file is gone from the book-covers bucket" };
    return { bytes: Buffer.from(await data.arrayBuffer()) };
  }

  let url: URL;
  try {
    url = new URL(coverUrl);
  } catch {
    return { error: "not a valid link" };
  }
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const problem = await checkHost(url, lookup);
      if (problem) return { error: problem };
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/*" } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return { error: `redirected (HTTP ${res.status}) without saying where` };
        url = new URL(location, url);
        continue;
      }
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const bytes = await readLimited(res);
      return bytes ? { bytes } : { error: `larger than ${MAX_BYTES / (1024 * 1024)} MB` };
    }
    return { error: "too many redirects" };
  } catch {
    return { error: "couldn't download it" };
  }
}
