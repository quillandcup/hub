import { ORG_TIMEZONE } from "@/lib/config";

const parts = (instant: Date) => {
  const get = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const v = (t: string) => get.find((p) => p.type === t)!.value;
  return { date: `${v("year")}-${v("month")}-${v("day")}`, clock: `${v("hour")}:${v("minute")}` };
};

/** The inverse of `eventWindow` (in its own file so client components can use it without the server-side repositories): the dates and times to show for a window, empty times for an all-day one. */
export function windowInputs(startTime: string, endTime: string): { startDate: string; endDate: string; startClock: string; endClock: string } {
  const start = parts(new Date(startTime));
  const end = parts(new Date(endTime));
  if (start.clock === "00:00" && end.clock === "00:00") {
    const lastDay = parts(new Date(new Date(endTime).getTime() - 12 * 3600_000)).date;
    return { startDate: start.date, endDate: lastDay < start.date ? start.date : lastDay, startClock: "", endClock: "" };
  }
  return { startDate: start.date, endDate: end.date, startClock: start.clock, endClock: end.clock };
}
