/** An image URL that is safe to put in an <img src>: a blob: URL from the browser, https, or a same-site path. Anything else (javascript:, data:, ...) is dropped. */
export function safeImageSrc(src: string): string | undefined {
  if (src.startsWith("blob:") || src.startsWith("https://")) return src;
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  return undefined;
}
