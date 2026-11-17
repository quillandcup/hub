import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { SECURITY_EFFECTIVE, SECURITY_ITEMS, SECURITY_STATUSES } from "@/lib/security";
import { StatusLegend, TrustAside, TrustCard, TrustSection } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Security",
};

/**
 * The staff view of the Security page: the same list as `/security`, with how each thing works, where it is
 * enforced and tested, when it was last checked and what is still open. The repo is public, so the detail
 * here is public-safe by design (see `lib/security.ts`).
 */
export default async function AdminSecurityPage() {
  await requireAdminPage();

  const open = SECURITY_ITEMS.flatMap((item) => item.staff.open.map((text) => ({ item, text })));

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Security</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
        What members read on the public{" "}
        <Link href="/security" className="underline">
          Security page
        </Link>
        , with how it works, where it is enforced and what is still open.
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        List effective <time dateTime={SECURITY_EFFECTIVE}>{SECURITY_EFFECTIVE}</time>. Change a row together with the
        code (<code>lib/security.ts</code>), and move what is left open into <code>docs/TODO.md</code>.
      </p>

      <TrustAside title={`Still open (${open.length})`}>
        {open.length === 0 ? (
          <p>Nothing is marked open.</p>
        ) : (
          <ul className="list-disc pl-5 space-y-1">
            {open.map(({ item, text }) => (
              <li key={`${item.id}-${text}`}>
                <a href={`#${item.id}`} className="underline">
                  {item.title}
                </a>
                : {text}
              </li>
            ))}
          </ul>
        )}
      </TrustAside>

      <TrustAside title="Status words">
        <StatusLegend statuses={SECURITY_STATUSES} />
      </TrustAside>

      <TrustSection id="rows" title="Every row">
        <ul className="space-y-3">
          {SECURITY_ITEMS.map((item) => (
              <TrustCard key={item.id} id={item.id} title={item.title} status={item.status}>
                <p>
                  <span className="font-medium text-slate-900 dark:text-slate-100">Members read: </span>
                  {item.member}
                </p>
                <p>
                  <span className="font-medium text-slate-900 dark:text-slate-100">How it works: </span>
                  {item.staff.how}
                </p>
                <p>
                  <span className="font-medium text-slate-900 dark:text-slate-100">Where: </span>
                  {item.staff.evidence.map((where, i) => (
                    <span key={where}>
                      {i > 0 ? ", " : ""}
                      <code className="text-xs">{where}</code>
                    </span>
                  ))}
                </p>
                <p>
                  <span className="font-medium text-slate-900 dark:text-slate-100">Last checked against the code: </span>
                  <time dateTime={item.staff.checked}>{item.staff.checked}</time>
                </p>
                {item.staff.open.length > 0 ? (
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">Still open</p>
                    <ul className="list-disc pl-5 space-y-1">
                      {item.staff.open.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </TrustCard>
          ))}
        </ul>
      </TrustSection>
    </div>
  );
}
