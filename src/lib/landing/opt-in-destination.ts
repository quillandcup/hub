import type { OptInDestination } from "./opt-in";
import { KajabiOptInDestination } from "./opt-in-kajabi";

/** The destination the relay uses. Tests swap it; a Hub destination replaces (or joins) Kajabi's when the mailing list moves (docs/TODO.md). */
export const optInDestination: { current: OptInDestination } = { current: new KajabiOptInDestination() };
