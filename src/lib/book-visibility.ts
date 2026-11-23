import type { Visibility } from "@/lib/writing-visibility";

/**
 * Who can see a book on the Hedgie Bookshelf (`member_books.visibility`), in the words of the control on each book in My Books
 * (`VisibilityControl`: lock = only me, house = other members, globe = anyone on the web). One click moves a level on, private to
 * members to the web and back to private (`nextVisibility`). A book at the globe is on the public Hedgie Bookshelf: a page of the
 * site anyone can open, with the title, cover, author name and the link to buy it, and nothing else about the member.
 */

/** What each level means for a book, as one plain sentence (shown under the control and as the start of its hint). */
export const BOOK_LEVEL_LINES: Record<Visibility, string> = {
  private: "Only you can see this book.",
  community: "Other members can see this book on the Hedgie Bookshelf and on your profile.",
  public: "Anyone can see this book on the web, on the public Hedgie Bookshelf.",
};

/** What a click does from each level: where it goes next. */
const BOOK_CLICK_LINES: Record<Visibility, string> = {
  private: "Click to hide it from everyone but you.",
  community: "Click to show it to other members only.",
  public: "Click to show it to everyone on the web.",
};

/** The hint on the control: the level the book is at, and what a click moves it to (`next`). */
export function describeBookLevel(visibility: Visibility, next: Visibility): string {
  return `${BOOK_LEVEL_LINES[visibility]} ${BOOK_CLICK_LINES[next]}`;
}

/** The line under a book that is at the globe but has no name to carry on the web, or null. */
export const NO_WEB_AUTHOR_LINE =
  "Anyone on the web sees this book with no author name, because it has no pen name and you have no display name yet. Add a display name in Settings, or choose a pen name when you edit the book.";
