import { highlightSegments } from "@/lib/search/format";

/** `text` with the searched words picked out, as a tinted background on the match (like Stripe's search). */
export default function Highlight({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightSegments(text, words).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-plum-100 text-inherit dark:bg-plum-900/50">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  );
}
