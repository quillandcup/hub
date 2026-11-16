// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/media/MediaPicker", () => ({
  default: ({ value, onChange, surface }: { value: string | null; onChange: (id: string | null) => void; surface: string }) => (
    <div data-surface={surface} data-value={value ?? ""}>
      <button onClick={() => onChange("media_AAAAAAAAAAA1")}>choose</button>
      <button onClick={() => onChange(null)}>remove</button>
    </div>
  ),
}));

import { ImageField, RichTextField } from "@/components/landing/fields";
import { editorConfig } from "@/components/landing/editor-config";

afterEach(cleanup);

describe("ImageField", () => {
  it("picks from the media library on the page builder's surface and hands back an id, or an empty string when removed", () => {
    const onChange = vi.fn();
    const { container } = render(<ImageField value={undefined} onChange={onChange} />);
    expect(container.firstElementChild).toHaveAttribute("data-surface", "landing_page");
    fireEvent.click(screen.getByText("choose"));
    expect(onChange).toHaveBeenLastCalledWith("media_AAAAAAAAAAA1");
    fireEvent.click(screen.getByText("remove"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("RichTextField", () => {
  it("shows the text with a formatting toolbar and reports changes as HTML", async () => {
    const onChange = vi.fn();
    render(<RichTextField label="Text" value="<p>Hello</p>" onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeInTheDocument());
    expect(screen.getByLabelText("Text")).toHaveTextContent("Hello");
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove link" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Text style"), { target: { value: "h2" } });
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
  });
});

describe("the custom fields in the editor's config", () => {
  type Custom = { type: "custom"; render: (p: { value: unknown; onChange: (v: unknown) => void; name: string; id: string; field: unknown }) => React.ReactNode };
  const field = (block: string, name: string) => editorConfig.components[block].fields?.[name] as unknown as Custom;
  const call = (f: Custom, value: unknown, onChange = vi.fn()) => f.render({ value, onChange, name: "x", id: "x", field: f });

  it("renders the picture, text and date fields", async () => {
    render(<>{call(field("Image", "imageAssetId"), "media_AAAAAAAAAAA1")}</>);
    expect(screen.getByText("choose")).toBeInTheDocument();
    cleanup();
    render(<>{call(field("RichText", "html"), "<p>Hi</p>")}</>);
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeInTheDocument());
    cleanup();
    render(<>{call(field("Countdown", "targetAt"), "2027-01-15T14:00:00.000Z")}</>);
    expect(screen.getByLabelText("Counts down to")).toHaveValue("2027-01-15T09:00");
  });
});
