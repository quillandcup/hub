"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EventKajabiMatches } from "@/lib/kajabi-event-matching";

interface OfferRow {
  kajabiOfferId: string;
  name: string;
}

/** Says a buyer and an attendee with no ticket share a name: likely one person with two member records. */
function DuplicateHint({ other }: { other: { member_id: string; member_name: string } }) {
  return (
    <span className="block text-xs text-amber-700 dark:text-amber-400">
      May be the same person as{" "}
      <Link href={`/admin/members/${other.member_id}`} className="underline">
        {other.member_name}
      </Link>
      : merge the two members first, then search again.
    </span>
  );
}

function money(cents: number | null): string {
  return cents === null ? "" : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The Kajabi offers that sell an event, and "Find Kajabi matches": the buyers who are not
 * attendees yet, to add in one go as purchased tickets (the way a program cohort's matches are
 * enrolled), plus the gaps the other way round.
 */
export default function EventKajabiTickets({ eventId, onAttendeesChanged }: { eventId: string; onAttendeesChanged: () => Promise<void> | void }) {
  const [linked, setLinked] = useState<OfferRow[]>([]);
  const [available, setAvailable] = useState<OfferRow[]>([]);
  const [filter, setFilter] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<EventKajabiMatches | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadOffers = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/offers`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load the Kajabi offers");
      setLinked(body.linked ?? []);
      setAvailable(body.available ?? []);
    } catch (err: any) {
      setError(err.message);
    }
  }, [eventId]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  const call = async (run: () => Promise<Response>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) throw new Error((await res.json()).error || failure);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!choice) return;
    const ok = await call(
      () => fetch(`/api/admin/events/${eventId}/offers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kajabiOfferId: choice }) }),
      "Failed to link the offer"
    );
    if (ok) {
      setChoice("");
      setMatches(null);
      await loadOffers();
    }
  };

  const unlink = async (offerId: string) => {
    const ok = await call(() => fetch(`/api/admin/events/${eventId}/offers/${offerId}`, { method: "DELETE" }), "Failed to unlink the offer");
    if (ok) {
      setMatches(null);
      await loadOffers();
    }
  };

  const findMatches = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/kajabi-matches`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to find Kajabi matches");
      const found = body as EventKajabiMatches;
      setMatches(found);
      // A refunded or deactivated purchase, or a buyer who may already be an attendee under
      // another member record, starts unchecked: someone looks at it first.
      setSelected(new Set(found.buyers.filter((b) => !b.deactivated && !b.possible_duplicate).map((b) => b.member_id)));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (memberId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });

  const addSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        Array.from(selected).map((memberId) =>
          fetch(`/api/admin/events/${eventId}/attendees`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memberId, ticketSource: "purchased" }),
          })
        )
      );
      const failed = results.filter((r) => !r.ok).length;
      await onAttendeesChanged();
      await findMatches();
      // After the refresh, which clears the error line.
      if (failed > 0) setError(`${failed} of ${results.length} could not be added`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = available.filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 100);

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold mb-1">Kajabi tickets</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
        Link the Kajabi offers that sell this event, then find the buyers who are not attendees yet. Comped and gifted tickets have no
        purchase: record them on the attendee.
      </p>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {linked.length > 0 && (
        <ul className="mb-3 divide-y divide-gray-200 dark:divide-slate-800">
          {linked.map((offer) => (
            <li key={offer.kajabiOfferId} className="flex items-center justify-between py-1.5 text-sm">
              <span>{offer.name}</span>
              <button
                type="button"
                onClick={() => unlink(offer.kajabiOfferId)}
                disabled={busy}
                className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          aria-label="Filter Kajabi offers"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter offers (e.g. Summer Retreat 2026)"
          className="px-2 py-1.5 border border-gray-300 dark:border-slate-700 rounded text-sm bg-white dark:bg-slate-900 w-72"
        />
        <select
          aria-label="Kajabi offer to link"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="px-2 py-1.5 border border-gray-300 dark:border-slate-700 rounded text-sm bg-white dark:bg-slate-900 max-w-md"
        >
          <option value="">Choose an offer…</option>
          {shown.map((offer) => (
            <option key={offer.kajabiOfferId} value={offer.kajabiOfferId}>
              {offer.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={link}
          disabled={busy || !choice}
          className="px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm disabled:opacity-50"
        >
          Link offer
        </button>
        {linked.length > 0 && (
          <button
            type="button"
            onClick={findMatches}
            disabled={busy}
            className="px-3 py-1.5 border border-plum-600 text-plum-700 dark:text-plum-300 rounded hover:bg-plum-50 dark:hover:bg-slate-800 text-sm disabled:opacity-50"
          >
            {busy ? "Searching..." : "Find Kajabi matches"}
          </button>
        )}
      </div>

      {matches && (
        <div className="mt-4 space-y-4">
          {matches.buyers.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-slate-400">Everyone who bought a ticket is already an attendee.</p>
          ) : (
            <div>
              <h3 className="text-sm font-semibold mb-1">Bought a ticket, not an attendee ({matches.buyers.length})</h3>
              <ul className="divide-y divide-gray-200 dark:divide-slate-800">
                {matches.buyers.map((buyer) => (
                  <li key={buyer.member_id} className="flex items-start gap-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Add ${buyer.member_name}`}
                      checked={selected.has(buyer.member_id)}
                      onChange={() => toggle(buyer.member_id)}
                      className="mt-1"
                    />
                    <span>
                      <Link href={`/admin/members/${buyer.member_id}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                        {buyer.member_name}
                      </Link>
                      {buyer.member_real_name && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{buyer.member_real_name}</span>}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {[buyer.offer_names.join(", "), money(buyer.amount_in_cents), buyer.purchase_date?.slice(0, 10), buyer.member_status].filter(Boolean).join(" · ")}
                        {buyer.deactivated && <span className="ml-1 text-amber-700 dark:text-amber-400">· purchase deactivated or refunded</span>}
                      </span>
                      {buyer.possible_duplicate && <DuplicateHint other={buyer.possible_duplicate} />}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={addSelected}
                disabled={busy || selected.size === 0}
                className="mt-2 px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm disabled:opacity-50"
              >
                {`Add ${selected.size} as attendees`}
              </button>
            </div>
          )}

          {matches.unmatched.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Bought a ticket, no member with that email ({matches.unmatched.length})</h3>
              <ul className="text-sm space-y-0.5">
                {matches.unmatched.map((buyer) => (
                  <li key={buyer.email + buyer.purchase_date}>
                    {buyer.email}
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                      {[buyer.offer_names.join(", "), buyer.purchase_date?.slice(0, 10)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Add an email alias for the member, or add them as an attendee by hand.
              </p>
            </div>
          )}

          {matches.attendeesWithoutTicket.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Attendees with no ticket on record ({matches.attendeesWithoutTicket.length})</h3>
              <ul className="text-sm space-y-0.5">
                {matches.attendeesWithoutTicket.map((attendee) => (
                  <li key={attendee.member_id}>
                    {attendee.member_name}
                    {attendee.possible_duplicate && <DuplicateHint other={attendee.possible_duplicate} />}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                No purchase of these offers. Set how they got in (comped or gifted) in the list below.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
