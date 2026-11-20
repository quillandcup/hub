// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  restore: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  versions: vi.fn(),
  outline: vi.fn(),
  create: vi.fn(),
  createAi: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: vi.fn() }) }));
vi.mock("../../app/(admin)/admin/pages/actions", () => ({ createLandingPage: mocks.create, createLandingPageWithAi: mocks.createAi }));
vi.mock("../../app/(admin)/admin/pages/template-actions", () => ({
  saveLandingTemplate: mocks.save,
  restoreLandingTemplateVersion: mocks.restore,
  updateLandingTemplateDetails: mocks.rename,
  deleteLandingTemplate: mocks.remove,
  loadLandingTemplateVersions: mocks.versions,
  loadLandingTemplateOutline: mocks.outline,
}));

import SaveAsTemplate from "@/app/(admin)/admin/pages/[slug]/SaveAsTemplate";
import StarterReplace from "@/app/(admin)/admin/pages/[slug]/StarterReplace";
import NewPageForm from "@/app/(admin)/admin/pages/new/NewPageForm";
import TemplatesPanel, { type TemplateRow } from "@/app/(admin)/admin/pages/templates/TemplatesPanel";

const draft = { content: [{ type: "Heading", props: { id: "h", text: "Hi" } }], root: {} };
const kit = { id: "lpgt_AAAAAAAAAAA1", name: "Launch kit", description: "For launches", version: 2 };

const answer = (name: string) =>
  act(async () => {
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name }));
  });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.save.mockResolvedValue({ templateId: "lpgt_BBBBBBBBBBB2", name: "Spring", version: 1 });
  mocks.create.mockResolvedValue({ slug: "my-page" });
  mocks.rename.mockResolvedValue({});
  mocks.remove.mockResolvedValue({});
  mocks.restore.mockResolvedValue({ version: 4 });
});
afterEach(cleanup);

