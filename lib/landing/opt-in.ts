import { normalizeLandingData, type LandingData } from "./data";

/**
 * Where an opt-in form's sign-ups go (docs/product/LANDING_PAGES.md, "Opt-in forms"). During the move off Kajabi the only
 * implementation is Kajabi's (lib/landing/opt-in-kajabi.ts) and the Hub stores nothing; a Hub one plugs in here later.
 */
export type OptInFields = {
  name: string;
  email: string;
  /** Without the leading @, empty when not given. */
  instagram: string;
};

/** What the form's block asked for, read from the published page, never from the request. */
export type OptInTarget = {
  /** The destination's own form (for Kajabi, the form's id). */
  formId: string;
  /** Where the destination keeps the Instagram handle, or "none" to leave it out. */
  instagramField: "none" | "custom_1" | "custom_2" | "custom_3";
};

/** `invalid`: the destination refused the address or name; `unavailable`: anything else, the visitor can try again. */
export type OptInResult = { ok: true } | { ok: false; reason: "invalid" | "unavailable" };

export interface OptInDestination {
  submit(target: OptInTarget, fields: OptInFields): Promise<OptInResult>;
}

export const FORM_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const INSTAGRAM_FIELDS = ["none", "custom_1", "custom_2", "custom_3"] as const;

type Node = { type?: string; props?: Record<string, unknown> };

function* blocks(content: unknown[]): Generator<Node> {
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Node;
    yield node;
    for (const value of Object.values(node.props ?? {})) {
      // A slot holds a list of blocks.
      if (Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === "object" && "type" in (v as object) && "props" in (v as object))) {
        yield* blocks(value);
      }
    }
  }
}

/** The opt-in block on this page (published data) for a form id, or null: the relay only forwards to a form the page really shows. */
export function findOptInTarget(data: LandingData | unknown, formId: string): OptInTarget | null {
  if (!FORM_ID.test(formId)) return null;
  for (const node of blocks(normalizeLandingData(data).content)) {
    if (node.type !== "OptInForm") continue;
    const id = typeof node.props?.kajabiFormId === "string" ? node.props.kajabiFormId.trim() : "";
    if (id !== formId) continue;
    const field = node.props?.instagramField;
    return { formId: id, instagramField: INSTAGRAM_FIELDS.find((f) => f === field) ?? "none" };
  }
  return null;
}
