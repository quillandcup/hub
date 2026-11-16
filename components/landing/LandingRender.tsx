import { Render, type Data } from "@puckeditor/core";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { renderConfig } from "./config";

/**
 * A landing page's document, rendered on the server with the same blocks the editor shows. The document is cleaned
 * again here (rich text to the allowlist, links to safe ones) whatever was stored, so the public page never trusts the
 * database to have been clean. Used by the public route and the admin preview.
 */
export default function LandingRender({ data }: { data: unknown }) {
  return <Render config={renderConfig} data={sanitizeLandingData(data) as unknown as Data} />;
}
