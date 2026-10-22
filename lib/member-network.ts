/**
 * The member network graph's edges: shared prickle attendance, plus (when asked) chat interactions
 * from member_interactions (who talked with whom: replies, mentions, reactions, DMs; never what was
 * said). Pure, so the page stays thin and the weighting is tested.
 */

/** What an interaction is worth next to one shared prickle (1). A reaction is a lighter touch than writing to someone. */
export const CHAT_KIND_WEIGHTS: Record<string, number> = {
  dm: 1,
  thread_reply: 1,
  mention: 1,
  reaction: 0.5,
};

export const CHAT_KIND_LABELS: Record<string, { one: string; many: string }> = {
  dm: { one: "DM", many: "DMs" },
  thread_reply: { one: "thread reply", many: "thread replies" },
  mention: { one: "mention", many: "mentions" },
  reaction: { one: "reaction", many: "reactions" },
};

/** How much chat the graph includes: none, what happened in public channels, or everything (private channels and DMs too). */
export type ChatMode = "off" | "public" | "all";
export const CHAT_MODES: ChatMode[] = ["off", "public", "all"];
export const DEFAULT_CHAT_MODE: ChatMode = "public";

/** How far back chat counts, in days. */
export const WINDOW_DAYS = [30, 90, 365] as const;
export const DEFAULT_WINDOW_DAYS = 90;

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

export function parseChatMode(param: Param): ChatMode {
  const value = first(param);
  return CHAT_MODES.find((m) => m === value) ?? DEFAULT_CHAT_MODE;
}

export function parseWindowDays(param: Param): number {
  const value = Number(first(param));
  return (WINDOW_DAYS as readonly number[]).includes(value) ? value : DEFAULT_WINDOW_DAYS;
}

/** One row of member_interaction_pairs: how many interactions of one kind, in the open or private, between two members. */
export interface ChatPairRow {
  member_x: string;
  member_y: string;
  kind: string;
  visibility: "public" | "private";
  n: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  /** Shared prickles plus weighted chat interactions: what the edge is drawn by. */
  weight: number;
  /** Shared prickles as a percentage of the smaller member's attendance (chat has no such base, so it isn't in it). */
  normalizedWeight: number;
  prickles: number;
  /** Weighted chat interactions. */
  chat: number;
  /** Raw counts by kind, public and private together, and how many of all of them were private. */
  chatByKind: Record<string, number>;
  chatPrivate: number;
}

const pairKey = (a: string, b: string) => [a, b].sort().join("||");

/**
 * Merge prickle co-attendance (pair key -> shared prickles, per member totals) with chat pairs into
 * edges, strongest first. Only members in `activeIds` get edges. A pair with chat but no shared
 * prickles is still an edge.
 */
export function buildNetworkEdges(args: {
  prickleConnections: Map<string, number>;
  prickleTotals: Map<string, number>;
  chatPairs: ChatPairRow[];
  activeIds: Set<string>;
}): NetworkEdge[] {
  const { prickleConnections, prickleTotals, chatPairs, activeIds } = args;
  const edges = new Map<string, NetworkEdge>();

  const edgeFor = (a: string, b: string): NetworkEdge => {
    const key = pairKey(a, b);
    let edge = edges.get(key);
    if (!edge) {
      const [source, target] = key.split("||");
      edge = { source, target, weight: 0, normalizedWeight: 0, prickles: 0, chat: 0, chatByKind: {}, chatPrivate: 0 };
      edges.set(key, edge);
    }
    return edge;
  };

  for (const [key, shared] of prickleConnections) {
    const [a, b] = key.split("||");
    edgeFor(a, b).prickles = shared;
  }

  for (const row of chatPairs) {
    if (!activeIds.has(row.member_x) || !activeIds.has(row.member_y)) continue;
    const weight = CHAT_KIND_WEIGHTS[row.kind] ?? 0;
    if (weight === 0) continue;
    const edge = edgeFor(row.member_x, row.member_y);
    edge.chat += weight * row.n;
    edge.chatByKind[row.kind] = (edge.chatByKind[row.kind] ?? 0) + row.n;
    if (row.visibility === "private") edge.chatPrivate += row.n;
  }

  const result = [...edges.values()].map((edge) => {
    const smaller = Math.min(prickleTotals.get(edge.source) || 1, prickleTotals.get(edge.target) || 1);
    return {
      ...edge,
      chat: Math.round(edge.chat * 10) / 10,
      weight: Math.round((edge.prickles + edge.chat) * 10) / 10,
      normalizedWeight: edge.prickles > 0 ? Math.round((edge.prickles / smaller) * 100) : 0,
    };
  });
  return result.sort((a, b) => b.weight - a.weight);
}

/** "3 thread replies, 2 reactions", biggest first, for an edge's chat breakdown. */
export function describeChat(chatByKind: Record<string, number>): string {
  return Object.entries(chatByKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n} ${n === 1 ? (CHAT_KIND_LABELS[kind]?.one ?? kind) : (CHAT_KIND_LABELS[kind]?.many ?? kind)}`)
    .join(", ");
}
