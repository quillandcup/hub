import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/config";
import {
  COMPLIANCE_EFFECTIVE,
  COMPLIANCE_GROUPS,
  COMPLIANCE_PROVIDERS,
  COMPLIANCE_STATUSES,
  type ComplianceStatus,
} from "@/lib/compliance";

export const metadata: Metadata = {
  title: "Compliance",
};

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  inPlace: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  provider: "bg-plum-100 text-plum-800 dark:bg-plum-900 dark:text-plum-300",
  working: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  review: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  notApplicable: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

/**
 * The laws, standards and frameworks the Hub follows, relies on a provider for, or is working toward.
 * Public like `/privacy`: anyone can read it. The list lives in `lib/compliance.ts`, and every line must
 * be true of the code, so change them together.
 */
export default async function CompliancePage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <div className="container mx-auto px-6 py-6 max-w-5xl">
        <p className="mb-4 text-sm">
          <Link href={user ? "/dashboard" : "/login"} className="text-plum-700 dark:text-plum-300 underline">
            {user ? "Back to the Hub" : "Sign in to the Hub"}
          </Link>
        </p>
        <h1 className="text-2xl font-bold mb-1">Compliance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
          The laws, standards and frameworks we follow, the ones a provider handles for us, and the ones we are still working toward.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Effective <time dateTime={COMPLIANCE_EFFECTIVE}>{COMPLIANCE_EFFECTIVE}</time>.
        </p>

        <aside className="mb-8 rounded-lg border border-plum-200 dark:border-plum-800 bg-plum-50 dark:bg-plum-950/30 p-4 text-sm text-slate-800 dark:text-slate-200">
          <h2 className="text-base font-semibold mb-2">How to read this page</h2>
          <p className="mb-2">
            We say what we do, not that we hold a certificate we don&apos;t. Where a provider holds the certification (for
            example, Stripe for card payments), the row says so. Where we haven&apos;t finished or haven&apos;t looked yet, it says that too.
          </p>
          <ul className="space-y-1">
            {Object.keys(COMPLIANCE_STATUSES).map((key) => (
              <li key={key}>
                <StatusPill status={key as ComplianceStatus} /> {STATUS_MEANING[key as ComplianceStatus]}
              </li>
            ))}
          </ul>
        </aside>

        <nav aria-label="On this page" className="mb-8 text-sm">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-plum-700 dark:text-plum-300">
            {COMPLIANCE_GROUPS.map((group) => (
              <li key={group.id}>
                <a href={`#${group.id}`} className="underline">
                  {group.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#providers" className="underline">
                Services we rely on
              </a>
            </li>
          </ul>
        </nav>

        {COMPLIANCE_GROUPS.map((group) => (
          <Section key={group.id} id={group.id} title={group.title}>
            <p className="text-sm">{group.intro}</p>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <li
                  key={item.name}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-4"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.name}</h3>
                    <StatusPill status={item.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.about}</p>
                  <p className="mt-2 text-sm">{item.detail}</p>
                </li>
              ))}
            </ul>
          </Section>
        ))}

        <Section id="providers" title="Services we rely on">
          <p className="text-sm">
            Some of the above rests on the services the Hub is built on. The{" "}
            <Link href="/privacy#services" className="underline">
              Privacy page
            </Link>{" "}
            lists all of them and what they receive.
          </p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-4 font-semibold">Service</th>
                <th className="py-2 pr-4 font-semibold">What it does</th>
                <th className="py-2 font-semibold">What it covers</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {COMPLIANCE_PROVIDERS.map((provider) => (
                <tr key={provider.name} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">{provider.name}</td>
                  <td className="py-2 pr-4">{provider.role}</td>
                  <td className="py-2">{provider.covers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <p className="mb-10 text-sm text-slate-700 dark:text-slate-300">
          Questions, or something here that doesn&apos;t look right? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          . This page describes what we do. It is not legal advice and not a certificate.
        </p>
      </div>
    </div>
  );
}

const STATUS_MEANING: Record<ComplianceStatus, string> = {
  inPlace: "We do this ourselves, and you can check it in the Hub.",
  provider: "A provider we use holds the certification or does the work.",
  working: "Partly there. The row says what is still open.",
  review: "We haven't reviewed it yet.",
  notApplicable: "Doesn't apply to the Hub, or we don't hold it.",
};

function StatusPill({ status }: { status: ComplianceStatus }) {
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[status]}`}>
      {COMPLIANCE_STATUSES[status]}
    </span>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 space-y-3 text-slate-700 dark:text-slate-300 scroll-mt-6">
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">{title}</h2>
      {children}
    </section>
  );
}
