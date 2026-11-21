## confirmations

**RULE**: Ask before something that can't be taken back or that other people will see, with `src/components/ConfirmDialog.tsx`: `<ConfirmDialog>` when the action is async or can fail, `useConfirm()` where a handler used to say `if (!confirm(...)) return;` (`const { ask, dialog } = useConfirm()`, `if (!(await ask({ title, body, confirmLabel }))) return;`, render `{dialog}` once). Never the browser's `confirm`: `tests/lib/confirm-dialog.test.ts` fails on a new one. Files that predate this are in its shrink-only baseline; convert one as you touch it and lower its entry (`docs/TODO.md`, "Move the browser confirms onto ConfirmDialog").

**When to ask**
- Ask for: deleting, discarding or replacing work (reset to published, bring a version back), taking something off the public site, anything that messages or affects many people, anything with no undo.
- Don't ask for what the person can reverse in one click, that only changes how they see things (a sort, a filter, collapsing a panel), or that has an undo: a confirm on everything teaches people to click through.

**Wording** (the same shape everywhere)
- **Title**: a question naming the thing, "Delete lesson?", "Take this page down?". Not "Are you sure?" or "Confirm".
- **Body**: what happens, in plain words, and whether it can be undone ("This can't be undone."). Say what goes with it ("Its 3 lessons are deleted with it."). Don't repeat the title.
- **Confirm button**: names the action, with the same verb as the control that opened it ("Delete lesson", "Bring back", "Unpublish"). Never "OK" or "Yes".
- **Cancel button**: "Cancel" (a different label only where it reads better and is still obvious, such as "Keep it"). Focus starts on it, so a stray Enter never confirms.
- **Tone**: `danger` (red) when something is destroyed or discarded, the default otherwise (inviting people, making things live).

**Typing to confirm** (`requireText`) is for what is both wide and unrecoverable (removing a member, deleting a course with its enrolments). The text is the object's name, shown in the label. It is not for ordinary deletes.

**Async and errors**: `onConfirm` may return a promise. The dialog waits, then closes; if it returns a string, that is the reason it failed and the dialog stays open, showing it. A dialog opened on top of another (a confirm inside the version list) takes Escape alone (`Modal` keeps a stack).

**Not a confirm**: a notice that needs only an "OK" is a banner or toast; a form that asks for input is a `Modal`. The inline "Yes, delete / Keep it" of the comment moderation buttons is a deliberate in-row version for a dense list, not a pattern to copy elsewhere.
