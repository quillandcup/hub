import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import MemberSocialLinks from "@/components/member/MemberSocialLinks";
import type { PublicWriterProfile } from "@/lib/data/writer-profiles";
import { SITE_URL } from "@/lib/config";
import { jsonLdScript, writerProfileJsonLd } from "@/lib/writer-profile-seo";

/**
 * A writer profile (docs/product/WRITER_PROFILES.md): the name, and the photo, bio and social links they opened to the internet. Made only
 * from `PublicWriterProfile`, which holds nothing else, so no other field can end up here. The bio is plain text (React
 * escapes it; line breaks are kept by the style). `banner` is the member-only preview's note above the page.
 */
export default function WriterProfileView({ profile, banner }: { profile: PublicWriterProfile; banner?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      {banner}
      <main className="mx-auto max-w-2xl px-6 py-12 sm:py-16">
        <article className="rounded-lg bg-white p-6 shadow dark:bg-slate-900 sm:p-10">
          <header className="flex flex-col items-center gap-4 text-center">
            {profile.photoUrl && <MemberAvatar name={profile.name} photoUrl={profile.photoUrl} size={112} />}
            <h1 className="font-display text-3xl font-bold text-slate-900 dark:text-slate-100 sm:text-4xl">{profile.name}</h1>
          </header>
          {profile.bio && <p className="mt-8 whitespace-pre-line break-words text-base leading-relaxed text-slate-700 dark:text-slate-300">{profile.bio}</p>}
          <MemberSocialLinks className="mt-6 justify-center" instagramUrl={profile.links.instagram} facebookUrl={profile.links.facebook} twitterUrl={profile.links.x} />
        </article>
      </main>
      <footer className="px-6 pb-10 text-center text-sm text-slate-600 dark:text-slate-400">
        <a href={SITE_URL} className="underline hover:text-plum-700 dark:hover:text-plum-300">
          Quill &amp; Cup
        </a>{" "}
        · a community of writers
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(writerProfileJsonLd(profile)) }} />
    </div>
  );
}
