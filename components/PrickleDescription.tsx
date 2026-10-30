import ReactMarkdown from "react-markdown";

/** A prickle's description: the markdown the calendar import keeps (bold, italic, links, line breaks). Only http(s) and mailto links are rendered; images and raw HTML are not. */
export default function PrickleDescription({ markdown, className = "text-sm mb-4" }: { markdown: string; className?: string }) {
  return (
    <div className={`text-slate-700 dark:text-slate-300 ${className}`}>
      <ReactMarkdown
        urlTransform={(url) => (/^(https?:|mailto:)/.test(url) ? url : "")}
        disallowedElements={["img"]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-line mb-2 last:mb-0">{children}</p>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
