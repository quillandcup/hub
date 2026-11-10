// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusedMessageDomId, hashMessageId, scrollToHashMessage } from "@/lib/chat/scroll";

beforeEach(() => {
  document.body.innerHTML = '<div id="list"><article id="m-msg_AAAAAAAAAAA1">one</article><article id="m-msg_AAAAAAAAAAA2">two</article></div>';
  window.location.hash = "";
});
afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("focusedMessageDomId", () => {
  it("is the server's ?m= message when there is one, over the URL's #hash", () => {
    window.location.hash = "#m-msg_AAAAAAAAAAA2";

    expect(focusedMessageDomId("msg_AAAAAAAAAAA1")).toBe("m-msg_AAAAAAAAAAA1");
  });

  it("falls back to the #hash, and is null with neither", () => {
    window.location.hash = "#m-msg_AAAAAAAAAAA2";
    expect(focusedMessageDomId(null)).toBe("m-msg_AAAAAAAAAAA2");
    expect(focusedMessageDomId()).toBe(hashMessageId());

    window.location.hash = "";
    expect(focusedMessageDomId(null)).toBeNull();
  });
});

describe("scrollToHashMessage", () => {
  it("scrolls to and highlights the message a ?m= link names, with no #hash at all", () => {
    const el = document.getElementById("m-msg_AAAAAAAAAAA1")!;
    const animate = vi.fn();
    el.animate = animate as never;

    expect(scrollToHashMessage(document.getElementById("list"), "msg_AAAAAAAAAAA1")).toBe(true);
    expect(animate).toHaveBeenCalled();
  });

  it("scrolls to the #hash message when there is no ?m=, as before", () => {
    window.location.hash = "#m-msg_AAAAAAAAAAA2";
    const el = document.getElementById("m-msg_AAAAAAAAAAA2")!;
    el.animate = vi.fn() as never;

    expect(scrollToHashMessage(document.getElementById("list"))).toBe(true);
    expect(el.animate).toHaveBeenCalled();
  });

  it("says no when the message isn't on the page (yet), or none is named", () => {
    expect(scrollToHashMessage(document.getElementById("list"), "msg_AAAAAAAAAAA9")).toBe(false);
    expect(scrollToHashMessage(document.getElementById("list"))).toBe(false);
  });
});
