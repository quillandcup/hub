// @vitest-environment jsdom
/** The editor's config per kind of page: a landing page edits its own header and footer; a website page has the site's, fixed and edited in Design. */
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { CustomField } from "@puckeditor/core";
import { editorConfig, editorConfigFor } from "@/components/landing/editor-config";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";

const site = normalizeSiteTemplate({ header: { show: true, items: [{ id: "c", type: "cta", label: "Join us", href: "/join" }] }, footer: { show: true, text: "Fern Quills" } });

describe("editorConfigFor", () => {
  it("gives a landing page the config with its own header and footer fields", () => {
    const config = editorConfigFor({ pageType: "landing", site: null, editing: true });
    expect(Object.keys(config.root?.fields ?? {})).toEqual(expect.arrayContaining(["showHeader", "navLinks", "showFooter", "footerText", "footerLinks"]));
  });

  it("gives a landing page's footer text the placeholder field, offering the footer placeholders and storing the plain token", async () => {
    const config = editorConfigFor({ pageType: "landing", site: null, editing: true });
    const field = config.root?.fields?.footerText as CustomField<string>;
    expect(field.type).toBe("custom");
    const onChange = vi.fn();
    render(field.render({ value: "© {year:2019} Fern", onChange, name: "footerText", field, id: "footerText", readOnly: false } as never));
    expect(await screen.findByRole("group", { name: "Year from 2019 placeholder" })).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-preview")).toHaveTextContent(/^© 2019–\d{4} Fern$/);
    const box = screen.getByRole("textbox", { name: /Footer text/ }) as HTMLElement & { editor: Editor };
    await act(async () => {
      box.editor.chain().focus("end").insertContent(" {year}").run();
    });
    expect(onChange).toHaveBeenLastCalledWith("© {year:2019} Fern {year}");
    screen.getByRole("button", { name: "Add a placeholder" }).click();
    expect(await screen.findByRole("dialog", { name: "Placeholders" })).toBeInTheDocument();
  });

  it("gives a website page no header or footer fields, and the site's regions around its blocks", () => {
    const config = editorConfigFor({ pageType: "website", site, editing: true });
    expect(config.root?.fields).toEqual({});
    expect(Object.keys(config.components)).toEqual(Object.keys(editorConfig.components));
    const Root = config.root!.render!;
    render(<Root id="root" puck={{ renderDropZone: () => null } as never}>{<p>Page blocks</p>}</Root>);
    expect(screen.getByText("Page blocks")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join us" })).toBeInTheDocument();
    expect(screen.getByText("Fern Quills")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-site-region]")).toHaveLength(2);
  });
});
