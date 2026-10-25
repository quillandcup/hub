// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ChatChannelLoading from "@/app/(member)/chat/[id]/loading";

describe("ChatChannelLoading", () => {
  it("announces that the conversation is loading", () => {
    render(<ChatChannelLoading />);
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeInTheDocument();
  });
});
