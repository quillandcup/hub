export interface PurchaseRecord {
  kajabi_purchase_id: string;
  effective_start_at: string | null;
  created_at_kajabi: string | null;
  deactivated_at: string | null;
}

export interface ResubscriptionEvent {
  resubscribedAt: string;
  cancelledAt: string;
  gapDays: number;
}

/**
 * Given a list of purchases for a single customer (in any order), returns
 * the resubscription events: each time a new purchase starts after a
 * previous purchase was cancelled (deactivated_at set).
 */
export function detectResubscriptions(purchases: PurchaseRecord[]): ResubscriptionEvent[] {
  const sorted = [...purchases].sort((a, b) => {
    const aDate = a.effective_start_at ?? a.created_at_kajabi ?? "";
    const bDate = b.effective_start_at ?? b.created_at_kajabi ?? "";
    return aDate.localeCompare(bDate);
  });

  const events: ResubscriptionEvent[] = [];
  let latestCancellation: string | null = null;

  for (const purchase of sorted) {
    const startDate = purchase.effective_start_at ?? purchase.created_at_kajabi;
    if (!startDate) continue;

    if (latestCancellation && startDate > latestCancellation) {
      const gapMs = new Date(startDate).getTime() - new Date(latestCancellation).getTime();
      events.push({
        resubscribedAt: startDate,
        cancelledAt: latestCancellation,
        gapDays: Math.round(gapMs / (1000 * 60 * 60 * 24)),
      });
    }

    if (purchase.deactivated_at) {
      if (!latestCancellation || purchase.deactivated_at > latestCancellation) {
        latestCancellation = purchase.deactivated_at;
      }
    }
  }

  return events;
}

export function formatGapLabel(days: number): string {
  const months = Math.round(days / 30);
  if (months < 1) return `${days}d gap`;
  if (months === 1) return "1 mo gap";
  return `${months} mo gap`;
}

/**
 * Given a list of membership stints (in any order), returns a map from each
 * stint's start date to a formatted gap label describing the time between
 * the previous stint's cancellation and this stint's start — empty when a
 * stint isn't a resubscription (first stint, or no gap before it).
 */
export function gapLabelsByStintStart(
  stints: { created_at_kajabi: string; derived_end_at: string | null }[]
): Map<string, string> {
  const events = detectResubscriptions(
    stints.map((s, i) => ({
      kajabi_purchase_id: String(i),
      effective_start_at: null,
      created_at_kajabi: s.created_at_kajabi,
      deactivated_at: s.derived_end_at,
    }))
  );
  return new Map(events.map((event) => [event.resubscribedAt, formatGapLabel(event.gapDays)]));
}
