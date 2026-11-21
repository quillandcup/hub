import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isChangelogImagePath } from "@/lib/changelog";

/** An entry's markdown, styled like the help articles. Images must be the entry's own screenshots under /changelog/<slug>/; other image sources and scripts are not rendered. */
export default function ChangelogMarkdown({ slug, markdown }: { slug: string; markdown: string }) {
  return (
    <div className="prose prose-slate dark:prose-invert max-w-none prose-img:rounded-lg prose-img:border prose-img:border-slate-200 dark:prose-img:border-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(https?:|mailto:|\/|#)/.test(url) ? url : "")}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" && isChangelogImagePath(slug, src) ? (
              // eslint-disable-next-line @next/next/no-img-element -- a committed screenshot, sized by its capture
              <img src={src} alt={alt ?? ""} loading="lazy" />
            ) : null,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
