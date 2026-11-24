# Architecture

How the data and the code are put together.

<!-- START docs-index generated: run `pnpm docs:index` to update, don't edit by hand -->

- [Activity log vs. audit log](ACTIVITY_AND_AUDIT_LOG.md): Explains the activity log (`member_activities`) and the audit log (`audit_log`), and why they are two tables
- [Chat core and the Slack adapter](CHAT_MODULE.md): Describes how chat core is split from its Slack adapter behind a transport port, and what still has to move
- [Data Access Layer: Repository Catalog](DATA_ACCESS_LAYER.md): Catalog of every table or API that has a repository in `src/lib/data/`, with the rules specific to each
- [Email on the member timeline (Resend)](EMAIL_TIMELINE.md): What an email did after the Hub sent it (sent, delivered, opened, clicked, bounced, marked as spam, failed) shows on the member's timeline, next to their Slack activity and logins
- [Entity-Relationship Diagram — Hedgie Hub](ERD.md): Entity-relationship diagram of the Bronze, Local and Silver tables, with the foreign keys and processing links between them
- [The event log (design)](EVENT_LOG.md): Design for one low-level event log that consolidates the Hub's scattered behavioral logs, with its retention and erasure rules
- [Local Layer Tables](LOCAL_LAYER_TABLES.md): Catalog of the Local layer tables, the operational data this app owns and never reprocesses because they are the source of truth
- [Medallion Architecture - Hedgie Hub](MEDALLION_ARCHITECTURE.md): Explains the Medallion Architecture layers (Bronze raw imports, Local operational data, Silver canonical state) and how data flows between them
- [Member Matching Logic](MEMBER_MATCHING.md): Describes the priority rules that match Zoom attendees to members, all implemented in `src/lib/member-matching.ts`
- [Page blocks: the registry, and modules that contribute to it](PAGE_BLOCKS.md): Explains the page builder's block registry and how a module, such as events, contributes blocks to it
- [Permissions: what staff roles may do](PERMISSIONS.md): Access to the staff area is decided by permissions, not by "admin or not"
- [Integration Sequence Diagrams](SEQUENCE_DIAGRAMS.md): How each external integration gets data into the Bronze layer and triggers Silver reprocessing
- [Zoom Accounts: more than one account, and which meetings are kept](ZOOM_ACCOUNTS.md): Explains how the Hub imports meetings from more than one Zoom account and which of them count as community business
- [Stacking layers (z-index)](Z_LAYERS.md): Lists the named z-index layers that every stacked element must use, and the stacking rules around them

<!-- END docs-index -->
