// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import StaffDmNotice from "@/components/chat/StaffDmNotice";

afterEach(cleanup);

describe("StaffDmNotice", () => {
  it("tells a person in the conversation that the team can read it, and links to how messages are handled", () => {
    render(<StaffDmNotice staffReader={false} />);
    expect(screen.getByText(/Someone from the Quill & Cup team is in this conversation, so the team can read it\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How we handle messages" })).toHaveAttribute("href", "/privacy#staff-messages");
    expect(screen.queryByText(/recorded in the audit log/)).not.toBeInTheDocument();
  });

  it("tells a team member reading it from outside that the reading is recorded, without the messages", () => {
    render(<StaffDmNotice staffReader />);
    expect(screen.getByText(/You're reading this as a member of the team, and you're not in it\. That you opened it is recorded in the audit log, without the messages\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "How we handle messages" })).toBeInTheDocument();
  });
});
