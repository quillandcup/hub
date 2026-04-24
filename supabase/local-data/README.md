# Local Data Export/Restore

This directory contains exports of **Local layer tables** - operational data we own that should be preserved across database resets.

## Why This Exists

When you run `npx supabase db reset`, it wipes out ALL data including:
- Prickle types
- Member name aliases
- Ignored zoom names
- Unmatched calendar events (with user decisions)

Bronze layer data (imports) can be re-imported, and Silver layer data (members, prickles, attendance) can be reprocessed. But Local layer data represents **your manual configuration** and needs to be preserved.

## Quick Usage

### Export Current Local Tables
```bash
./scripts/export-local-tables.sh
```

Exports to:
- `supabase/local-data/local-tables.sql` (latest)
- `supabase/local-data/backups/TIMESTAMP/` (timestamped backup)

### Restore After `db reset`
```bash
npx supabase db reset
./scripts/restore-local-tables.sh
```

This restores:
- Prickle types (with requires_host and default_host_id settings)
- Member name aliases (zoom name → member mappings)
- Member email aliases (email changes across systems)
- Ignored zoom names (bots, test users)
- Ignored slack users
- Member hiatus history
- Unmatched calendar events (with user decisions: resolved/ignored)

## When to Export

**Export before:**
- Running `npx supabase db reset`
- Making bulk changes to Local tables via UI
- Deploying to production (to copy Local data between environments)

**Automatically backed up:**
- Each export creates a timestamped backup in `backups/TIMESTAMP/`
- Safe to run frequently

## Files in This Directory

- `local-tables.sql` - Latest export (ready to restore)
- `backups/` - Timestamped backup snapshots
- `README.md` - This file

## Architecture Note

Per `docs/superpowers/specs/architecture-foundation.md`:

- **Bronze layer**: Raw imports from external systems (re-importable)
- **Local layer**: Operational data we own (THIS - must preserve)
- **Silver layer**: Derived from Bronze + Local (reprocessable)

Local layer is the only layer that **cannot** be regenerated from source data.
