"use client";

import { useEffect, useState } from "react";
import { loadMemberTransactions, type TransactionsResult } from "./transactions-actions";
import MemberTransactionsPanel from "./MemberTransactionsPanel";

/** The Transactions tab: asks for the member's payments once it is on screen, so no other tab pays for them. */
export default function MemberTransactions({ memberId }: { memberId: string }) {
  const [result, setResult] = useState<TransactionsResult | null>(null);
  // Bumped after a billing row is marked or unmarked, to read the tab again; what is on screen stays until the new data is in.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    loadMemberTransactions(memberId)
      .then((r) => current && setResult(r))
      .catch(() => current && setResult({ error: "Couldn't load the transactions." }));
    return () => {
      current = false;
    };
  }, [memberId, version]);

  if (!result) return <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Loading transactions…</p>;
  if ("error" in result) return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>;
  return <MemberTransactionsPanel {...result} onAcknowledgementChange={() => setVersion((v) => v + 1)} />;
}
