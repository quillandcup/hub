/**
 * Runs the policy the proxy enforces through Google's CSP Evaluator (the engine behind csp-evaluator.withgoogle.com, the npm package
 * `csp_evaluator`), so a change that weakens it fails here instead of being found on the website after a deploy. It is strict on
 * purpose: the policy has no findings at all, so any new one, even an informational one, fails and has to be looked at (fix the
 * policy, or accept the finding here with a reason).
 *
 * Only the policy for pages is checked. The one the proxy-skipped paths get (static files and pictures, `buildCsp`) has no `script-src`
 * on purpose: nothing there is a page.
 */
import { describe, expect, it } from "vitest";
import { CspEvaluator } from "csp_evaluator/dist/evaluator.js";
import { CspParser } from "csp_evaluator/dist/parser.js";
import appConfig from "../../config/app";
import { enforcedCsp, generateNonce } from "@/lib/csp";

const DSN = "https://publickey123@o123456.ingest.de.sentry.io/4510000000";
const findings = (policy: string) => new CspEvaluator(new CspParser(policy).csp).evaluate().map((f) => `${f.directive}: ${f.description}`);

describe("the policy for pages, as Google's CSP Evaluator reads it", () => {
  const policy = enforcedCsp({
    nonce: generateNonce(),
    supabaseUrl: "https://project.supabase.co/",
    imageHosts: appConfig.csp.imageHosts,
    connectHosts: appConfig.csp.connectHosts,
    frameHosts: appConfig.csp.frameHosts,
    mediaHosts: appConfig.csp.mediaHosts,
    sentryDsn: DSN,
  });

  it("has no findings", () => {
    expect(findings(policy)).toEqual([]);
  });

  // Without these, a broken import or filter would make the test above pass by finding nothing.
  it("does catch weaker policies (the check is not vacuous)", () => {
    expect(findings("img-src 'self'; object-src 'none'; base-uri 'none'")).toContain("script-src: script-src directive is missing.");
    expect(findings(policy.replace(/script-src [^;]*/, "script-src 'unsafe-inline' https:")).length).toBeGreaterThan(0);
    expect(findings(policy.replace(/script-src [^;]*/, "script-src 'self' https://www.googletagmanager.com")).length).toBeGreaterThan(0);
    expect(findings(policy.replace("object-src 'none'; ", "")).length).toBeGreaterThan(0);
  });
});
