#!/bin/bash
# Export Local layer tables (operational data we own) to SQL
# This preserves prickle_types, aliases, ignored names, etc.

set -e

EXPORT_DIR="supabase/local-data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$EXPORT_DIR/backups/$TIMESTAMP"

mkdir -p "$BACKUP_DIR"

echo "Exporting Local layer tables..."

# Get database connection details from Supabase (PostgreSQL row)
DB_URL=$(npx supabase status 2>&1 | grep -oP 'postgresql://[^\s]+')

if [ -z "$DB_URL" ]; then
  echo "Error: Could not get database URL. Is Supabase running?"
  echo "Run: npx supabase start"
  exit 1
fi

echo "Using database: $DB_URL"

# Export each Local layer table
TABLES=(
  "prickle_types"
  "member_name_aliases"
  "member_email_aliases"
  "member_hiatus_history"
  "ignored_zoom_names"
  "ignored_slack_users"
  "unmatched_calendar_events"
)

for table in "${TABLES[@]}"; do
  echo "Exporting $table..."
  psql "$DB_URL" -c "\COPY (SELECT * FROM $table ORDER BY 1) TO STDOUT WITH CSV HEADER" > "$BACKUP_DIR/${table}.csv" 2>/dev/null || echo "-- Empty table" > "$BACKUP_DIR/${table}.csv"
done

# Create SQL restore script by dumping with pg_dump
echo "Creating SQL restore script..."
pg_dump "$DB_URL" \
  --table=prickle_types \
  --table=member_name_aliases \
  --table=member_email_aliases \
  --table=member_hiatus_history \
  --table=ignored_zoom_names \
  --table=ignored_slack_users \
  --table=unmatched_calendar_events \
  --data-only \
  --column-inserts \
  > "$BACKUP_DIR/restore.sql"

# Copy latest export to main location (no timestamp)
cp "$BACKUP_DIR/restore.sql" "$EXPORT_DIR/local-tables.sql"

echo ""
echo "✓ Export complete!"
echo "  Backup: $BACKUP_DIR/"
echo "  Latest: $EXPORT_DIR/local-tables.sql"
echo ""
echo "To restore after 'npx supabase db reset':"
echo "  ./scripts/restore-local-tables.sh"

