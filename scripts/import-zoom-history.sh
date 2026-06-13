#!/usr/bin/env bash
# Historical Zoom Bronze import + Silver processing.
#
# Phase 1 (default): imports all meetings month-by-month with skipProcessing=true
# Phase 2 (--process): runs Silver processing in quarterly chunks after Bronze is loaded
#
# Usage:
#   ./scripts/import-zoom-history.sh                          # local (.env.local)
#   ./scripts/import-zoom-history.sh --env prod               # prod (.env.prod + prod URL)
#   ./scripts/import-zoom-history.sh --env prod --process     # Silver processing against prod
#   ./scripts/import-zoom-history.sh --env prod --from 2023-06  # resume from month
#   ./scripts/import-zoom-history.sh --url https://custom-url --env prod  # override URL

set -uo pipefail

ENV="local"
BASE_URL=""
MODE="import"
RESUME_FROM=""
START_YEAR=2021
START_MONTH=1
END_YEAR=2026
END_MONTH=6

while [[ $# -gt 0 ]]; do
  case $1 in
    --env)      ENV="$2"; shift 2 ;;
    --url)      BASE_URL="${2%/}"; shift 2 ;;
    --process)  MODE="process"; shift ;;
    --from)     RESUME_FROM="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# Set defaults based on --env
if [[ "$ENV" == "prod" ]]; then
  ENV_FILE=".env.prod"
  : "${BASE_URL:=https://hub.quillandcup.com}"
else
  ENV_FILE=".env.local"
  : "${BASE_URL:=http://localhost:3000}"
fi
BASE_URL="${BASE_URL%/}"

# Load service role key from env file
if [[ -f "$ENV_FILE" ]]; then
  SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'" )
fi

if [[ -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not found in $ENV_FILE"
  exit 1
fi

# Returns the last day of a given year/month (macOS + Linux compatible)
last_day_of_month() {
  python3 -c "import calendar; print(calendar.monthrange($1, $2)[1])"
}

# ── Phase 1: Bronze import ────────────────────────────────────────────────────

run_import() {
  echo "=== Phase 1: Bronze import (skipProcessing=true) ==="
  echo "Target: $BASE_URL"
  echo "Range:  ${START_YEAR}-$(printf '%02d' $START_MONTH) → ${END_YEAR}-$(printf '%02d' $END_MONTH)"
  [[ -n "$RESUME_FROM" ]] && echo "Resuming from: $RESUME_FROM"
  echo ""

  local year=$START_MONTH month=$START_MONTH batch=0 failed=0 skipped=0
  year=$START_YEAR
  month=$START_MONTH

  while [[ $year -lt $END_YEAR || ($year -eq $END_YEAR && $month -le $END_MONTH) ]]; do
    local ym
    ym=$(printf "%04d-%02d" $year $month)

    # Resume support: skip months before --from
    if [[ -n "$RESUME_FROM" && "$ym" < "$RESUME_FROM" ]]; then
      skipped=$((skipped + 1))
      if [[ $month -eq 12 ]]; then year=$((year + 1)); month=1; else month=$((month + 1)); fi
      continue
    fi

    batch=$((batch + 1))
    local last_day from_date to_date
    last_day=$(last_day_of_month $year $month)
    from_date="${ym}-01"
    to_date=$(printf "%04d-%02d-%02d" $year $month $last_day)

    printf "[%3d] %s → %s ... " $batch "$from_date" "$to_date"

    local tmp http_code body
    tmp=$(mktemp)
    http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "$BASE_URL/api/import/zoom" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -d "{\"fromDate\":\"$from_date\",\"toDate\":\"$to_date\",\"skipProcessing\":true}" \
      --max-time 310)
    body=$(cat "$tmp"); rm "$tmp"

    if [[ "$http_code" == "200" ]]; then
      local meetings attendees
      meetings=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('meetings',0))" <<< "$body" 2>/dev/null || echo "?")
      attendees=$(python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('totalAttendees',0))" <<< "$body" 2>/dev/null || echo "?")
      echo "✓  ${meetings} meetings, ${attendees} attendees"
    else
      echo "✗  HTTP $http_code"
      echo "   $body"
      failed=$((failed + 1))
    fi

    if [[ $month -eq 12 ]]; then year=$((year + 1)); month=1; else month=$((month + 1)); fi
  done

  echo ""
  echo "Bronze import complete: $batch batches, $failed failed, $skipped skipped."
  if [[ $failed -gt 0 ]]; then
    echo "Re-run with --from YYYY-MM to resume from the first failed month."
    exit 1
  fi
  echo ""
  echo "Next step: run Silver processing with:"
  echo "  $0 --url $BASE_URL --process"
}

# ── Phase 2: Silver processing ────────────────────────────────────────────────

run_processing() {
  echo "=== Phase 2: Silver processing (quarterly chunks) ==="
  echo "Target: $BASE_URL"
  echo ""

  # Build list of quarter start months: Jan, Apr, Jul, Oct
  local year=$START_YEAR quarter_month=1 batch=0 failed=0

  # Align start to quarter boundary
  local init_month=$START_MONTH
  if   [[ $init_month -le 3  ]]; then quarter_month=1
  elif [[ $init_month -le 6  ]]; then quarter_month=4
  elif [[ $init_month -le 9  ]]; then quarter_month=7
  else                                 quarter_month=10
  fi

  while [[ $year -lt $END_YEAR || ($year -eq $END_YEAR && $quarter_month -le $END_MONTH) ]]; do
    batch=$((batch + 1))

    # Quarter end = 3 months later, last day
    local eq_year=$year eq_month=$((quarter_month + 2))
    if [[ $eq_month -gt 12 ]]; then eq_month=$((eq_month - 12)); eq_year=$((eq_year + 1)); fi

    # Cap at END
    if [[ $eq_year -gt $END_YEAR || ($eq_year -eq $END_YEAR && $eq_month -gt $END_MONTH) ]]; then
      eq_year=$END_YEAR; eq_month=$END_MONTH
    fi

    local from_date to_date last_day
    from_date=$(printf "%04d-%02d-01" $year $quarter_month)
    last_day=$(last_day_of_month $eq_year $eq_month)
    to_date=$(printf "%04d-%02d-%02d" $eq_year $eq_month $last_day)

    printf "[%2d] %s → %s\n" $batch "$from_date" "$to_date"

    for route in "calendar" "attendance"; do
      printf "     %-12s ... " "$route"
      local tmp http_code body
      tmp=$(mktemp)
      http_code=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "$BASE_URL/api/process/$route" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
        -d "{\"fromDate\":\"$from_date\",\"toDate\":\"$to_date\"}" \
        --max-time 310)
      body=$(cat "$tmp"); rm "$tmp"

      if [[ "$http_code" == "200" ]]; then
        echo "✓"
      else
        echo "✗  HTTP $http_code"
        echo "             $body"
        failed=$((failed + 1))
      fi
    done

    # Advance to next quarter
    quarter_month=$((quarter_month + 3))
    if [[ $quarter_month -gt 12 ]]; then quarter_month=$((quarter_month - 12)); year=$((year + 1)); fi
  done

  echo ""
  echo "Silver processing complete: $batch quarters, $failed failures."
  [[ $failed -gt 0 ]] && exit 1 || true
}

# ── Main ──────────────────────────────────────────────────────────────────────

if [[ "$MODE" == "process" ]]; then
  run_processing
else
  run_import
fi
