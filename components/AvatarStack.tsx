import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";

export interface AvatarPerson {
  name: string;
  photoUrl: string | null;
}

/**
 * A row of overlapping avatars (who replied in a thread, who is in a channel). Decorative: put
 * the meaning (a count, "3 replies") in text next to it. Each avatar has the person's name as its
 * tooltip; `overflow` adds a "+N" chip when there are more people than `max`.
 */
export default function AvatarStack({
  people,
  size = 24,
  max = 5,
  overflow = false,
}: {
  people: AvatarPerson[];
  size?: number;
  max?: number;
  overflow?: boolean;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const ring = "rounded-full ring-2 ring-white dark:ring-slate-900";
  const gap = { marginLeft: -Math.round(size / 4) };
  return (
    <span className="flex items-center" aria-hidden="true">
      {shown.map((p, i) => (
        <span key={i} className={ring} style={i === 0 ? undefined : gap} title={p.name}>
          <MemberAvatar name={p.name} photoUrl={p.photoUrl} size={size} />
        </span>
      ))}
      {overflow && extra > 0 && (
        <span
          className={`${ring} flex items-center justify-center bg-slate-200 dark:bg-slate-700 text-[10px] font-medium text-slate-700 dark:text-slate-200`}
          style={{ ...gap, width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
