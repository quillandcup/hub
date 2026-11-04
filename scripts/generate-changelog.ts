import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderChangelogMarkdown } from "@/lib/changelog";

// Rewrites CHANGELOG.md from lib/changelog/entries.ts. A test fails when the committed file is stale.
writeFileSync(path.join(process.cwd(), "CHANGELOG.md"), renderChangelogMarkdown());
console.log("CHANGELOG.md written");
