import { createKajabiClient } from "@/lib/kajabi/client";
import { refreshKajabiContactInBronze } from "@/lib/kajabi/contact-refresh";
import { createRepos, type Repos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address lowercased and trimmed, or null when it isn't an email. */
export function normalizeEmail(input: string): string | null {
  const normalized = input.trim().toLowerCase();
  return EMAIL_RE.test(normalized) ? normalized : null;
}

export type EmailOwner = { memberId: string; as: "email" | "alias" };

/**
 * Another member who already has this address, as their email or an alias.
 * Two members sharing an address is a duplicate to merge, not something to
 * paper over with an alias.
 */
export async function findEmailOwner(repos: Repos, memberId: string, address: string): Promise<EmailOwner | null> {
  const [holder, alias] = await Promise.all([repos.members.byEmail(address), repos.aliases.findEmail(address)]);
  if (holder && holder.id !== memberId) return { memberId: holder.id, as: "email" };
  if (alias && alias.memberId !== memberId) return { memberId: alias.memberId, as: "alias" };
  return null;
}

export type PrimaryEmailResult =
  | { ok: true; changed: boolean }
  | { ok: false; status: 409 | 500 | 502; error: string; conflictingMemberId?: string };

/**
 * Change a member's primary email, and the address they sign in with, together.
 * Order matters: the sign-in account first (the likeliest to refuse), then Kajabi
 * (the next reprocess would otherwise put the Kajabi email back), then Bronze, so a
 * reprocess before the next full Kajabi import agrees, then the member. A failure
 * after the account changed puts it back. The old email stays on as an alias, so
 * history filed under it still matches.
 *
 * `repos` does the member and alias writes (the admin's client, or the service role
 * once the caller has verified the address); `service` is the service-role client for
 * Bronze and the sign-in account. The caller schedules the alias reprocess.
 */
export async function changePrimaryEmail({
  repos,
  service,
  member,
  address,
}: {
  repos: Repos;
  service: Db;
  member: { id: string; email: string; kajabiId: string | null; userId: string | null };
  /** Already normalized (`normalizeEmail`). */
  address: string;
}): Promise<PrimaryEmailResult> {
  const previous = member.email.toLowerCase();
  if (address === previous) return { ok: true, changed: false };

  const owner = await findEmailOwner(repos, member.id, address);
  if (owner) {
    return {
      ok: false,
      status: 409,
      error:
        owner.as === "email"
          ? "Another member already has that email. If they're the same person, merge them instead."
          : "That email is already an alias of another member. If they're the same person, merge them instead.",
      conflictingMemberId: owner.memberId,
    };
  }

  const serviceRepos = createRepos(service);

  // The account they sign in with. Signups are off, so a member whose account keeps the old
  // address could not sign in at the new one.
  let accountChanged = false;
  if (member.userId) {
    try {
      const account = await serviceRepos.authUsers.byId(member.userId);
      if (account && account.email !== address) {
        await serviceRepos.authUsers.setEmail(member.userId, address);
        accountChanged = true;
      }
    } catch (err) {
      console.error("[member-email] Sign-in email update failed:", err);
      return { ok: false, status: 409, error: "That email already has a sign-in account. Merge or remove it first." };
    }
  }

  const restoreAccount = async () => {
    if (!accountChanged || !member.userId) return;
    try {
      await serviceRepos.authUsers.setEmail(member.userId, previous);
    } catch (err) {
      console.error("[member-email] Couldn't put the sign-in email back:", err);
    }
  };

  if (member.kajabiId) {
    const kajabi = createKajabiClient();
    try {
      await kajabi.updateContact(member.kajabiId, { email: address });
    } catch (err) {
      await restoreAccount();
      const message = err instanceof Error ? err.message : "";
      // Kajabi keeps emails unique: another contact (often an old duplicate with no member) has the address.
      if (/already taken/i.test(message)) {
        return { ok: false, status: 409, error: "Kajabi already has a different contact with that email. Merge or delete that contact in Kajabi first, then try again." };
      }
      return { ok: false, status: 502, error: message || "Couldn't update the email in Kajabi" };
    }

    try {
      await refreshKajabiContactInBronze(service, kajabi, member.kajabiId);
    } catch (err) {
      // Kajabi has the new email; make Bronze agree without the round trip.
      console.error("[member-email] Kajabi contact refresh failed after email change, patching Bronze:", err);
      try {
        await serviceRepos.billing.setKajabiContactEmail(member.kajabiId, address);
      } catch (bronzeError) {
        console.error("[member-email] Bronze email patch failed:", bronzeError);
      }
    }
  }

  try {
    const changed = await repos.members.setEmail(member.id, address);
    if (!changed.ok) {
      await restoreAccount();
      return { ok: false, status: 409, error: "Another member already has that email." };
    }
    // The new address may have been an alias of this member; it's the email now.
    await repos.aliases.removeEmailOf(member.id, address);
    // The address they had was their primary email, so it counts as confirmed (service role: the database ignores `verified` from a session).
    await serviceRepos.aliases.upsertEmail(member.id, previous, "manual", true, true);
  } catch (err) {
    await restoreAccount();
    return { ok: false, status: 500, error: (err as Error).message };
  }

  return { ok: true, changed: true };
}
