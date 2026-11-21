import type { PageBlockEditorContribution } from "@/components/landing/editor-kit";
import { eventsEditorFields } from "./events/page-blocks/editor";

/** The editor fields of the installed modules' page blocks (client only; see `index.ts`, the composition root). */
export const installedPageBlockEditors: readonly PageBlockEditorContribution[] = [eventsEditorFields];
