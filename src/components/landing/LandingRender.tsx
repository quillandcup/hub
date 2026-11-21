import { Render, type Data } from "@puckeditor/core";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { renderConfig, renderConfigFor, type FrameContext } from "./config";

/**
 * A landing page's document, rendered on the server with the same blocks the editor shows. The document is cleaned
 * again here (rich text to the allowlist, links to safe ones) whatever was stored, so the public page never trusts the
 * database to have been clean. Used by the public route and the admin preview. A website page passes its `frame`, which
 * brings in the site's shared header and footer (the published copy for visitors, the draft in the preview).
 */
export default function LandingRender({ data, frame }: { data: unknown; frame?: FrameContext }) {
  return <Render config={frame ? renderConfigFor(frame) : renderConfig} data={sanitizeLandingData(data) as unknown as Data} />;
}
