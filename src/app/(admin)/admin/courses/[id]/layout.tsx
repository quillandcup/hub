import type { ReactNode } from "react";

/** The course's pages, with the `@modal` slot that opens a lesson's watch stats over whichever of them the link was clicked on. */
export default function CourseLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
