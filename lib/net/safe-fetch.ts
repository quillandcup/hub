import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import appConfig from "../../app.config";
import { clock } from "@/lib/clock";
import { APP_URL, SUPPORT_EMAIL } from "@/lib/config";

/**
 * Fetching an address somebody else chose (a Slack app's picture, a book cover a member typed) without letting it reach
 * anything of ours. The rules, in one place so each caller gets all of them:
 *  - http(s) only (`https` only unless the caller allows plain http), ports 80 and 443 only;
 *  - the name is resolved once, every answer must be a public address, and the connection is made to that address
 *    (`lookup` pinned), so a DNS server that answers differently the second time (rebinding) gets nothing; the host
 *    name still travels in the Host header and the TLS server name;
 *  - redirects are followed by hand, a few, and every hop goes through the same checks;
 *  - a size cap enforced while streaming, a time budget (`lib/clock.ts`), no cookies, no referrer, no compression.
 * Nothing about the other end is returned except the bytes and a content type we derived ourselves.
 */

export const DEFAULT_MAX_REDIRECTS = 3;

export type Resolve = (host: string) => Promise<{ address: string }[]>;

/** One request to one pinned address: what a transport needs, and nothing it should decide itself. */
export interface TransportRequest {
  url: URL;
  /** The address to connect to; the URL's host is only for Host and TLS. */
  address: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Whether an address is somewhere on the open internet: not this machine, not a private or link-local network. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    // IPv4 inside IPv6: `::ffff:10.0.0.1`, and the hex form `::ffff:a00:1` that URL parsing turns it into.
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (dotted) return isPublicAddress(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = a.split(":")[0];
    return !(a === "::" || a === "::1" || /^fe[89ab]/.test(first) || /^f[cdf]/.test(first) || a.startsWith("64:ff9b:") || a.startsWith("2001:db8:"));
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
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Why an address was refused, or the address to connect to. */
export type HostCheck = { address: string } | { problem: string };

export async function checkHost(url: URL, resolve: Resolve, opts: { allowHttp: boolean } = { allowHttp: true }): Promise<HostCheck> {
  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) return { problem: opts.allowHttp ? "not an http(s) link" : "not an https link" };
  if (url.username || url.password) return { problem: "address has credentials" };
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) return { problem: "unusual port" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return { problem: "not a public address" };
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host).catch(() => []);
  if (addresses.length === 0) return { problem: "the address doesn't resolve" };
  if (!addresses.every((a) => isPublicAddress(a.address))) return { problem: "not a public address" };
  return { address: addresses[0].address };
}

const defaultResolve: Resolve = (host) => dnsLookup(host, { all: true });

/** The real transport: Node's own http(s) client, with name lookup replaced by the pinned address. */
export const nodeTransport: Transport = ({ url, address, headers, signal }) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const family = isIP(address);
    const req = client.request(
      url,
      {
        method: "GET",
        headers,
        signal,
        agent: false, // no pooled sockets: each request connects to its own pinned address
        lookup: (_host, options, callback) => {
          if (options && typeof options === "object" && options.all) (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          else (callback as (e: null, a: string, f: number) => void)(null, address, family);
        },
      },
      (res) => {
        const flat: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) flat[k] = Array.isArray(v) ? v[0] : v;
        resolve({ status: res.statusCode ?? 0, headers: flat, body: res, destroy: () => res.destroy() });
      }
    );
    req.on("error", reject);
    req.end();
  });

let hooks: { resolve: Resolve; transport: Transport } = { resolve: defaultResolve, transport: nodeTransport };

/** Tests swap the name lookup and the socket; call with no argument to restore both. */
export function setNetHooks(next?: Partial<typeof hooks>): void {
  hooks = { resolve: next?.resolve ?? defaultResolve, transport: next?.transport ?? nodeTransport };
}

export type SafeGetFailure = "invalid_url" | "blocked" | "too_many_redirects" | "bad_status" | "too_large" | "timeout" | "network";

export type SafeGetResult =
  | { ok: true; bytes: Buffer; contentType: string | null; finalUrl: string }
  | { ok: false; reason: SafeGetFailure; detail: string; /** The upstream HTTP status behind a bad_status, when there was one. */ status?: number };

/**
 * Who we say we are to a server that isn't ours. Some hosts (Wikimedia) refuse a request with no User-Agent and ask for
 * one that names the app and a contact; it carries nothing about the member.
 */
export const DEFAULT_USER_AGENT = `${appConfig.appName.replace(/[^\w .-]/g, "").replace(/ +/g, " ")}/1.0 (+${APP_URL}; ${SUPPORT_EMAIL})`;

export interface SafeGetOptions {
  /** Sent on every hop; defaults to DEFAULT_USER_AGENT. */
  userAgent?: string;
  maxBytes: number;
  timeoutMs: number;
  allowHttp?: boolean;
  maxRedirects?: number;
  accept?: string;
  /** Called with each response's headers before the body is read; return false to stop (no body is downloaded). */
  acceptResponse?: (headers: Record<string, string | undefined>) => boolean;
  /** After `acceptResponse`: return false to succeed without downloading the body (the headers were the answer; `bytes` is empty). */
  wantBody?: (headers: Record<string, string | undefined>) => boolean;
  /** Past `maxBytes`, stop reading and return what was read, instead of failing (a page's head is all that is wanted). */
  truncate?: boolean;
}

