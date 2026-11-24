"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DatePicker from "@/components/DatePicker";
import { NOT_ATTENDING_LABELS, type NotAttendingReason } from "@/lib/event-not-attending";
import type { EventKajabiMatches } from "@/lib/kajabi-event-matching";

interface OfferRow {
  kajabiOfferId: string;
  name: string;
  /** Internal title, price and id: what tells offers with the same name apart. */
  detail: string;
  /** The purchase days (YYYY-MM-DD, inclusive) this event counts, on a linked offer; null = open. */
  purchasedFrom?: string | null;
  purchasedUntil?: string | null;
  /** Other events the offer is linked to; it can be linked here too, for its own dates. */
  otherEvents?: { title: string }[];
}

/** "purchases from 2026-02-01 until 2026-03-15", or null when every purchase counts. */
function windowLabel(from: string | null | undefined, until: string | null | undefined): string | null {
  if (from && until) return `purchases from ${from} until ${until}`;
  if (from) return `purchases from ${from}`;
  if (until) return `purchases until ${until}`;
  return null;
}

/** What Kajabi said about an attendee with no purchase; says "these offers" when the event has several linked. */
function kajabiOfferNote(kind: "held" | "not_held" | "shared" | "unknown" | "no_contact", linkedCount: number): string {
  const offers = linkedCount > 1 ? "any of the linked offers" : "this offer";
  switch (kind) {
    case "held":
      return `Kajabi holds ${linkedCount > 1 ? "one of the linked offers" : "this offer"} for them without a purchase: likely granted (comped or gifted).`;
    case "not_held":
      return `Kajabi shows no sign of ${offers} for them.`;
    case "shared":
      return "Kajabi holds one of these offers for them, but it has purchase dates or also serves another event, so it can't say which event it was for.";
    case "unknown":
      return "Couldn't check Kajabi.";
    case "no_contact":
      return "No Kajabi contact for this member.";
  }
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

/** "Not attending": pick why (a forfeited deposit, or something else with a note) and save. */
function NotAttendingControl({ name, busy, onSave }: { name: string; busy: boolean; onSave: (reason: NotAttendingReason, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<NotAttendingReason>("forfeited");
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy} aria-label={`Mark ${name} as not attending`} className="mt-0.5 block text-xs text-plum-700 dark:text-plum-300 hover:underline disabled:opacity-50">
        Not attending
      </button>
    );
  }
  const needsNote = reason === "other";
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <select aria-label={`Why ${name} is not attending`} value={reason} onChange={(e) => setReason(e.target.value as NotAttendingReason)} className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded text-xs bg-white dark:bg-slate-900">
        <option value="forfeited">{NOT_ATTENDING_LABELS.forfeited}</option>
        <option value="other">Other…</option>
      </select>
      <input
        type="text"
        aria-label={`Note for ${name}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={needsNote ? "What happened?" : "Note"}
        maxLength={500}
        className="px-2 py-1 border border-gray-300 dark:border-slate-700 rounded text-xs bg-white dark:bg-slate-900 w-56"
      />
      <button
        type="button"
        onClick={async () => {
          if (await onSave(reason, note)) setOpen(false);
        }}
        disabled={busy || (needsNote && !note.trim())}
        className="px-2 py-1 bg-plum-600 text-white rounded hover:bg-plum-700 text-xs disabled:opacity-50"
      >
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-600 dark:text-slate-400 hover:underline">
        Cancel
      </button>
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
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editFrom, setEditFrom] = useState("");
  const [editUntil, setEditUntil] = useState("");
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
      () => fetch(`/api/admin/events/${eventId}/offers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kajabiOfferId: choice, ...(from ? { purchasedFrom: from } : {}), ...(until ? { purchasedUntil: until } : {}) }) }),
      "Failed to link the offer"
    );
    if (ok) {
      setChoice("");
      setFrom("");
      setUntil("");
      setMatches(null);
      await loadOffers();
    }
  };

  const saveWindow = async (offerId: string) => {
    const ok = await call(
      () => fetch(`/api/admin/events/${eventId}/offers/${offerId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchasedFrom: editFrom || null, purchasedUntil: editUntil || null }) }),
      "Failed to change the purchase dates"
    );
    if (ok) {
      setEditing(null);
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

  const markNotAttending = async (memberId: string, reason: NotAttendingReason, note: string) => {
    const ok = await call(
      () => fetch(`/api/admin/events/${eventId}/not-attending`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId, reason, note }) }),
      "Failed to mark the buyer as not attending"
    );
    if (ok) await findMatches();
    return ok;
  };

  const undoNotAttending = async (memberId: string) => {
    const ok = await call(() => fetch(`/api/admin/events/${eventId}/not-attending/${memberId}`, { method: "DELETE" }), "Failed to remove the mark");
    if (ok) await findMatches();
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
            body: JSON.stringify({ memberId }),
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

  const shown = available.filter((o) => `${o.name} ${o.detail}`.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 100);

  const unexplainedTickets = matches?.multiTicketBuyers.reduce((sum, b) => sum + b.unexplained, 0) ?? 0;

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
            <li key={offer.kajabiOfferId} className="py-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {offer.name}
                  <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">{offer.detail}</span>
                  {windowLabel(offer.purchasedFrom, offer.purchasedUntil) && (
                    <span className="ml-2 text-xs text-plum-700 dark:text-plum-300">{windowLabel(offer.purchasedFrom, offer.purchasedUntil)}</span>
                  )}
                </span>
                <span className="flex gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(editing === offer.kajabiOfferId ? null : offer.kajabiOfferId);
                      setEditFrom(offer.purchasedFrom ?? "");
                      setEditUntil(offer.purchasedUntil ?? "");
                    }}
                    disabled={busy}
                    aria-label={`Edit purchase dates for ${offer.name}`}
                    className="text-xs text-plum-700 dark:text-plum-300 hover:underline disabled:opacity-50"
                  >
                    Purchase dates
                  </button>
                  <button
                    type="button"
                    onClick={() => unlink(offer.kajabiOfferId)}
                    disabled={busy}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    Unlink
                  </button>
                </span>
              </div>
              {editing === offer.kajabiOfferId && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <DatePicker id={`edit-from-${offer.kajabiOfferId}`} label="Purchases from" value={editFrom} onChange={setEditFrom} />
                  <DatePicker id={`edit-until-${offer.kajabiOfferId}`} label="Purchases until" value={editUntil} onChange={setEditUntil} min={editFrom || undefined} />
                  <button type="button" onClick={() => saveWindow(offer.kajabiOfferId)} disabled={busy} className="px-3 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm disabled:opacity-50">
                    Save dates
                  </button>
                  <button type="button" onClick={() => { setEditFrom(""); setEditUntil(""); }} disabled={busy} className="px-3 py-2 text-sm text-gray-600 dark:text-slate-400 hover:underline">
                    Clear dates
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 mb-3">
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
          className="px-2 py-1.5 border border-gray-300 dark:border-slate-700 rounded text-sm bg-white dark:bg-slate-900 w-full max-w-md min-w-0"
        >
          <option value="">Choose an offer…</option>
          {shown.map((offer) => (
            <option key={offer.kajabiOfferId} value={offer.kajabiOfferId}>
              {offer.name} ({offer.detail}){offer.otherEvents && offer.otherEvents.length > 0 ? ` - also linked to ${offer.otherEvents.map((e) => e.title).join(", ")}` : ""}
            </option>
          ))}
        </select>
        {choice && <DatePicker id="offer-purchased-from" label="Purchases from" value={from} onChange={setFrom} />}
        {choice && <DatePicker id="offer-purchased-until" label="Purchases until" value={until} onChange={setUntil} min={from || undefined} />}
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
                      <NotAttendingControl name={buyer.member_name} busy={busy} onSave={(reason, note) => markNotAttending(buyer.member_id, reason, note)} />
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

          {matches.passedOn.length + matches.movedAway.length + matches.notAttending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Not attending ({matches.passedOn.length + matches.movedAway.length + matches.notAttending.length})</h3>
              <ul className="text-sm space-y-0.5">
                {matches.passedOn.map((passed) => (
                  <li key={passed.giver_id}>
                    <Link href={`/admin/members/${passed.giver_id}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                      {passed.giver_name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{`Gave their ticket to ${passed.receivers.join(", ")}`}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">To remove it, change the recipient&apos;s Gifted by.</span>
                  </li>
                ))}
                {matches.movedAway.map((moved) => (
                  <li key={moved.member_id}>
                    <Link href={`/admin/members/${moved.member_id}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                      {moved.member_name}
                    </Link>
                    {moved.member_real_name && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{moved.member_real_name}</span>}
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{`Ticket moved to ${moved.destinations.join(", ")}`}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">To remove it, change the Transferred source on that event.</span>
                  </li>
                ))}
                {matches.notAttending.map((buyer) => (
                  <li key={buyer.member_id}>
                    <Link href={`/admin/members/${buyer.member_id}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                      {buyer.member_name}
                    </Link>
                    {buyer.member_real_name && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{buyer.member_real_name}</span>}
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{[NOT_ATTENDING_LABELS[buyer.reason], buyer.note].filter(Boolean).join(": ")}</span>
                    <button
                      type="button"
                      onClick={() => undoNotAttending(buyer.member_id)}
                      disabled={busy}
                      aria-label={`Undo not attending for ${buyer.member_name}`}
                      className="ml-3 text-xs text-plum-700 dark:text-plum-300 hover:underline disabled:opacity-50"
                    >
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
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

          {matches.multiTicketBuyers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Bought more than one ticket
                {unexplainedTickets > 0 && ` (${unexplainedTickets} not accounted for)`}
              </h3>
              <ul className="text-sm space-y-0.5">
                {matches.multiTicketBuyers.map((buyer) => (
                  <li key={buyer.member_id ?? buyer.name}>
                    {buyer.member_id ? (
                      <Link href={`/admin/members/${buyer.member_id}`} className="font-medium text-plum-600 dark:text-plum-400 hover:underline">
                        {buyer.name}
                      </Link>
                    ) : (
                      buyer.name
                    )}
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                      {[`${buyer.tickets} tickets`, buyer.first_bought?.slice(0, 10), buyer.is_attendee ? "attendee" : "not an attendee"].filter(Boolean).join(" · ")}
                    </span>
                    {buyer.passed_to.length > 0 && (
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{`-> gave to ${buyer.passed_to.join(", ")}`}</span>
                    )}
                    {buyer.unexplained > 0 && (
                      <span className="ml-2 text-xs font-medium text-amber-700 dark:text-amber-400">{`${buyer.unexplained} not accounted for`}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                An extra ticket is usually a gift for someone else: set the recipient to Gifted in the list below and pick who gave it.
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
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{kajabiOfferNote(attendee.kajabi_offer, linked.length)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                No purchase of these offers. Set how they got in (comped, gifted or transferred) in the list below.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
