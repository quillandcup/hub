import { activeByKey, type AckRecord } from "@/lib/billing-acknowledgements";
import type { Repos } from "@/lib/data/repos";

/**
 * The active acknowledgements by row key, and the sign-in email of each person who made one (for "marked by"). Read
 * through whichever repositories the caller holds: the page and the Transactions tab use the service role, after
 * checking `billing.reconciliation.read`, so staff who may read the page see acknowledgements read-only.
 */
export async function loadAcknowledgements(repos: Repos): Promise<{ acks: Map<string, AckRecord>; staff: Map<string, string> }> {
  const acks = activeByKey(await repos.billingAcknowledgements.active());
  const userIds = [...new Set([...acks.values()].flatMap((a) => (a.acknowledgedBy ? [a.acknowledgedBy] : [])))];
  const profiles = userIds.length > 0 ? await repos.profiles.byIds(userIds) : [];
  return { acks, staff: new Map(profiles.map((p) => [p.id, p.email])) };
}
