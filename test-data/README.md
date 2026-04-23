# Test Data for Hiatus Tracking

This directory contains fake subscription CSV exports to test the hiatus tracking system.

## Files

### `subscriptions_snapshot_2026-03-01.csv` (March 1)
**Initial snapshot - 10 members:**
- 8 Active subscriptions
- 2 Canceled (before this period)

### `subscriptions_snapshot_2026-04-01.csv` (April 1) 
**One month later - showing changes:**
- **Alice Johnson**: Active → Paused (hiatus started)
- **Carol Smith**: Active → Paused (hiatus started)
- **Emily Brown**: Active → Paused (hiatus started)
- **Henry Davis**: Active → Paused (hiatus started)
- **Karen Lopez**: NEW member joined
- Others: No change

### `subscriptions_snapshot_2026-05-01.csv` (May 1)
**Two months later - more changes:**
- **Alice Johnson**: Still Paused (ongoing hiatus, 2 months)
- **Carol Smith**: Paused → Active (hiatus ended after 1 month)
- **Emily Brown**: Paused → Active (hiatus ended after 1 month)
- **Henry Davis**: Paused → Canceled (left during hiatus)
- **Frank Lee**: Active → Paused (new hiatus started)
- **Laura Chen**: NEW member joined
- Others: No change

## Expected Hiatus Detection Results

After processing all 3 snapshots, the system should detect:

### Completed Hiatuses:
1. **Carol Smith**: Apr 1 - May 1 (1 month)
2. **Emily Brown**: Apr 1 - May 1 (1 month)
3. **Henry Davis**: Apr 1 - May 5 (1 month, ended with cancellation)

### Ongoing Hiatuses (as of May 1):
1. **Alice Johnson**: Started Apr 1 (2 months so far) - Should show ~50% progress
2. **Frank Lee**: Started May 1 (just started) - Should show ~25% progress

## Testing Workflow

1. **First upload** (March 1 snapshot):
   ```
   Upload: subscriptions_snapshot_2026-03-01.csv
   Process hiatus: Should detect 0 hiatuses (no historical data yet)
   ```

2. **Second upload** (April 1 snapshot):
   ```
   Upload: subscriptions_snapshot_2026-04-01.csv
   Process hiatus: Should detect 4 NEW hiatuses starting ~April 1
   ```

3. **Third upload** (May 1 snapshot):
   ```
   Upload: subscriptions_snapshot_2026-05-01.csv
   Process hiatus: Should show:
   - 3 completed hiatuses (Carol, Emily, Henry)
   - 2 ongoing hiatuses (Alice at ~50%, Frank at ~25%)
   ```

## Dashboard View

After uploading all 3 snapshots, the hiatus dashboard should show:
- **Currently on Hiatus**: 2 members (Alice, Frank)
- **Alice Johnson**: Next contact in ~6 months (at 75% mark)
- **Frank Lee**: Next contact in ~3 months (at 25% mark)

## Note

These members won't show in the actual member profiles unless you also:
1. Create corresponding entries in the `members` table, OR
2. Run `/api/import/members` with a matching members CSV

The hiatus processing will only link to existing members in the database.
