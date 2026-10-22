/** An image URL that is safe to put in an <img src>: a blob: URL from the browser, https, or a same-site path. Anything else (javascript:, data:, ...) is dropped. */
export function safeImageSrc(src: string): string | undefined {
  return /^(blob:|https:\/\/|\/(?!\/))/.test(src) ? src : undefined;
}
