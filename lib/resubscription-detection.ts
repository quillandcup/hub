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
