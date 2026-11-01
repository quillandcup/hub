/**
 * What an "ideal Hedgie" looks like in an Instagram profile, as data. The scorer reads only this
 * file, so changing who we look for is a change here and nowhere else.
 *
 * These are a first guess from the Ideal Hedgie tag and the community's description, NOT yet
 * Ania's rules: `docs/PROSPECTING.md` lists the questions that replace them.
 */

export type ProspectRule = {
  id: string;
  /** Shown to the reviewer beside the score. */
  label: string;
  /** Added when it matches; negative ones subtract. */
  weight: number;
  /** Matches the lowercased bio. */
  bio?: RegExp;
  /** Matches when the prospect uses any of these hashtags (lowercase, no "#"). */
  hashtags?: string[];
};

export const PROSPECT_RULES: ProspectRule[] = [
  { id: "writing-in-progress", label: "Says they are working on a book or draft", weight: 30, bio: /\b(working on|writing) (my|a|the) (first |debut )?(book|novel|memoir|manuscript|draft|story)|\b(first draft|wip|work in progress|drafting)\b/ },
  { id: "aspiring-writer", label: "Calls themselves an aspiring or new writer", weight: 20, bio: /\b(aspiring|emerging|new|beginner|hobbyist) (writer|author|novelist|poet)\b/ },
  { id: "writer-identity", label: "Describes themselves as a writer", weight: 15, bio: /\b(writer|novelist|storyteller|poet|memoirist|author)\b/ },
  { id: "writing-community-tags", label: "Uses writing-community hashtags", weight: 15, hashtags: ["amwriting", "writingcommunity", "writersofinstagram", "writerscommunity", "writerslife", "wip", "novelwriting", "writingprompts", "amwritingfantasy", "amwritingromance"] },
  { id: "book-lover-tags", label: "Posts about books (weaker signal)", weight: 5, hashtags: ["bookstagram", "booklover", "bookish", "amreading"] },
  // Quill & Cup is women only, publicly. This is a nudge from what a person says about herself in her
  // bio, never from a name or photo, and nothing is penalized for lacking it: Ania reviews everyone.
  { id: "self-described-woman", label: "Describes herself as a woman or uses she/her", weight: 10, bio: /\bshe\s?\/\s?(her|they)\b|\b(woman|female|women'?s?) (writer|author|novelist|poet|writers|authors|fiction|writing)\b|\b(mom|mama|mother) (of|and|&)\b/ },
  { id: "sells-to-writers", label: "Sells services to writers (coach, editor, ghostwriter, publisher)", weight: -40, bio: /\b(book coach|writing coach|ghostwrit\w*|developmental editor|copy ?editor|proofread\w*|book (marketing|launch)|publishing (services|consultant)|self-?publishing (coach|expert))\b/ },
  { id: "promo-account", label: "Looks like a promo or bot account", weight: -30, bio: /\b(dm (me )?for|promo|giveaway|follow ?back|f4f|link in bio to buy)\b/ },
  { id: "established-author", label: "Established author (bestselling, many books)", weight: -15, bio: /\b(best-?selling|usa today|new york times|nyt|award-?winning) (author|novelist)\b/ },
];

/** Follower counts outside this range score down: very small is often inactive, very large is an influencer, not a peer. */
export const FOLLOWER_RANGE = { min: 100, max: 25_000, penalty: -15 };

/** A prospect at or above this is suggested for the shortlist. */
export const SHORTLIST_THRESHOLD = 40;
