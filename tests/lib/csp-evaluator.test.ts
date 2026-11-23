/**
 * Runs the policy the proxy enforces through Google's CSP Evaluator (the engine behind csp-evaluator.withgoogle.com, the npm package
 * `csp_evaluator`), so a change that weakens it fails here instead of being found on the website after a deploy. Everything it reports
 * above "info" fails, from a missing `script-src` to `'unsafe-inline'`, a wildcard host or a known script-bypass host.
 *
 * Only the policy for pages is checked. The one the proxy-skipped paths get (static files and pictures, `buildCsp`) has no `script-src`
 * on purpose: nothing there is a page.
 */
import { describe, expect, it } from "vitest";
import { CspEvaluator } from "csp_evaluator/dist/evaluator.js";
import { CspParser } from "csp_evaluator/dist/parser.js";
import { Severity } from "csp_evaluator/dist/finding.js";
import appConfig from "../../config/app";
import { enforcedCsp, generateNonce, reportOnlyCsp } from "@/lib/csp";

const DSN = "https://publickey123@o123456.ingest.de.sentry.io/4510000000";
const evaluate = (policy: string) => new CspEvaluator(new CspParser(policy).csp).evaluate();
const problems = (policy: string) =>
  evaluate(policy)
    .filter((f) => f.severity < Severity.INFO)
    .map((f) => `${f.directive}: ${f.description}`);

describe("the policy for pages, as Google's CSP Evaluator reads it", () => {
  const inputs = { supabaseUrl: "https://project.supabase.co/", imageHosts: appConfig.csp.imageHosts, sentryDsn: DSN };

  it("has nothing above info severity", () => {
    expect(problems(enforcedCsp({ ...inputs, nonce: generateNonce() }))).toEqual([]);
  });

  it("is the same with the connection, frame, media and font sources added (what is enforced next)", () => {
    const next = `${enforcedCsp({ ...inputs, nonce: generateNonce() })}; ${reportOnlyCsp({
      ...inputs,
      connectHosts: appConfig.csp.connectHosts,
      frameHosts: appConfig.csp.frameHosts,
      mediaHosts: appConfig.csp.mediaHosts,
    }).replace(/; report-uri .*$/, "")}`;

    expect(problems(next)).toEqual([]);
  });

  it("does catch a weaker policy (the check is not vacuous)", () => {
    expect(problems("img-src 'self'; object-src 'none'; base-uri 'none'")).toContain("script-src: script-src directive is missing.");
    expect(problems("script-src 'unsafe-inline' https:; object-src 'none'; base-uri 'none'").length).toBeGreaterThan(0);
  });
});
