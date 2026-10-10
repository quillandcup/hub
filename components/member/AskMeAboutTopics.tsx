import Link from "next/link";

/** "Ask me about…" topics as chips, each linking to the member search for it (profile and chat panel). */
export default function AskMeAboutTopics({ topics }: { topics: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {topics.map((topic) => (
        <li key={topic}>
          <Link
            href={`/members?q=${encodeURIComponent(topic)}`}
            className="inline-block rounded-full bg-plum-50 dark:bg-plum-900/30 text-plum-700 dark:text-plum-300 text-sm px-3 py-1 hover:bg-plum-100 dark:hover:bg-plum-900/50"
            title={`Find other Hedgies who talk about ${topic}`}
          >
            {topic}
          </Link>
        </li>
      ))}
    </ul>
  );
}
