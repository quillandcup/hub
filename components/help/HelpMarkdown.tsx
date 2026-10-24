import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { helpImageUrl } from "@/lib/help";

/** An article's markdown, styled with the typography plugin. `img:` sources become the signed-in image route; anything else (external images, scripts) is not rendered. */
export default function HelpMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-slate dark:prose-invert max-w-none prose-img:rounded-lg prose-img:border prose-img:border-slate-200 dark:prose-img:border-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("img:") ? url : /^(https?:|mailto:|\/|#)/.test(url) ? url : "")}
        components={{
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? helpImageUrl(src) : null;
            // eslint-disable-next-line @next/next/no-img-element -- served by our own gated route, sized by the capture
            return url ? <img src={url} alt={alt ?? ""} loading="lazy" /> : null;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
