import { MAX_SLUG } from "@/lib/courses/editor";
import { slugifyTitle } from "@/lib/courses/visibility";

/** The address a name would get, as the editor derives it when the address is left empty (cut to fit). */
export function addressFromTitle(title: string): string {
  return slugifyTitle(title).slice(0, MAX_SLUG).replace(/-+$/, "");
}

/** An address a duplicate gets until someone chooses one: the original's address and "-copy" (or "-copy-2"...). */
const COPY_PLACEHOLDER = /-copy(?:-\d+)?$/;

/**
 * The address to suggest after the name changed, or null when there is nothing to suggest. An address is only
 * suggested when it is "following" the name: it is what the name `baselineTitle` (the name when the form opened,
 * or when the last suggestion was taken) would have given, or it is a duplicate's placeholder ("<name>-copy") and the
 * name no longer says "copy". An address someone chose by hand is left alone. Pure.
 */
export function suggestAddress({ baselineTitle, title, slug }: { baselineTitle: string; title: string; slug: string }): string | null {
  const suggestion = addressFromTitle(title);
  const current = slug.trim();
  if (!suggestion || !current || suggestion === current) return null;
  const followsName = current === addressFromTitle(baselineTitle);
  const placeholder = COPY_PLACEHOLDER.test(current) && !/\bcopy\b/i.test(title);
  return followsName || placeholder ? suggestion : null;
}
