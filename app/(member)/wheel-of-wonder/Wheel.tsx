"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { spinWheel, type WheelSpinResponse, type WheelWinner } from "./actions";

// Slot count for the idle (pre-spin) placeholder ring. Once real results
// come back, the wheel shrinks to however many distinct real candidates are
// actually available (capped at this), rather than padding with repeats or
// fake entries — see runSpinAnimation.
const IDLE_SLOT_COUNT = 8;
const WHEEL_SIZE = 320;
const AVATAR_SIZE = 64;
const RADIUS = WHEEL_SIZE / 2 - AVATAR_SIZE / 2 - 8;
const SPIN_DURATION_MS = 4200;
const FULL_TURNS = 6;

interface SlotPhoto {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
}

const BLANK_SLOT: SlotPhoto = { memberId: "", memberName: "", photoUrl: null };

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function SlotAvatar({ slot, size, dimmed }: { slot: SlotPhoto; size: number; dimmed: boolean }) {
  // Tracks whether slot.photoUrl actually loaded — a broken/expired/404'd
  // URL should fall back to initials, not render as an empty colored circle.
  // Reset whenever the occupant/photo changes (slots get reused for
  // different candidates as the wheel spins).
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [slot.photoUrl]);

  if (!slot.memberId) {
    return (
      <div
        className="rounded-full flex-shrink-0 bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-900 shadow"
        style={{ width: size, height: size }}
      />
    );
  }

  const showPhoto = !!slot.photoUrl && !imgFailed;

  return (
    <div
      className={`relative rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold shadow border-2 border-white dark:border-slate-900 transition-opacity overflow-hidden ${getAvatarColor(
        slot.memberName
      )} ${dimmed ? "opacity-60" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.32 }}
      title={slot.memberName}
    >
      {!showPhoto && getInitials(slot.memberName)}
      {slot.photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={slot.photoUrl}
          src={slot.photoUrl}
          alt=""
          onError={() => setImgFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover ${showPhoto ? "" : "hidden"}`}
        />
      )}
    </div>
  );
}

interface WheelProps {
  /** Community-wide count of confirmed connections (aggregate only, no per-person breakdown). */
  confirmedConnectionCount?: number;
}

