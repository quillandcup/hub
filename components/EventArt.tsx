import type { EventType } from "@/lib/events-filter";

// The picture an event card shows when it has no photo yet: a soft gradient in the brand colors and a symbol
// for its kind, so a card is never an empty grey box. Real images (per prickle type, per event) replace it.
// (It lives in components/ so Tailwind sees the class names.)

interface Art {
  /** A symbol for the kind of event. */
  symbol: string;
  /** The gradient behind it, light and dark. */
  gradient: string;
}

const ART: Record<EventType, Art> = {
  in_person_retreat: { symbol: "🏡", gradient: "from-plum-200 to-plum-100 dark:from-plum-900 dark:to-plum-950" },
  virtual_retreat: { symbol: "🖥️", gradient: "from-plum-100 to-mist-100 dark:from-plum-950 dark:to-mist-900" },
  workshop: { symbol: "✏️", gradient: "from-mist-200 to-mist-50 dark:from-mist-800 dark:to-mist-950" },
  book_launch: { symbol: "📚", gradient: "from-blush to-cream dark:from-plum-950 dark:to-slate-900" },
  social: { symbol: "🎉", gradient: "from-feather to-blush dark:from-plum-900 dark:to-slate-900" },
  session: { symbol: "✍️", gradient: "from-cream to-mist-100 dark:from-slate-800 dark:to-mist-950" },
  educational: { symbol: "🎓", gradient: "from-mist-300 to-mist-100 dark:from-mist-800 dark:to-mist-900" },
  other: { symbol: "✨", gradient: "from-cream to-blush dark:from-slate-800 dark:to-plum-950" },
};

/** The placeholder art for a kind of event (a plain event for a kind it doesn't know). */
export function eventArt(eventType: string): Art {
  return ART[eventType as EventType] ?? ART.other;
}

/**
 * The picture at the top of an event card: its cover photo when it has one, else the art for its kind.
 * `icon` replaces the kind's symbol (a retreat shows its badge's icon); `className` sets the size.
 */
export default function EventArt({ eventType, coverUrl, icon, className = "h-28" }: { eventType: string; coverUrl?: string | null; icon?: string | null; className?: string }) {
  if (coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served via the private event-photos proxy route
      <img src={coverUrl} alt="" className={`w-full object-cover ${className}`} />
    );
  }
  const art = eventArt(eventType);
  return (
    <div aria-hidden="true" data-testid="event-art" className={`w-full flex items-center justify-center bg-gradient-to-br ${art.gradient} ${className}`}>
      <span className="text-4xl opacity-80">{icon || art.symbol}</span>
    </div>
  );
}
