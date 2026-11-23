/**
 * The networks a Social icons block can link to (the `network` of a `SocialLink`). The stored value is the key, so never rename one.
 * Plain data, shared by the block, its editor field, the publish check and the Kajabi importer. The marks are drawn in `social-marks.tsx`.
 */
export const SOCIAL_NETWORKS = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  substack: "Substack",
  threads: "Threads",
  email: "Email",
  website: "Website",
} as const;

export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;

export const SOCIAL_NETWORK_OPTIONS = (Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]).map((value) => ({ label: SOCIAL_NETWORKS[value], value }));

/** The network a stored value names; anything unknown is a plain website link. */
export const socialNetworkOf = (value: unknown): SocialNetwork => (typeof value === "string" && Object.hasOwn(SOCIAL_NETWORKS, value) ? (value as SocialNetwork) : "website");