export default function Wheel({ confirmedConnectionCount = 0 }: WheelProps) {
  const [phase, setPhase] = useState<"idle" | "spinning" | "revealed" | "empty" | "error">("idle");
  const [slots, setSlots] = useState<SlotPhoto[]>(Array(IDLE_SLOT_COUNT).fill(BLANK_SLOT));
  const [winner, setWinner] = useState<WheelWinner | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [justRevealed, setJustRevealed] = useState(false);
  const [starterCopied, setStarterCopied] = useState(false);

  const wheelRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slotsRef = useRef<SlotPhoto[]>(slots);
  const animFrameRef = useRef<number | null>(null);
  const degreesPerSlot = 360 / slots.length;

  const applyRotation = useCallback((rotation: number) => {
    if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotation}deg)`;
    for (const el of slotRefs.current) {
      if (el) el.style.transform = `rotate(${-rotation}deg)`;
    }
  }, []);

  const setSlot = useCallback((index: number, photo: SlotPhoto) => {
    const next = [...slotsRef.current];
    next[index] = photo;
    slotsRef.current = next;
    setSlots(next);
  }, []);

  const runSpinAnimation = useCallback(
    (result: Extract<WheelSpinResponse, { winner: WheelWinner }>) => {
      const decorativePool = result.reel.slice(1);
      const winnerPhoto: SlotPhoto = {
        memberId: result.winner.memberId,
        memberName: result.winner.memberName,
        photoUrl: result.winner.photoUrl,
      };

      // Size the wheel to however many distinct real candidates we actually
      // have (capped at IDLE_SLOT_COUNT) — never pad with repeats or a fake
      // placeholder just to fill out a fixed slot count.
      const activeSlotCount = Math.max(1, Math.min(IDLE_SLOT_COUNT, decorativePool.length + 1));
      const activeDegreesPerSlot = 360 / activeSlotCount;

      // Draws without replacement from a shuffled bag, reshuffling once
      // exhausted — guarantees no two slots show the same person at once as
      // long as the bag hasn't had to wrap mid-draw.
      let bag: SlotPhoto[] = [];
      const nextDecorative = (): SlotPhoto => {
        if (decorativePool.length === 0) return winnerPhoto;
        if (bag.length === 0) bag = shuffle(decorativePool);
        return bag.shift()!;
      };

      const seeded = Array.from({ length: activeSlotCount }, () => nextDecorative());
      slotsRef.current = seeded;
      setSlots(seeded);

      const totalRotation = FULL_TURNS * 360;
      const startTime = performance.now();
      let lastBoundary = 0;
      const totalBoundaries = FULL_TURNS * activeSlotCount;

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / SPIN_DURATION_MS);
        const rotation = totalRotation * easeOutCubic(t);
        applyRotation(rotation);

        const boundary = Math.floor(rotation / activeDegreesPerSlot);
        if (boundary > lastBoundary) {
          for (let b = lastBoundary + 1; b <= boundary; b++) {
            const slotIndex = (activeSlotCount - (b % activeSlotCount)) % activeSlotCount;
            // Slot 0 is the one that lands at noon at rest (rotation is an
            // exact multiple of 360°), and it passes through noon once per
            // lap. Commit the winner into it starting from its second-to-
            // last pass — not just the literal final crossing — so it
            // rides through noon unchanged for the whole final lap (which,
            // thanks to the ease-out, is over half the animation's real
            // time) instead of swapping in at the last instant. Without
            // this, the wheel visibly "changes its mind" right as it stops.
            if (slotIndex === 0 && b >= totalBoundaries - activeSlotCount) {
              setSlot(0, winnerPhoto);
            } else {
              setSlot(slotIndex, nextDecorative());
            }
          }
          lastBoundary = boundary;
        }

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          applyRotation(totalRotation % 360 === 0 ? 0 : totalRotation);
          setPhase("revealed");
          setWinner(result.winner);
          setJustRevealed(true);
          setTimeout(() => setJustRevealed(false), 900);
        }
      };

      animFrameRef.current = requestAnimationFrame(step);
    },
    [applyRotation, setSlot]
  );

  const handleCopyStarter = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStarterCopied(true);
      setTimeout(() => setStarterCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy starter text:", error);
    }
  }, []);

  const handleSpin = useCallback(async () => {
    if (phase === "spinning") return;
    setPhase("spinning");
    setErrorMessage(null);
    setWinner(null);
    setStarterCopied(false);
    applyRotation(0);

    const result = await spinWheel();

    if ("error" in result) {
      setPhase("error");
      setErrorMessage(result.error);
      return;
    }
    if ("noOneAvailable" in result) {
      setPhase("empty");
      return;
    }
    runSpinAnimation(result);
  }, [phase, applyRotation, runSpinAnimation]);

  return (
    <div className="flex flex-col items-center gap-8">
      {confirmedConnectionCount > 0 && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium text-center">
          🎉 {confirmedConnectionCount} new connection{confirmedConnectionCount === 1 ? "" : "s"} made
          through the Wheel of Wonder.
        </p>
      )}
      <div className="relative" style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
        {/* Pointer marking the "noon" landing position */}
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-2 z-10 text-2xl"
          style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))" }}
          aria-hidden="true"
        >
          ▼
        </div>

        <div
          className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-inner"
          aria-hidden="true"
        />

        <div ref={wheelRef} className="absolute inset-0" style={{ transform: "rotate(0deg)" }}>
          {slots.map((slot, i) => {
            const angle = i * degreesPerSlot - 90;
            const x = WHEEL_SIZE / 2 + RADIUS * Math.cos((angle * Math.PI) / 180) - AVATAR_SIZE / 2;
            const y = WHEEL_SIZE / 2 + RADIUS * Math.sin((angle * Math.PI) / 180) - AVATAR_SIZE / 2;
            return (
              <div
                key={i}
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
                className={`absolute transition-transform ${
                  i === 0 && justRevealed ? "scale-125" : ""
                }`}
                style={{ left: x, top: y, width: AVATAR_SIZE, height: AVATAR_SIZE }}
              >
                <SlotAvatar slot={slot} size={AVATAR_SIZE} dimmed={phase === "idle"} />
              </div>
            );
          })}
        </div>

        {phase === "idle" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-4xl" aria-hidden="true">
              🦔
            </span>
          </div>
        )}
      </div>

      {phase !== "revealed" && (
        <button
          onClick={handleSpin}
          disabled={phase === "spinning"}
          className="px-6 py-3 rounded-full font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 shadow hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {phase === "spinning" ? "Spinning…" : "Spin the Wheel"}
        </button>
      )}

      {phase === "revealed" && winner && (
        <div className="text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">
            Billie would like to (re)introduce {winner.memberName} to you!
          </h2>

          {winner.roomCreated ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              I already broke the ice for you two — check the room!
            </p>
          ) : (
            winner.starterText && (
              <div className="mb-4 text-left">
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Something to open with:</p>
                <div className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-sm text-slate-700 dark:text-slate-300 flex-1">{winner.starterText}</p>
                  <button
                    onClick={() => handleCopyStarter(winner.starterText!)}
                    className="text-xs px-2 py-1 rounded font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex-shrink-0"
                  >
                    {starterCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a
              href={winner.dmUrl}
              className="px-5 py-2.5 rounded-lg font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
            >
              Message on Slack →
            </a>
            <button
              onClick={handleSpin}
              className="px-5 py-2.5 rounded-lg font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Spin Again
            </button>
          </div>
        </div>
      )}

      {phase === "empty" && (
        <div className="text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm">
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            No one&apos;s around in Slack right now — try again in a bit!
          </p>
          <button
            onClick={handleSpin}
            className="px-5 py-2.5 rounded-lg font-medium text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {phase === "error" && errorMessage && (
        <div className="text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm">
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500 text-center max-w-sm">
        The Wheel of Wonder leans toward hedgies who haven&apos;t connected much yet, so newer or
        quieter folks turn up as matches more often. Posting, reacting, and showing up to a
        prickle is still the fastest way to build connections on your own.{" "}
        <Link href="/network" className="underline hover:text-slate-600 dark:hover:text-slate-300">
          See your connections →
        </Link>
      </p>
    </div>
  );
}
