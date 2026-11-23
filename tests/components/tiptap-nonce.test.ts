// @vitest-environment jsdom
/**
 * The enforcing policy (src/lib/csp.ts) allows a `<style>` only with the page's nonce, and TipTap adds its base editor CSS as a
 * `<style>` it creates itself, with the nonce from its `injectNonce` option. Without it the browser drops that CSS: editors lose
 * `white-space: break-spaces` (typed spaces misbehave) and the hidden gap cursor (Sentry HUB-17).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { documentNonce } from "@/lib/csp-nonce";

const tiptapStyle = () => document.head.querySelector<HTMLStyleElement>("style[data-tiptap-style]");

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("documentNonce", () => {
  it("is the nonce of the page's nonced script tags", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "abc123");
    document.body.appendChild(script);

    expect(documentNonce()).toBe("abc123");
  });

  it("still finds it once the browser has hidden the attribute's value (only the property keeps it)", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "");
    script.nonce = "hidden-value";
    document.body.appendChild(script);

    expect(documentNonce()).toBe("hidden-value");
  });

  it("is undefined when the page has no nonced script", () => {
    document.body.appendChild(document.createElement("script"));

    expect(documentNonce()).toBeUndefined();
  });
});

describe("TipTap's own style tag", () => {
  it("carries the page's nonce when the editor is given it", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "abc123");
    document.body.appendChild(script);

    const editor = new Editor({ extensions: [StarterKit], injectNonce: documentNonce() });

    expect(tiptapStyle()?.getAttribute("nonce")).toBe("abc123");
    expect(tiptapStyle()?.textContent).toContain(".ProseMirror");
    editor.destroy();
  });
});

describe("every editor passes the nonce", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? sources(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
    });

  it("gives `injectNonce` to each useEditor and new Editor in the app", () => {
    const creators = sources("src").filter((file) => /\buseEditor\(|new Editor\(/.test(readFileSync(file, "utf8")));

    expect(creators.length).toBeGreaterThanOrEqual(3);
    for (const file of creators) {
      const text = readFileSync(file, "utf8");
      const calls = (text.match(/\buseEditor\(|new Editor\(/g) ?? []).length;
      const nonced = (text.match(/injectNonce:\s*documentNonce\(\)/g) ?? []).length;
      expect(nonced, `${file}: every editor needs \`injectNonce: documentNonce()\` (src/lib/csp-nonce.ts)`).toBeGreaterThanOrEqual(calls);
    }
  });
});
