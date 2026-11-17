import { strToU8, zipSync } from "fflate";

/**
 * A small, made-up Kajabi page export for tests (the shape of `config/settings_data.json`: sections with typed blocks
 * and their settings). Nothing here comes from a real page.
 */

type Settings = Record<string, unknown>;
export const block = (type: string, settings: Settings, over: Record<string, unknown> = {}) => ({ name: type, type, hidden: "false", settings, ...over });

export function exportSettings(over: { sections?: Record<string, unknown>; order?: string[]; extra?: Record<string, unknown> } = {}) {
  return {
    current: {
      btn_border_radius: "100",
      content_for_index: ["", ...(over.order ?? ["main_section"])],
      sections: {
        main_section: {
          type: "section",
          settings: { background_color: "#8e583d", full_width: false, horizontal: "center", padding_desktop: { top: "0", bottom: "0" }, bg_type: "none" },
          block_order: ["1600000000100_0", "1600000000200_0", "1600000000300_0", "1600000000400_0", "1600000000500_0", "1600000000600_0"],
          blocks: {
            "1600000000100_0": block("text", {
              width: "7",
              text_align: "center",
              text: '<h1 style="text-align: center;"><span>Write a little, every day</span> <br /><!-- HEADLINE_END --></h1>\n<div style="padding: 5px;"><hr style="width: 30px;" /></div>\n<p><span>Join the </span><strong>Example Sprint</strong> &amp; see.</p>\n<p><script>alert(1)</script><span>Second paragraph.</span></p>\n<h4>Small heading</h4>\n<p style="text-align: center;"><span><!-- EMPTY --></span></p>',
            }),
            "1600000000200_0": block("cta", { width: "5", btn_text: "Read more<br>here", btn_action: "https://example.com/more", btn_background_color: "#a64d79", btn_text_color: "#ffffff", btn_width: "full", text_align: "center" }),
            "1600000000300_0": block("cta", { width: "5", btn_text: "Dark one", btn_action: "/resource_redirect/landing_pages/1", btn_background_color: "#000000", btn_text_color: "#ffffff", btn_width: "full" }),
            "1600000000400_0": block("cta", { width: "5", btn_text: "Old offer", btn_action: "https://example.com/old", btn_background_color: "#a64d79" }, { hidden: "true" }),
            "1600000000500_0": block("form", { width: "7", form: "123456", text: "<h4>Join the list</h4><p>Short line.</p>", btn_text: "Sign me up", disclaimer_text: "No spam.", thank_you: "" }),
            "1600000000600_0": block("image", { width: "7", image: "assets/photo.png", image_alt: "" }),
          },
        },
        header: {
          type: "header",
          settings: { hide_on_desktop: false, hide_on_mobile: false },
          block_order: ["1600000000010_0"],
          blocks: { "1600000000010_0": block("logo", { logo: "file-uploads/sites/1/images/banner_abc.png", image_alt: "Header Logo", logo_width: "650", alignment: "center", logo_type: "image" }) },
        },
        footer: { type: "footer", settings: {}, block_order: ["1600000000020_0"], blocks: { "1600000000020_0": block("copyright", { copyright: "Example Press LLC" }) } },
        ...over.sections,
      },
      ...over.extra,
    },
  };
}

/** A minimal PNG (1x1), so picture storing has real bytes to inspect. */
export const PNG_1X1 = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

export function exportZip(settings: unknown = exportSettings(), extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "encore-page/config/settings_data.json": strToU8(JSON.stringify(settings)),
    "encore-page/assets/photo.png": PNG_1X1,
    "encore-page/assets/scripts.js": strToU8("console.log('never read')"),
    ...extra,
  });
}
