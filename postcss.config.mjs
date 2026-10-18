import { fileURLToPath } from "node:url";

// Turbopack resolves plugin names from inside .next, so the local plugin needs an absolute path.
const tailwindSkippingVendorLayers = fileURLToPath(new URL("./postcss-tailwind-skip-vendor-layers.mjs", import.meta.url));

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    [tailwindSkippingVendorLayers]: {},
    autoprefixer: {},
  },
};

export default config;
