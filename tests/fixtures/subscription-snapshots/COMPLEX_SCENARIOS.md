# Complex Hiatus Scenarios Test Data

Upload these 5 snapshots in order to see complex hiatus patterns:

## Snapshots

### 1. `subscriptions_snapshot_2025-01-01.csv` (Jan 2025)
All 3 members active

### 2. `subscriptions_snapshot_2025-04-01.csv` (Apr 2025)
- **Monica**: Active → Paused (1st hiatus starts)
- **Nathan**: Active → Paused (1st hiatus starts)
- **Olivia**: Still active

### 3. `subscriptions_snapshot_2025-07-01.csv` (Jul 2025)
- **Monica**: Paused → Active (1st hiatus ends, 3 months)
- **Nathan**: Paused → Active (1st hiatus ends, 3 months)
- **Olivia**: Still active

### 4. `subscriptions_snapshot_2025-11-01.csv` (Nov 2025)
- **Monica**: Active → Paused (2nd hiatus starts)
- **Nathan**: Still active (has completed hiatus, currently active)
- **Olivia**: Active → Canceled (canceled without hiatus)

### 5. `subscriptions_snapshot_2026-02-01.csv` (Feb 2026 - present)
- **Monica**: Still paused (2nd hiatus ongoing, 3 months so far)
- **Nathan**: Still active
- **Olivia**: Still canceled

## Expected Results

### Monica Rivers
**Multiple hiatuses:**
1. ✅ Completed: Apr 2025 - Jul 2025 (3 months)
2. ⏸️ Ongoing: Nov 2025 - Present (3 months, should show ~25% progress)

### Nathan Park  
**Past hiatus, currently active:**
- ✅ Completed: Apr 2025 - Jul 2025 (3 months)
- Status: Active (came back and stayed)

### Olivia Chen
**Past hiatus, came back, then canceled:**
- No hiatus detected (went straight from Active to Canceled)
- Status: Inactive

## Testing

After uploading all 5 snapshots and processing:

**Monica's profile** should show:
- 2 hiatus periods in history
- Current hiatus with ~25% progress badge (3 months into 12-month estimate)

**Nathan's profile** should show:
- 1 completed hiatus period
- No current hiatus badge
- Status: Active

**Olivia's profile** should show:
- No hiatus history (canceled without pause)
- Status: Inactive
