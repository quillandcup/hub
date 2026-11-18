import type { ReactNode } from "react";
import Link from "next/link";
import type { ComplianceStatus } from "@/lib/compliance";
import { RichText, StatusLegend, TrustAside, TrustCard, TrustSection } from "@/components/trust/Trust";

/**
 * The staff side of a trust page (`/admin/security`, `/admin/compliance`, `/admin/privacy`): the same rows
 * members read, with how each works, where it is enforced, when it was last checked and what is still open.
 * One component, so the three staff pages look and behave alike. The repo is public, so what a row carries
 * is public-safe by design (see `lib/security.ts`).
 */
export interface StaffRow {
  id: string;
  title: string;
  status: ComplianceStatus;
  /** What the row is, in a few words (Compliance rows have one). */
  about?: string;
  /** What members read on the public page. */
  member: string;
  /** How it works, for the team (Security rows have one). */
  how?: string;
  evidence: readonly string[];
  /** YYYY-MM-DD, Eastern. */
  checked: string;
  open: readonly string[];
}

const LABEL = "font-medium text-slate-900 dark:text-slate-100";

/**
 * The page frame of a staff trust page: the same container the other admin pages use (padding, centred, a readable
 * width), then the title. One component, so Compliance, Privacy and Security can't drift apart.
 */
export function StaffPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      {children}
    </div>
  );
}

export function StaffIntro({ publicHref, publicName, listFile, effective }: { publicHref: string; publicName: string; listFile: string; effective: string }) {
  return (
    <>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
        What members read on the public{" "}
        <Link href={publicHref} className="underline">
          {publicName} page
        </Link>
        , with where it is enforced, when it was last checked and what is still open.
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        List effective <time dateTime={effective}>{effective}</time>. Change a row together with the code (<code>{listFile}</code>), and
        move what is left open into <code>docs/TODO.md</code>.
      </p>
    </>
  );
}

/** Every open item across the rows, each linking to its row. */
export function OpenSummary({ rows }: { rows: readonly StaffRow[] }) {
  const open = rows.flatMap((row) => row.open.map((text) => ({ row, text })));
  return (
    <TrustAside title={`Still open (${open.length})`}>
      {open.length === 0 ? (
        <p>Nothing is marked open.</p>
      ) : (
        <ul className="list-disc pl-5 space-y-1">
          {open.map(({ row, text }) => (
            <li key={`${row.id}-${text}`}>
              <a href={`#${row.id}`} className="underline">
                {row.title}
              </a>
              : <RichText text={text} />
            </li>
          ))}
        </ul>
      )}
    </TrustAside>
  );
}

export function StatusKey({ statuses }: { statuses: readonly ComplianceStatus[] }) {
  return (
    <TrustAside title="Status words">
      <StatusLegend statuses={statuses} />
    </TrustAside>
  );
}

/** The rows of one group (or the whole list), as cards. */
export function StaffRows({ id, title, intro, rows }: { id: string; title: string; intro?: string; rows: readonly StaffRow[] }) {
  return (
    <TrustSection id={id} title={title}>
      {intro ? (
        <p className="text-sm">
          <RichText text={intro} />
        </p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <TrustCard key={row.id} id={row.id} title={row.title} status={row.status} about={row.about}>
            <p>
              <span className={LABEL}>Members read: </span>
              <RichText text={row.member} />
            </p>
            {row.how ? (
              <p>
                <span className={LABEL}>How it works: </span>
                <RichText text={row.how} />
              </p>
            ) : null}
            <p>
              <span className={LABEL}>Where: </span>
              {row.evidence.map((where, i) => (
                <span key={where}>
                  {i > 0 ? ", " : ""}
                  <code className="text-xs">{where}</code>
                </span>
              ))}
            </p>
            <p>
              <span className={LABEL}>Last checked against the code: </span>
              <time dateTime={row.checked}>{row.checked}</time>
            </p>
            {row.open.length > 0 ? (
              <div>
                <p className={LABEL}>Still open</p>
                <ul className="list-disc pl-5 space-y-1">
                  {row.open.map((text) => (
                    <li key={text}>
                      <RichText text={text} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </TrustCard>
        ))}
      </ul>
    </TrustSection>
  );
}
