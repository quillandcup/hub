import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import WriterPageView from "@/components/writer/WriterPageView";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createClient } from "@/lib/supabase/server";

/** Never indexed, and only for a signed-in member: it can show a page that is still off. */
export const metadata: Metadata = { title: "Preview of your page", robots: { index: false, follow: false } };

/**
 * "View as a visitor" (docs/WRITER_PROFILES.md): the member's own page as the public would see it, whether or not it is switched
 * on, built by the same repository read the public route uses so what they see is what visitors get. For the effective
 * identity, so sudo previews the member's page. Member-only (the layout signs people in) and noindex.
 */
export default async function WriterPagePreview() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");

  const [profile, settings] = await Promise.all([
    getServiceRepos().writerProfiles.previewOfMember(identity.memberId),
    createRepos(await createClient()).writerProfiles.ofMember(identity.memberId),
  ]);

  if (!profile || !settings) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12 text-sm text-slate-700 dark:text-slate-300">
        <p>You have not chosen an address for your page yet.</p>
        <p className="mt-2">
          <Link href="/settings/profile" className="underline text-plum-700 dark:text-plum-300">
            Set it up in Settings
          </Link>
        </p>
      </main>
    );
  }

  return (
    <WriterPageView
      profile={profile}
      banner={
        <div role="status" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          This is a preview, the way a visitor sees your page.{" "}
          {settings.isPublic ? "Your page is on: anyone can open it." : "Your page is off: only you can see this."}{" "}
          <Link href="/settings/profile" className="underline">
            Back to settings
          </Link>
        </div>
      }
    />
  );
}
