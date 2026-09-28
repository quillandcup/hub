#!/usr/bin/env bash
# Runs every pgTAP test in supabase/tests/database against the local Supabase stack
# (`supabase start` first). Each file runs in its own transaction and rolls back.
#
# Runs as supabase_admin via `docker exec`, not `supabase test db`: that runs as postgres,
# which can't SET ROLE to roles like supabase_auth_admin that some tests need. Each file
# ends with finish(true), which raises on any "not ok", so ON_ERROR_STOP turns a failed
# assertion into a non-zero exit, same as a SQL error.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_hub}"
cd "$(dirname "$0")/.."

shopt -s nullglob
files=(supabase/tests/database/*.test.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No pgTAP tests found."
  exit 0
fi

failed=0
for file in "${files[@]}"; do
  name="$(basename "$file")"
  echo "== $name"
  docker cp "$file" "$CONTAINER:/tmp/$name" > /dev/null
  if ! docker exec "$CONTAINER" psql -U supabase_admin -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -f "/tmp/$name"; then
    echo "FAILED: $name"
    failed=1
  fi
done

exit $failed
