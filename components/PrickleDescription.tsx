import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** A prickle's description: the markdown the calendar import keeps (bold, italic, links, line breaks). Only http(s) and mailto links are rendered; images and raw HTML are not. */
export default function PrickleDescription({ markdown, className = "text-sm mb-4" }: { markdown: string; className?: string }) {
  return (
    <div className={`text-slate-700 dark:text-slate-300 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(https?:|mailto:)/.test(url) ? url : "")}
        disallowedElements={["img"]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-line mb-2 last:mb-0">{children}</p>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
