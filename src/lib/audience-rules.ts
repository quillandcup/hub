// Who may attend depends on how widely something is announced: guests can only come to something announced
// publicly, and only something listed in Events is announced publicly. The same chain holds for a prickle
// type (listed in Events -> announced publicly -> guests allowed) and for an event, which is listed by being
// an event (announced publicly -> guests allowed). The database enforces it with check constraints; the forms
// grey out a checkbox until the one before it is checked, and the routes answer a violation with a message.

export interface AudienceChain {
  listed: boolean;
  publicly: boolean;
  guests: boolean;
}

/** What is wrong with these flags, or null when they follow the chain. */
export function audienceChainError(flags: AudienceChain): string | null {
  if (flags.publicly && !flags.listed) return "Only something listed in Events can be announced publicly";
  if (flags.guests && !flags.publicly) return "Guests can only be allowed at something announced publicly";
  return null;
}

/** The flags after a change, with whatever depended on an unchecked flag unchecked too. */
export function withAudienceChange(flags: AudienceChain, change: Partial<AudienceChain>): AudienceChain {
  const next = { ...flags, ...change };
  if (!next.listed) next.publicly = false;
  if (!next.publicly) next.guests = false;
  return next;
}
