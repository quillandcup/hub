// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import CourseSettingsForm from "@/app/(admin)/admin/courses/[id]/CourseSettingsForm";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("CourseSettingsForm", () => {
  it("starts from the course's stored settings", () => {
    render(<CourseSettingsForm slug="the-ready-writer" accessDuration="P1Y" launchOn="2026-11-02" />);

    expect(screen.getByLabelText("Access length")).toHaveValue("1");
    expect(screen.getByLabelText("Opens (optional)")).toHaveValue("2026-11-02");
  });

  it("saves both settings, reports how many have access, and refreshes the page", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ courses: [{ access: { members: 11 } }] }) });
    render(<CourseSettingsForm slug="the-ready-writer" accessDuration="P1Y" launchOn="" />);
    await userEvent.selectOptions(screen.getByLabelText("Access length"), "6 months");
    await userEvent.type(screen.getByLabelText("Opens (optional)"), "2026-11-02");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved. 11 members have access.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "the-ready-writer", accessDuration: "6 months", launchOn: "2026-11-02" });
    expect(refresh).toHaveBeenCalled();
  });

  it("clears the launch date with null, and sends null for lifetime", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ courses: [] }) });
    render(<CourseSettingsForm slug="c" accessDuration={null} launchOn="2026-11-02" />);
    await userEvent.clear(screen.getByLabelText("Opens (optional)"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ course: "c", accessDuration: null, launchOn: null });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("shows the server's reason when saving fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "launchOn must be a YYYY-MM-DD date or null" }) });
    render(<CourseSettingsForm slug="c" accessDuration="P1Y" launchOn="" />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("launchOn must be a YYYY-MM-DD date or null");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("can't save a custom length it doesn't recognise until one is chosen", async () => {
    render(<CourseSettingsForm slug="c" accessDuration="P2Y" launchOn="" />);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Access length"), "1 year");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
