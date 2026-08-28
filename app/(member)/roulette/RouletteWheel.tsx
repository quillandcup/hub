"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { spinRoulette, type RouletteSpinResponse, type RouletteWinner } from "./actions";

const SLOT_COUNT = 8;
const WHEEL_SIZE = 320;
const AVATAR_SIZE = 64;
const RADIUS = WHEEL_SIZE / 2 - AVATAR_SIZE / 2 - 8;
const SPIN_DURATION_MS = 4200;
const FULL_TURNS = 6;
const DEGREES_PER_SLOT = 360 / SLOT_COUNT;

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

function SlotAvatar({ slot, size, dimmed }: { slot: SlotPhoto; size: number; dimmed: boolean }) {
  if (!slot.memberId) {
    return (
      <div
        className="rounded-full flex-shrink-0 bg-slate-200 dark:bg-slate-700 border-2 border-white dark:border-slate-900 shadow"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold bg-cover bg-center shadow border-2 border-white dark:border-slate-900 transition-opacity ${getAvatarColor(
        slot.memberName
      )} ${dimmed ? "opacity-60" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        backgroundImage: slot.photoUrl ? `url(${slot.photoUrl})` : undefined,
      }}
      title={slot.memberName}
    >
      {!slot.photoUrl && getInitials(slot.memberName)}
    </div>
  );
}

export default function RouletteWheel() {
  const [phase, setPhase] = useState<"idle" | "spinning" | "revealed" | "empty" | "error">("idle");
  const [slots, setSlots] = useState<SlotPhoto[]>(Array(SLOT_COUNT).fill(BLANK_SLOT));
  const [winner, setWinner] = useState<RouletteWinner | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [justRevealed, setJustRevealed] = useState(false);

  const wheelRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slotsRef = useRef<SlotPhoto[]>(slots);
  const animFrameRef = useRef<number | null>(null);

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
    (result: Extract<RouletteSpinResponse, { winner: RouletteWinner }>) => {
      const decorativePool = result.reel.slice(1);
      const pickDecorative = (): SlotPhoto =>
        decorativePool.length > 0
          ? decorativePool[Math.floor(Math.random() * decorativePool.length)]
          : { memberId: "reel", memberName: "?", photoUrl: null };

      // Seed all 8 slots with decorative photos so the wheel looks alive
      // from the first frame — the true winner is only revealed on the
      // final crossing of the noon marker, in slot 0.
      const seeded = Array.from({ length: SLOT_COUNT }, () => pickDecorative());
      slotsRef.current = seeded;
      setSlots(seeded);

      const totalRotation = FULL_TURNS * 360;
      const startTime = performance.now();
      let lastBoundary = 0;
      const totalBoundaries = FULL_TURNS * SLOT_COUNT;

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / SPIN_DURATION_MS);
        const rotation = totalRotation * easeOutCubic(t);
        applyRotation(rotation);

        const boundary = Math.floor(rotation / DEGREES_PER_SLOT);
        if (boundary > lastBoundary) {
          for (let b = lastBoundary + 1; b <= boundary; b++) {
            const slotIndex = ((SLOT_COUNT - (b % SLOT_COUNT)) % SLOT_COUNT);
            if (b >= totalBoundaries) {
              // Final crossing — always slot 0 landing at noon. Reveal the
              // real winner instead of another decorative swap.
              setSlot(0, {
                memberId: result.winner.memberId,
                memberName: result.winner.memberName,
                photoUrl: result.winner.photoUrl,
              });
            } else {
              setSlot(slotIndex, pickDecorative());
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

  const handleSpin = useCallback(async () => {
    if (phase === "spinning") return;
    setPhase("spinning");
    setErrorMessage(null);
    setWinner(null);
    applyRotation(0);

    const result = await spinRoulette();

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
            const angle = i * DEGREES_PER_SLOT - 90;
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
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">You matched with</p>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">{winner.memberName}</h2>
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
        Want a chance at getting spun more? Post and react in Slack, and show up to a prickle — the
        wheel leans toward hedgies who haven&apos;t connected much yet.{" "}
        <Link href="/network" className="underline hover:text-slate-600 dark:hover:text-slate-300">
          See your connections →
        </Link>
      </p>
    </div>
  );
}