/** GET an address that is not ours to trust. Never throws. */
export async function safeGet(input: string | URL, opts: SafeGetOptions): Promise<SafeGetResult> {
  const { resolve, transport } = hooks;
  const deadline = clock.now() + opts.timeoutMs;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs);
  const fail = (reason: SafeGetFailure, detail: string): SafeGetResult => ({ ok: false, reason, detail });
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fail("invalid_url", "not a valid link");
  }
  let response: TransportResponse | null = null;
  try {
    for (let hop = 0; hop <= (opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS); hop++) {
      const checked = await checkHost(url, resolve, { allowHttp: opts.allowHttp ?? false });
      if ("problem" in checked) return fail("blocked", checked.problem);
      if (clock.now() > deadline) return fail("timeout", "ran out of time");
      response = await transport({
        url,
        address: checked.address,
        // No cookies, no referrer, nothing of ours; no compression so the size cap counts what is stored.
        headers: { accept: opts.accept ?? "*/*", "accept-encoding": "identity", "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT },
        signal: abort.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        response.destroy();
        if (!location) return fail("bad_status", `redirected (HTTP ${response.status}) without saying where`);
        try {
          url = new URL(location, url);
        } catch {
          return fail("invalid_url", "redirected to something that isn't a link");
        }
        response = null;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        return { ok: false, reason: "bad_status", detail: `HTTP ${response.status}`, status: response.status };
      }
      if (opts.acceptResponse && !opts.acceptResponse(response.headers)) {
        response.destroy();
        return fail("bad_status", "not what was asked for");
      }
      if (opts.wantBody && !opts.wantBody(response.headers)) {
        response.destroy();
        return { ok: true, bytes: Buffer.alloc(0), contentType: response.headers["content-type"] ?? null, finalUrl: url.href };
      }
      const declared = Number(response.headers["content-length"]);
      if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
        response.destroy();
        return fail("too_large", "larger than the limit");
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > opts.maxBytes && opts.truncate) {
          chunks.push(chunk.subarray(0, chunk.length - (total - opts.maxBytes)));
          response.destroy();
          break;
        }
        if (total > opts.maxBytes) {
          response.destroy();
          return fail("too_large", "larger than the limit");
        }
        if (clock.now() > deadline) {
          response.destroy();
          return fail("timeout", "ran out of time");
        }
        chunks.push(chunk);
      }
      return { ok: true, bytes: Buffer.concat(chunks), contentType: response.headers["content-type"] ?? null, finalUrl: url.href };
    }
    return fail("too_many_redirects", "too many redirects");
  } catch {
    response?.destroy();
    return abort.signal.aborted ? fail("timeout", "ran out of time") : fail("network", "couldn't download it");
  } finally {
    clearTimeout(timer);
  }
}

// ---- images ------------------------------------------------------------------------------------------------------

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";

/** The image type the first bytes say it is, or null. SVG is deliberately not here: it can carry script. */
export function sniffImageType(b: Uint8Array): ImageType | null {
  const at = (i: number, s: string) => s.split("").every((ch, k) => b[i + k] === ch.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (b.length >= 12 && at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "image/avif";
  return null;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;

export type FetchImageResult = { ok: true; bytes: Buffer; contentType: ImageType } | { ok: false; reason: SafeGetFailure | "not_image"; detail: string; status?: number };

/**
 * A picture from an address we didn't choose: https only, at most 5 MB, one of the allowed raster types decided by the
 * bytes (a server's Content-Type is not believed, and SVG is refused).
 */
export async function fetchImage(url: string | URL, opts: { userAgent?: string } = {}): Promise<FetchImageResult> {
  const got = await safeGet(url, { userAgent: opts.userAgent, maxBytes: MAX_IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, allowHttp: false, accept: "image/png,image/jpeg,image/gif,image/webp,image/avif" });
  if (!got.ok) return got;
  const contentType = sniffImageType(got.bytes);
  return contentType ? { ok: true, bytes: got.bytes, contentType } : { ok: false, reason: "not_image", detail: "not an allowed image type" };
}

// ---- pages -------------------------------------------------------------------------------------------------------

export const MAX_PAGE_BYTES = 512 * 1024;
export const PAGE_TIMEOUT_MS = 8_000;

export type FetchPageResult =
  | { ok: true; kind: "html"; bytes: Buffer; contentType: string; finalUrl: string }
  /** The address is itself a picture (the headers said so; nothing was downloaded). The picture route checks the bytes when it is shown. */
  | { ok: true; kind: "image"; finalUrl: string }
  | { ok: false; reason: SafeGetFailure; detail: string };

const IMAGE_TYPE = /^image\/(png|jpeg|gif|webp|avif)\s*(;|$)/i;
const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)\s*(;|$)/i;

/**
 * A web page somebody linked, for its preview: https only, text/html (or a direct raster picture, answered from the headers
 * alone), at most the first 512 KB (the head of a page comes first; the rest is dropped, not an error), every redirect re-checked.
 */
export async function fetchPage(url: string | URL): Promise<FetchPageResult> {
  const got = await safeGet(url, {
    maxBytes: MAX_PAGE_BYTES,
    timeoutMs: PAGE_TIMEOUT_MS,
    allowHttp: false,
    accept: "text/html,application/xhtml+xml,image/png,image/jpeg,image/gif,image/webp,image/avif",
    truncate: true,
    acceptResponse: (h) => HTML_TYPE.test(h["content-type"] ?? "") || IMAGE_TYPE.test(h["content-type"] ?? ""),
    wantBody: (h) => !IMAGE_TYPE.test(h["content-type"] ?? ""),
  });
  if (!got.ok) return got;
  if (IMAGE_TYPE.test(got.contentType ?? "")) return { ok: true, kind: "image", finalUrl: got.finalUrl };
  return { ok: true, kind: "html", bytes: got.bytes, contentType: got.contentType ?? "text/html", finalUrl: got.finalUrl };
}
