import { createKajabiClient } from "@/lib/kajabi/client";
import type { OptInDestination, OptInFields, OptInResult, OptInTarget } from "./opt-in";

/**
 * Kajabi's public API: `POST /v1/forms/{id}/submit` with a name and an email (Kajabi checks deliverability and handles
 * double opt-in, tags, offers, sequences and automations). Uses the same client credentials as the Kajabi imports.
 * Nothing about the person is logged here or in the client's `submitForm`.
 */
export class KajabiOptInDestination implements OptInDestination {
  async submit(target: OptInTarget, fields: OptInFields): Promise<OptInResult> {
    const attributes: Record<string, string> = { name: fields.name, email: fields.email };
    if (target.instagramField !== "none" && fields.instagram) attributes[target.instagramField] = fields.instagram;
    try {
      const status = await createKajabiClient().submitForm(target.formId, attributes);
      if (status >= 200 && status < 300) return { ok: true };
      if (status === 400 || status === 422) return { ok: false, reason: "invalid" };
      console.error("[opt-in] Kajabi answered HTTP %d", status);
    } catch (error) {
      // The error's name only: a message could carry a response body, which can echo the address.
      console.error("[opt-in] Kajabi submit failed:", error instanceof Error ? error.name : "error");
    }
    return { ok: false, reason: "unavailable" };
  }
}
