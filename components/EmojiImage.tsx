import { looksAnimated } from "@/lib/animations";

/**
 * A custom emoji's image. One that moves and has no still of its own (not copied into our storage yet, so it is on
 * Slack's CDN, which can't be read to make one) is paired with its `:name:` text: with Animations off the page's CSS
 * (globals.css) hides the image and shows the text, so it never moves against the member's choice and is never broken.
 */
export default function EmojiImage({ name, url, still, title }: { name: string; url: string; still?: string; title?: string }) {
  const noStill = !still && looksAnimated(url);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- small emoji images; no sizing to optimise */}
      <img
        // With animations off, AnimationsController may swap src for a still before React hydrates this image.
        suppressHydrationWarning
        src={url}
        data-still={still}
        data-no-still={noStill ? "" : undefined}
        alt={`:${name}:`}
        title={title ?? `:${name}:`}
        loading="lazy"
        decoding="async"
        className="inline-block h-[1.25em] w-[1.25em] align-text-bottom"
      />
      {noStill && (
        <span data-emoji-fallback hidden title={`:${name}:`}>
          :{name}:
        </span>
      )}
    </>
  );
}
