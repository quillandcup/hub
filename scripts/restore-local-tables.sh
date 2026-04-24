#!/bin/bash
# Restore Local layer tables from export

set -e

EXPORT_FILE="${1:-supabase/local-data/local-tables.sql}"

if [ ! -f "$EXPORT_FILE" ]; then
  echo "Error: Export file not found: $EXPORT_FILE"
  echo ""
  echo "Usage:"
  echo "  ./scripts/restore-local-tables.sh [export-file]"
  echo ""
  echo "Run ./scripts/export-local-tables.sh first to create the export."
  exit 1
fi

# Get database connection details
DB_URL=$(npx supabase status 2>&1 | grep -oP 'postgresql://[^\s]+')

if [ -z "$DB_URL" ]; then
  echo "Error: Could not get database URL. Is Supabase running?"
  exit 1
fi

echo "Restoring Local layer tables from: $EXPORT_FILE"
echo "(Note: Foreign key errors for unmatched_calendar_events are expected until Bronze data is imported)"
psql "$DB_URL" -f "$EXPORT_FILE" 2>&1 | grep -v "unmatched_calendar_events_calendar_event_id_fkey" || true

echo "✓ Restore complete!"

