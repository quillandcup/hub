/**
 * The marks of the Social icons block that are NOT the networks' own artwork, drawn by hand for this project. Three, and each for a reason:
 * LinkedIn is not in the `simple-icons` package that `brand-icons.generated.ts` is made from (a simple rounded square with the letters "in",
 * in LinkedIn's blue), and Email and Website are not brands at all (a plain outline, black). Everything else is generated from the networks'
 * real marks: run `pnpm brand-icons:update`, never edit that file. A mark here is on the same 24 x 24 grid with the same fields; `stroke`
 * says it is an outline (drawn with a line, no fill) instead of a solid shape, `evenodd` that its cut-outs use the even-odd fill rule.
 */
export type DrawnMark = { title: string; hex: string; path: string; stroke?: boolean; evenodd?: boolean };

export const DRAWN_MARKS = {
  linkedin: {
    title: "LinkedIn",
    hex: "0A66C2",
    evenodd: true,
    // A rounded square with three cut-outs (the dot, the bar and the "n"), filled with the even-odd rule.
    path: "M5 2h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM7 5.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM5.8 10h2.4v8H5.8zM10 10h2.3v1.1c.4-.7 1.3-1.3 2.5-1.3 2.2 0 3.2 1.3 3.2 3.6V18h-2.4v-4.1c0-1.1-.4-1.8-1.4-1.8s-1.8.7-1.8 1.9V18H10z",
  },
  email: { title: "Email", hex: "000000", stroke: true, path: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3.5 7l8.5 6 8.5-6" },
  website: { title: "Website", hex: "000000", stroke: true, path: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z" },
} as const satisfies Record<string, DrawnMark>;
