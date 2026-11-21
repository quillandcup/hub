---
paths:
  - "src/lib/data/attendance.ts"
  - "src/lib/attendance*.ts"
  - "src/app/api/process/attendance/**"
  - "supabase/migrations/**"
---

### Attendance Table Design

**RULE**: The `attendance` table allows multiple records per `(member_id, prickle_id)` to track leave/rejoin patterns.

**Why**: People can leave and rejoin the same meeting/prickle (e.g., bathroom break, stepped away for a call).

**Example**:
```
Alice attends "Morning Writing" prickle:
- Record 1: join=9:00, leave=9:30 (30 min)
- Record 2: join=10:00, leave=11:00 (60 min)
Total time: 90 min (not 120 min if merged)
```

**Important queries**:
```sql
-- Count unique prickles attended (NOT count of attendance records)
SELECT COUNT(DISTINCT prickle_id) FROM attendance WHERE member_id = 'alice';

-- Total time spent
SELECT SUM(leave_time - join_time) FROM attendance WHERE member_id = 'alice';

-- Did member attend this prickle? (returns true even if multiple records)
SELECT EXISTS(SELECT 1 FROM attendance WHERE member_id = 'alice' AND prickle_id = '123');
```

**DO NOT**: Add unique constraint on `(member_id, prickle_id)` or deduplicate attendance records
