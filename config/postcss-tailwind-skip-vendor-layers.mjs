import tailwindcss from "tailwindcss";

// Tailwind v3 throws on any stylesheet that has `@layer base|components|utilities` without a matching `@tailwind`
// directive, and the Video.js skin (`@videojs/react/video/skin.css`) is written with native cascade layers. Those
// layers are meant to stay native (they keep the skin below unlayered app CSS), so Tailwind just skips the file.
const SKIPPED = ["/node_modules/@videojs/"];

export default function tailwindSkippingVendorLayers(options) {
  const tailwind = tailwindcss(options);
  return {
    postcssPlugin: "tailwindcss",
    plugins: tailwind.plugins.map((plugin) => (root, result) => {
      const file = root.source?.input.file ?? "";
      if (SKIPPED.some((part) => file.includes(part))) return undefined;
      return plugin(root, result);
    }),
  };
}

tailwindSkippingVendorLayers.postcss = true;
