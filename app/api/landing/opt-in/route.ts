import { NextRequest, NextResponse } from "next/server";
import { getServiceRepos } from "@/lib/data/server";
import { isValidSlug } from "@/lib/landing/slug";
import { findOptInTarget } from "@/lib/landing/opt-in";
import { optInDestination } from "@/lib/landing/opt-in-destination";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from "@/lib/disposable-email";
import { clientIpFrom, hitRateLimits } from "@/lib/rate-limit";

/**
 * The relay for a landing page's opt-in form (docs/LANDING_PAGES.md, "Opt-in forms"). The page's block names a form
 * and the request carries only the page address and the visitor's fields; the server looks the form up in the
 * published page, so this cannot be used to post to a form the page does not show. Nothing is stored here, and
 * neither the name nor the email reaches a log, an analytics event or Sentry. Public: no sign-in.
 */
export const maxDuration = 30;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_VISITOR = { windowSeconds: 10 * 60, maxHits: 5 };
const PER_FORM = { windowSeconds: 60 * 60, maxHits: 300 };

const reply = (body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid JSON body" }, 400);
  const input = body as Record<string, unknown>;

  // A field no person sees: a bot that fills it gets the same answer as a visitor, and nothing is sent.
  if (text(input.website, 200)) return reply({ ok: true }, 200);

  const slug = text(input.page, 100);
  const formId = text(input.formId, 64);
  const name = text(input.name, 200);
  const email = text(input.email, 254).toLowerCase();
  const instagram = text(input.instagram, 80)
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .replace(/\/+$/, "");
  if (!isValidSlug(slug) || !formId || !name) return reply({ error: "Please add your name and email." }, 400);
  if (!EMAIL.test(email)) return reply({ error: "That email address doesn't look right." }, 400);
  if (isDisposableEmail(email)) return reply({ error: DISPOSABLE_EMAIL_MESSAGE }, 422);
  if (instagram &&!/^[A-Za-z0-9._]{1,30}$/.test(instagram)) return reply({ error: "That Instagram handle doesn't look right." }, 400);

  const repos = getServiceRepos();
  const allowed = await hitRateLimits(repos, [
    { bucket: `landing_opt_in:ip:${clientIpFrom(request.headers)}`, ...PER_VISITOR },
    { bucket: `landing_opt_in:form:${slug}:${formId}`, ...PER_FORM },
  ]);
  if (!allowed) return reply({ error: "Too many tries. Please wait a little and try again." }, 429, { "Retry-After": String(PER_VISITOR.windowSeconds) });

  const page = await repos.landingPages.published(slug).catch(() => null);
  const target = page ? findOptInTarget(page.data, formId) : null;
  if (!target) return reply({ error: "This form isn't available." }, 404);

  const result = await optInDestination.current.submit(target, { name, email, instagram });
  if (result.ok) return reply({ ok: true }, 200);
  if (result.reason === "invalid") return reply({ error: "Please check your name and email address." }, 422);
  return reply({ error: "We couldn't sign you up just now. Please try again in a little while." }, 502);
}
