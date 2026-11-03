import { describe, it, expect, beforeEach } from "vitest";
import type { NewResendEvent, ResendEventRepository } from "@/lib/data/resend";

export type ResendEventContractContext = {
  repo: () => ResendEventRepository;
  /** A string no other run has used. */
  unique: (label: string) => string;
  /** Removes every event this run wrote. */
  clear: () => Promise<void>;
};

/** Behavior every `ResendEventRepository` must have; run against the in-memory twin (unit) and Supabase (db). */
export function defineResendEventContract(name: string, setup: () => ResendEventContractContext) {
  describe(`${name} (ResendEventRepository contract)`, () => {
    let ctx: ResendEventContractContext;
    beforeEach(async () => {
      ctx = setup();
      await ctx.clear();
    });

    const event = (emailId: string, type: string, occurredAt: string, extra: Partial<NewResendEvent> = {}): NewResendEvent => ({
      event_id: ctx.unique(`evt-${type}`),
      event_type: type,
      email_id: emailId,
      occurred_at: occurredAt,
      recipients: ["ada@example.com"],
      subject: "Hello",
      raw_payload: { type },
      ...extra,
    });

    it("stores events and reads an email's back oldest first, without the raw payload", async () => {
      const email = ctx.unique("email");
      await ctx.repo().record([
        event(email, "email.opened", "2097-02-01T10:05:00Z", { tags: { kind: "prickle_checkin" } }),
        event(email, "email.sent", "2097-02-01T10:00:00Z", { from_address: "Hub <hub@example.com>" }),
        event(email, "email.clicked", "2097-02-01T10:06:00Z", { link: "https://example.com/a", detail: null }),
      ]);

      const events = await ctx.repo().eventsForEmails([email, "nope"]);
      expect(events.map((e) => e.event_type)).toEqual(["email.sent", "email.opened", "email.clicked"]);
      expect(events[0]).toMatchObject({ email_id: email, from_address: "Hub <hub@example.com>", recipients: ["ada@example.com"], subject: "Hello" });
      expect(events[1].tags).toEqual({ kind: "prickle_checkin" });
      expect(events[2].link).toBe("https://example.com/a");
      expect(events[0].id).toMatch(/^rsev_/);
      expect(events[0]).not.toHaveProperty("raw_payload");
    });

    it("skips an event it already has, by event id, so a webhook retry writes nothing new", async () => {
      const email = ctx.unique("email");
      const sent = event(email, "email.sent", "2097-02-01T10:00:00Z");
      await ctx.repo().record([sent]);
      await ctx.repo().record([sent, { ...sent, subject: "Retried" }]);

      const events = await ctx.repo().eventsForEmails([email]);
      expect(events).toHaveLength(1);
      expect(events[0].subject).toBe("Hello");
    });

    it("reads the events of more emails than one query holds", async () => {
      const emails = Array.from({ length: 130 }, (_, i) => ctx.unique(`bulk${i}`));
      await ctx.repo().record(emails.map((email) => event(email, "email.sent", "2097-02-02T10:00:00Z")));
      expect(await ctx.repo().eventsForEmails(emails)).toHaveLength(130);
    });

    it("lists the emails that had an event since a time, once each and sorted", async () => {
      const [old, recent, twice] = [ctx.unique("a-old"), ctx.unique("b-recent"), ctx.unique("c-twice")];
      await ctx.repo().record([
        event(old, "email.sent", "2097-03-01T10:00:00Z"),
        event(recent, "email.sent", "2097-03-10T10:00:00Z"),
        event(twice, "email.sent", "2097-03-10T10:00:00Z"),
        event(twice, "email.opened", "2097-03-11T10:00:00Z"),
      ]);

      const ids = await ctx.repo().emailIdsSince("2097-03-05T00:00:00Z");
      expect(ids.filter((id) => [old, recent, twice].includes(id))).toEqual([recent, twice]);
    });

    it("does nothing for no events and no emails", async () => {
      await ctx.repo().record([]);
      expect(await ctx.repo().eventsForEmails([])).toEqual([]);
    });
  });
}
