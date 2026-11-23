/**
 * The networks a Social icons block can link to (the `network` of a `SocialLink`). The stored value is the key, so never rename one.
 * Plain data, shared by the block, its editor field, the publish check and the Kajabi importer. The marks are in `brand-icons.generated.ts` and `brand-icons.drawn.ts`, drawn by `social-marks.tsx`.
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

/**
 * How the marks are drawn: `colour` (each network's own colour on a light round badge, the default), `dark` (the network's black version,
 * no badge, for a light background) or `light` (the white version, no badge, for a dark one). No other colours: a brand's mark is not recoloured.
 * A page can be seen in the app's dark mode, so the default is the one that reads on every surface; dark and light are a choice for a known background.
 */
export const SOCIAL_LOOKS = { colour: "Colour (on a light badge)", dark: "Dark (black, no badge, for light backgrounds)", light: "Light (white, no badge, for dark backgrounds)" } as const;
export type SocialLook = keyof typeof SOCIAL_LOOKS;
export const SOCIAL_LOOK_OPTIONS = (Object.keys(SOCIAL_LOOKS) as SocialLook[]).map((value) => ({ label: SOCIAL_LOOKS[value], value }));
/** The look a stored value names; anything unknown is the default. */
export const socialLookOf = (value: unknown): SocialLook => (typeof value === "string" && Object.hasOwn(SOCIAL_LOOKS, value) ? (value as SocialLook) : "colour");
