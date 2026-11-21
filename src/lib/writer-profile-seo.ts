import type { Metadata } from "next";
import type { PublicWriterProfile } from "@/lib/data/writer-profiles";
import { writerProfileUrl } from "@/lib/writer-profile";

/** How much of the bio goes in the description search engines and link previews show. */
const DESCRIPTION_LENGTH = 155;

/** The one-line description of a page: the start of the bio, or a plain sentence when there is none. */
export function writerProfileDescription(profile: PublicWriterProfile): string {
  const bio = profile.bio?.replace(/\s+/g, " ").trim();
  if (!bio) return `${profile.name} is a writer in the Quill & Cup community.`;
  return bio.length <= DESCRIPTION_LENGTH ? bio : `${bio.slice(0, DESCRIPTION_LENGTH - 1).replace(/\s+\S*$/, "")}…`;
}

/**
 * The head of a public page: title, description, canonical address, Open Graph and Twitter card. Indexed (the page is the
 * writer's home on the web, and only exists once they switched it on); the preview passes `indexed: false`.
 */
export function writerProfileMetadata(profile: PublicWriterProfile, options: { indexed: boolean }): Metadata {
  const url = writerProfileUrl(profile.handle);
  const description = writerProfileDescription(profile);
  const images = profile.photoUrl ? [{ url: profile.photoUrl }] : undefined;
  return {
    title: profile.name,
    description,
    alternates: { canonical: url },
    robots: options.indexed ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: profile.name, description, type: "profile", url, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: profile.name, description, images: images?.map((i) => i.url) },
  };
}

/** The structured data for a page (schema.org `Person`): what the page itself shows, nothing more. */
export function writerProfileJsonLd(profile: PublicWriterProfile): Record<string, unknown> {
  const sameAs = [profile.links.instagram, profile.links.facebook, profile.links.x].filter((link): link is string => link !== null);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    url: writerProfileUrl(profile.handle),
    ...(profile.bio ? { description: profile.bio } : {}),
    ...(profile.photoUrl ? { image: profile.photoUrl } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** JSON for a `<script type="application/ld+json">`: a `<` is escaped so text in the bio can never close the tag. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
