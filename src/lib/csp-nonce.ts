/**
 * The nonce the browser holds for this page, for the few libraries that add a `<style>` or `<script>` element from the client and
 * take a nonce to put on it (TipTap's `injectNonce`). Without it, the enforcing policy (src/lib/csp.ts, `style-src 'nonce-…'`) blocks
 * the element.
 *
 * It is read from the nonced script tags the server rendered, not passed down from the root layout: the document keeps the nonce of
 * the response it came from, while a layout that renders again (`router.refresh()`) would hand over a newer one the page's policy
 * does not contain. Browsers hide the `nonce` attribute's value once the page is parsed, but the element's `nonce` property keeps it.
 * Client only: it returns `undefined` on the server.
 */
export function documentNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const script = document.querySelector<HTMLScriptElement>("script[nonce]");
  return script?.nonce || script?.getAttribute("nonce") || undefined;
}
