"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LiveRoom } from "@/lib/live-room";
import { track } from "@/lib/analytics/client";

const POLL_MS = 30_000;

/**
 * The "On air" light in the member header: a blinking red dot and the head count while someone is
 * on the Prickle link, a grey "Off air" when it is empty. Click for who is there and the join
 * link; off air, the same link starts a Pop-Up Prickle (PUP). Polls /api/live-room while the
 * tab is visible.
 */
export default function LiveRoomIndicator() {
  const [room, setRoom] = useState<LiveRoom | null>(null);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/live-room", { cache: "no-store" });
      if (res.ok) setRoom(await res.json());
    } catch {
      // Keep showing the last known state; the next poll retries.
    }
  }, []);

  // Subscribes to a timer and to tab visibility. The first load is the timer's first tick, so no
  // state is set synchronously in the effect.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!room) return null;

  const label = room.live ? `${room.count} ${room.count === 1 ? "Hedgie" : "Hedgies"} at the table` : "Off air";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) track("onair_popover_opened", { live: room.live, room_size: room.count });
          setOpen((o) => !o);
          refresh();
        }}
        data-track="onair-light"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={room.live ? "On air: Hedgies are at the table" : "Off air: nobody is at the table"}
        className="flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          {room.live && <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${room.live ? "bg-red-500" : "bg-slate-400"}`} />
        </span>
        <span className="font-semibold uppercase tracking-wide text-xs">{room.live ? "On air" : "Off air"}</span>
        {room.live && <span className="hidden sm:inline">{label}</span>}
        {room.live && <span className="sm:hidden">{room.count}</span>}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Prickle room"
          className="fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-4 z-50 text-sm"
        >
          {room.live ? (
            <>
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                {room.prickle ? (
                  <Link
                    href={`/prickles/${room.prickle.id}`}
                    data-track="onair-prickle"
                    className="hover:underline"
                    onClick={() => {
                      track("onair_prickle_clicked", { room_size: room.count });
                      setOpen(false);
                    }}
                  >
                    {room.prickle.title}
                  </Link>
                ) : (
                  "Pop-Up Prickle (PUP)"
                )}
              </p>
              {room.prickle?.hostName && (
                <p className="text-slate-500 dark:text-slate-400">Hosted by {room.prickle.hostName}</p>
              )}
              <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
              <ul className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                {room.members.map((m) => (
                  <li key={m.memberId}>
                    <Link
                      href={`/members/${m.memberId}`}
                      data-track="onair-member"
                      className="text-slate-700 dark:text-slate-300 hover:underline"
                      onClick={() => {
                        track("onair_member_clicked", { room_size: room.count });
                        setOpen(false);
                      }}
                    >
                      {m.name}
                    </Link>
                  </li>
                ))}
                {room.guests > 0 && (
                  <li className="text-slate-500 dark:text-slate-400">
                    {room.guests} {room.guests === 1 ? "guest" : "guests"}
                  </li>
                )}
              </ul>
            </>
          ) : (
            <>
              <p className="font-semibold text-slate-900 dark:text-slate-100">Nobody is at the table</p>
              <p className="mt-1 text-slate-500 dark:text-slate-400">
                Open the room to start a Pop-Up Prickle (PUP). Whoever joins next sees it light up.
              </p>
            </>
          )}
          {room.join ? (
            <>
              <a
                href={room.join.url}
                target="_blank"
                rel="noopener noreferrer"
                data-track={room.live ? "onair-join-zoom" : "onair-start-pup"}
                onClick={() => track("onair_join_clicked", { live: room.live, room_size: room.count })}
                className="mt-4 block text-center rounded-lg bg-plum-600 hover:bg-plum-700 text-white font-medium px-3 py-2 transition-colors"
              >
                {room.live ? "Join on Zoom" : "Start a PUP on Zoom"}
              </a>
              {(room.join.meetingId || room.join.passcode) && (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center">
                  {room.join.meetingId && <p>Meeting ID: {room.join.meetingId}</p>}
                  {room.join.passcode && <p>Passcode: {room.join.passcode}</p>}
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">No Zoom link is set up yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