describe("Save as template", () => {
  const open = async (templates = [kit]) => {
    render(<SaveAsTemplate templates={templates} getDraft={() => draft} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save as template/ }));
    });
  };

  it("saves a new template with its name, description and note, and names the version it made", async () => {
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Spring" } });
    fireEvent.change(within(dialog).getByLabelText("Description (optional)"), { target: { value: "A start" } });
    fireEvent.change(within(dialog).getByLabelText("What changed? (optional)"), { target: { value: "first" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save as template" }));
    });
    expect(mocks.save).toHaveBeenCalledWith(draft, { name: "Spring", description: "A start", note: "first" });
    expect(screen.getByRole("status")).toHaveTextContent("Saved as version 1 of Spring.");
    expect(screen.getByRole("button", { name: "Save another" })).toBeInTheDocument();
  });

  it("asks before overwriting, saying the old version is kept, and then saves the next version", async () => {
    mocks.save.mockResolvedValue({ templateId: kit.id, name: kit.name, version: 3 });
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Overwrite an existing template"));
    expect(within(dialog).getByLabelText("Template to overwrite")).toHaveValue(kit.id);
    expect(within(dialog).getByLabelText("Description (optional)")).toHaveValue("For launches");
    fireEvent.change(within(dialog).getByLabelText("What changed? (optional)"), { target: { value: "Better headline" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Overwrite template" }));
    });
    expect(mocks.save).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    expect(within(confirm).getByText("Overwrite this template?")).toBeInTheDocument();
    expect(confirm).toHaveTextContent("keeps its current version in its history, and you can bring it back");
    await answer("Overwrite template");
    expect(mocks.save).toHaveBeenCalledWith(draft, { overwriteId: kit.id, description: "For launches", note: "Better headline" });
    expect(screen.getByRole("status")).toHaveTextContent("Saved as version 3 of Launch kit.");
  });

  it("saves nothing when the overwrite is cancelled", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Overwrite an existing template"));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Overwrite template" }));
    });
    await answer("Cancel");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("offers only a new template when there are none to overwrite, and needs a name", async () => {
    await open([]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Overwrite an existing template")).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the template a name.");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the save is refused", async () => {
    mocks.save.mockResolvedValue({ error: "A template with that name already exists." });
    await open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch kit" } });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save as template" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("Start over lists", () => {
  const starters = [
    { key: "home", label: "Homepage", description: "The front door" },
    { key: kit.id, label: kit.name, description: "For launches", group: "template" as const },
  ];

  it("groups the built-in starters and the saved templates, and says template for a template", async () => {
    const onReplace = vi.fn().mockResolvedValue(null);
    render(<StarterReplace starters={starters} onReplace={onReplace} />);
    const select = screen.getByLabelText("Starter");
    expect(within(select).getByRole("group", { name: "Built in" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Saved templates" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start over from a starter or template" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: kit.id } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace draft with template" }));
    });
    expect(screen.getByText("Replace your draft with the Launch kit template?")).toBeInTheDocument();
    await answer("Replace draft");
    expect(onReplace).toHaveBeenCalledWith(kit.id);
  });

  it("stays a plain starter list when there are no templates", () => {
    render(<StarterReplace starters={[starters[0]]} onReplace={vi.fn()} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("heading", { name: "Start over from a starter" })).toBeInTheDocument();
  });
});

describe("New page from a template", () => {
  it("lists built-in starters and saved templates apart and creates the page from the template", async () => {
    render(<NewPageForm aiAvailable={false} templates={[{ id: kit.id, name: kit.name, description: kit.description }]} />);
    const select = screen.getByLabelText(/Start from/);
    expect(within(select).getByRole("group", { name: "Built in" })).toBeInTheDocument();
    expect(within(select).getByRole("group", { name: "Saved templates" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: kit.id } });
    expect(screen.getByLabelText("Title")).toHaveValue("Launch kit");
    expect(screen.getByText(/For launches It is saved as a draft/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: "Launch kit", slug: "", template: kit.id });
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/my-page");
  });

  it("has no saved-templates group when there are none, and shows an error", async () => {
    mocks.create.mockResolvedValue({ error: "That template no longer exists." });
    render(<NewPageForm aiAvailable={false} />);
    expect(screen.queryByRole("group", { name: "Saved templates" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("no longer exists");
  });
});

describe("the Templates list", () => {
  const rows: TemplateRow[] = [
    { id: kit.id, name: "Launch kit", description: "For launches", versions: 3, updatedBy: "Bramble Admin", updatedAt: "2027-01-02T00:00:00Z" },
    { id: "lpgt_CCCCCCCCCCC3", name: "Waitlist", description: "", versions: 1, updatedBy: "An admin", updatedAt: "2027-01-05T00:00:00Z" },
  ];

  it("lists templates with description, versions and who changed them last, and says what to do when there are none", () => {
    const { unmount } = render(<TemplatesPanel templates={rows} />);
    const first = screen.getAllByRole("row")[1];
    expect(within(first).getByText("Launch kit")).toBeInTheDocument();
    expect(within(first).getByText("For launches")).toBeInTheDocument();
    expect(within(first).getByText("3")).toBeInTheDocument();
    expect(within(first).getByText("by Bramble Admin")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "wait" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    unmount();
    render(<TemplatesPanel templates={[]} />);
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
  });

  it("uses a template: asks for the page's title and address and opens the new draft", async () => {
    render(<TemplatesPanel templates={rows} />);
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Use" }));
    const dialog = screen.getByRole("dialog", { name: "New page from Launch kit" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Spring launch" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: "Spring launch", slug: "spring-launch", template: kit.id });
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/my-page");
  });

  it("renames a template and refreshes, showing the server's reason when it is refused", async () => {
    render(<TemplatesPanel templates={rows} />);
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Rename template" }));
    const dialog = screen.getByRole("dialog", { name: "Rename template" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch kit 2" } });
    mocks.rename.mockResolvedValueOnce({ error: "A template with that name already exists." });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already exists");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(mocks.rename).toHaveBeenLastCalledWith(kit.id, { name: "Launch kit 2", description: "For launches" });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("deletes after asking, and says why when it can't", async () => {
    render(<TemplatesPanel templates={rows} />);
    await act(async () => {
      fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Delete template" }));
    });
    expect(screen.getByText("Delete template?")).toBeInTheDocument();
    mocks.remove.mockResolvedValueOnce({ error: "That template no longer exists." });
    await answer("Delete template");
    expect(mocks.remove).toHaveBeenCalledWith(kit.id);
    expect(await screen.findByRole("status")).toHaveTextContent("no longer exists");
    await act(async () => {
      fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Delete template" }));
    });
    await answer("Delete template");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  describe("History", () => {
    const versions = [
      { id: "lpgtv_AAAAAAAAAAA3", version: 3, kind: "restored", note: null, name: "Launch kit", by: "Bramble Admin", createdAt: "2027-01-05T00:00:00Z" },
      { id: "lpgtv_AAAAAAAAAAA2", version: 2, kind: "overwritten", note: "Better headline", name: "Launch kit", by: "An admin", createdAt: "2027-01-03T00:00:00Z" },
      { id: "lpgtv_AAAAAAAAAAA1", version: 1, kind: "created", note: null, name: "Launch kit", by: "An admin", createdAt: "2027-01-02T00:00:00Z" },
    ];
    const open = async () => {
      mocks.versions.mockResolvedValue({ versions });
      render(<TemplatesPanel templates={rows} />);
      await act(async () => {
        fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "History" }));
      });
      return screen.getByRole("dialog", { name: "History of Launch kit" });
    };

    it("lists every version with who, when, how it came to be and the note, marking the current one", async () => {
      const dialog = await open();
      expect(mocks.versions).toHaveBeenCalledWith(kit.id);
      expect(await within(dialog).findByText("Version 3 (current) · Brought back")).toBeInTheDocument();
      expect(within(dialog).getByText("Version 2 · Saved over")).toBeInTheDocument();
      expect(within(dialog).getByText("Version 1 · First saved")).toBeInTheDocument();
      expect(within(dialog).getByText("“Better headline”")).toBeInTheDocument();
      expect(within(dialog).getAllByRole("button", { name: "Bring back" })).toHaveLength(2);
    });

    it("looks inside a version as block counts", async () => {
      mocks.outline.mockResolvedValue({ blocks: [{ type: "ImageText", count: 2 }, { type: "Heading", count: 1 }] });
      const dialog = await open();
      await within(dialog).findByText("Version 2 · Saved over");
      await act(async () => {
        fireEvent.click(within(dialog).getAllByRole("button", { name: "Look inside" })[1]);
      });
      expect(mocks.outline).toHaveBeenCalledWith("lpgtv_AAAAAAAAAAA2");
      expect(within(dialog).getByText("Image text × 2, Heading × 1")).toBeInTheDocument();
    });

    it("brings a version back after asking, as a new version, and refreshes the list", async () => {
      const dialog = await open();
      await within(dialog).findByText("Version 2 · Saved over");
      await act(async () => {
        fireEvent.click(within(dialog).getAllByRole("button", { name: "Bring back" })[1]);
      });
      expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent("Version 1 becomes the template's newest version");
      await answer("Bring back");
      expect(mocks.restore).toHaveBeenCalledWith("lpgtv_AAAAAAAAAAA1");
      expect(await within(dialog).findByRole("status")).toHaveTextContent("Brought back as version 4.");
      expect(mocks.versions).toHaveBeenCalledTimes(2);
      expect(mocks.refresh).toHaveBeenCalled();
    });

    it("shows the server's reason when the history can't load or a version can't be opened or brought back", async () => {
      mocks.versions.mockResolvedValueOnce({ error: "That template no longer exists." });
      render(<TemplatesPanel templates={rows} />);
      await act(async () => {
        fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "History" }));
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
      cleanup();

      mocks.outline.mockResolvedValue({ error: "That version no longer exists." });
      mocks.restore.mockResolvedValue({ error: "Couldn't bring that version back." });
      const dialog = await open();
      await within(dialog).findByText("Version 2 · Saved over");
      await act(async () => {
        fireEvent.click(within(dialog).getAllByRole("button", { name: "Look inside" })[0]);
      });
      await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("That version no longer exists."));
      await act(async () => {
        fireEvent.click(within(dialog).getAllByRole("button", { name: "Bring back" })[0]);
      });
      await answer("Bring back");
      await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Couldn't bring that version back."));
    });
  });
});
