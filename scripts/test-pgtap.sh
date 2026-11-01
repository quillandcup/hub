#!/usr/bin/env bash
# Runs every pgTAP test in supabase/tests/database against the local Supabase stack
# (`supabase start` first). Each file runs in its own transaction and rolls back.
#
# Runs as supabase_admin via `docker exec`, not `supabase test db`: that runs as postgres,
# which can't SET ROLE to roles like supabase_auth_admin that some tests need. Each file
# ends with finish(true), which raises on any "not ok", so ON_ERROR_STOP turns a failed
# assertion into a non-zero exit, same as a SQL error.
#
# The files are copied in once and run by one `docker exec` loop inside the container (still
# one psql per file): a `docker cp` and a `docker exec` per file cost about 0.2s each, which
# was most of this step's time.
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_hub}"
cd "$(dirname "$0")/.."

shopt -s nullglob
files=(supabase/tests/database/*.test.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No pgTAP tests found."
  exit 0
fi

docker exec "$CONTAINER" rm -rf /tmp/pgtap > /dev/null
docker cp supabase/tests/database "$CONTAINER:/tmp/pgtap" > /dev/null

docker exec "$CONTAINER" sh -c '
  failed=0
  for file in /tmp/pgtap/*.test.sql; do
    name="$(basename "$file")"
    echo "== $name"
    if ! psql -U supabase_admin -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -f "$file"; then
      echo "FAILED: $name"
      failed=1
    fi
  done
  exit $failed
'
