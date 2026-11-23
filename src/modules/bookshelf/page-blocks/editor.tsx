"use client";

import type { PageBlockEditorContribution } from "@/components/landing/editor-kit";
import { BOOKSHELF_MAX_BOOKS } from "./live-books";

/** The editor fields of the Hedgie Bookshelf block (the editor side of `index.ts`). */
export const bookshelfEditorFields: PageBlockEditorContribution = {
  id: "bookshelf",
  fields: ({ text, select }) => ({
    HedgieBookshelf: {
      heading: text("Heading above the books (optional)"),
      intro: text("A line under the heading (optional)"),
      genre: text("Only books with this genre (optional, for example Fantasy; empty shows every genre)"),
      max: { type: "number", label: `Most books to load, newest first (1 to ${BOOKSHELF_MAX_BOOKS})`, min: 1, max: BOOKSHELF_MAX_BOOKS },
      firstShown: { type: "number", label: "How many show before the Show more books button (1 to 100)", min: 1, max: 100 },
      emptyText: text("Line to show when there are no books yet (empty draws nothing)"),
      padding: select("Space above and below", [
        { label: "None", value: "none" },
        { label: "Small", value: "small" },
        { label: "Medium", value: "medium" },
        { label: "Large", value: "large" },
      ]),
    },
  }),
};
