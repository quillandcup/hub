# Architecture

How the data and the code are put together.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Activity log vs. audit log](ACTIVITY_AND_AUDIT_LOG.md): Two distinct systems, both "who did what when," but with a different subject — kept as two tables rather than one shared table
- [Chat core and the Slack adapter](CHAT_MODULE.md): Chat is a conversation product: messages, channels, threads, reactions, files, rich text, link previews, drafts, search, unread counts, notifications
- [Data Access Layer: Repository Catalog](DATA_ACCESS_LAYER.md): The rule and the conventions are in `.claude/rules/data-access-layer.md` (loaded when you touch `src/lib/data/`, API routes or actions)
- [Email on the member timeline (Resend)](EMAIL_TIMELINE.md): What an email did after the Hub sent it (sent, delivered, opened, clicked, bounced, marked as spam, failed) shows on the member's timeline, next to their Slack activity and logins
- [Entity-Relationship Diagram — Hedgie Hub](ERD.md): Reconstructed from the full migration history (`supabase/migrations/`, 87 files) plus verification against current application code
- [The event log (design)](EVENT_LOG.md): This is engineering's reading of the regulators' published guidance, not legal advice
- [Local Layer Tables](LOCAL_LAYER_TABLES.md): Operational data this app owns; never reprocessed (these tables are the source of truth)
- [Medallion Architecture - Hedgie Hub](MEDALLION_ARCHITECTURE.md): This system uses a Medallion Architecture with Bronze (raw imports), Local (operational), and Silver (canonical) layers
- [Member Matching Logic](MEMBER_MATCHING.md): All member name matching for Zoom attendance processing uses the centralized logic in `src/lib/member-matching.ts`
- [Page blocks: the registry, and modules that contribute to it](PAGE_BLOCKS.md): The page builder (Landing pages) offers blocks
- [Permissions: what staff roles may do](PERMISSIONS.md): Access to the staff area is decided by permissions, not by "admin or not"
- [Integration Sequence Diagrams](SEQUENCE_DIAGRAMS.md): How each external integration gets data into the Bronze layer and triggers Silver reprocessing
- [Zoom Accounts: more than one account, and which meetings are kept](ZOOM_ACCOUNTS.md): Quill & Cup hosts prickles and events on a primary Zoom account
- [Stacking layers (z-index)](Z_LAYERS.md): Never write a number (`z-30`, `z-[55]`)

<!-- END docs-index -->
