/**
 * Where a request came from, for the access log (access_events: `ip_address`, `country`, `region`,
 * `city`). The place is Vercel's edge geolocation (`x-vercel-ip-*` headers, present only on a Vercel
 * deployment, so locally these are all null); the IP is the first `x-forwarded-for` hop.
 *
 * Everything is validated and capped here because the rows are inserted as the signed-in user and the
 * headers are client-influenced: a value the database CHECKs would refuse must become null, never an
 * error that loses the whole access event.
 */

export interface RequestLocation {
  ip_address: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
// Hex groups and colons (and a trailing IPv4 for mapped addresses); Postgres makes the final call on shape.
const IPV6 = /^[0-9a-fA-F:]{2,45}(?:\.\d{1,3}){0,3}$/;

const MAX_CITY = 100;
const MAX_REGION = 10;

/** A single address from a header value, without a port, or null if it isn't one. */
export function parseIp(raw: string | null | undefined): string | null {
  let value = raw?.trim();
  if (!value) return null;
  // "[2001:db8::1]:443" and "203.0.113.7:51234"
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  if (IPV4.test(value)) return value;
  if (value.includes(":") && IPV6.test(value) && value.split(":").length <= 8) return value;
  return null;
}

/** The text of a Vercel geo header: URL-decoded (the city is RFC 3986 encoded), trimmed, capped, or null. */
function geoText(raw: string | null, max: number): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Not valid percent-encoding: use it as sent.
  }
  // eslint-disable-next-line no-control-regex -- strip control characters from a client-influenced header
  value = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  return value ? value.slice(0, max) : null;
}

export function requestLocation(headers: Headers): RequestLocation {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  const ip = parseIp(forwarded) ?? parseIp(headers.get("x-real-ip"));

  const countryRaw = headers.get("x-vercel-ip-country")?.trim().toUpperCase() ?? null;
  const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;

  return {
    ip_address: ip,
    country,
    region: geoText(headers.get("x-vercel-ip-country-region"), MAX_REGION),
    city: geoText(headers.get("x-vercel-ip-city"), MAX_CITY),
  };
}
