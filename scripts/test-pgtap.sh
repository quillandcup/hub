#!/usr/bin/env bash
# Runs every pgTAP test in supabase/tests/database against the local Supabase stack
# (`supabase start` first). Each file runs in its own transaction and rolls back.
#
# Runs as supabase_admin via `docker exec`, not `supabase test db`: that runs as postgres,
# which can't SET ROLE to roles like supabase_auth_admin that some tests need. Each file
# ends with finish(true), which raises on a "not ok" so ON_ERROR_STOP turns it into a non-zero exit, same as a SQL
# error. finish(true) stays silent when the plan does not match what ran, so the output is also checked for any
# "not ok" (a "# TODO" one is expected) and for "Looks like you planned".
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
    out="$(mktemp)"
    ok=1
    psql -U supabase_admin -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -f "$file" > "$out" 2>&1 || ok=0
    cat "$out"
    if [ "$ok" = 0 ]; then
      echo "FAILED: $name (psql exited with an error)"
      failed=1
    fi
    # finish(true) raises on a failed assertion only when the number run equals the plan (pgTAP 1.3.1); with a wrong
    # plan it prints "Looks like you planned N tests but ran M" and returns, so failures would pass. Check the output.
    if grep -E "^(not ok|# Looks like you planned)" "$out" | grep -v "# TODO" > "$out.bad"; then
      echo "FAILED: $name has a failing assertion or a plan that does not match what ran:"
      sed "s/^/    /" "$out.bad"
      failed=1
    fi
    rm -f "$out" "$out.bad"
  done
  exit $failed
'
