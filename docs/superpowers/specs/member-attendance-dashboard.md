# Member Attendance Dashboard

## Context

**Problem**: Members want to track their own writing practice, see attendance history, and understand their engagement patterns.

**Solution**: Member-facing dashboard showing personal attendance stats, streaks, monthly summaries, and prickle history.

**Dependencies**:
- Member Identity Management (members table)
- Attendance Data Quality (prickles, attendance tables)

**Scope**: MVP feature for churn reduction initiative.

---

## Data Model

### Gold Layer (Member-Specific Metrics)

**Note**: Gold layer data is computed on-demand from Silver tables, scoped to authenticated member.

**Key Queries**:

```sql
-- Member summary stats
CREATE VIEW member_stats AS
SELECT 
  m.id as member_id,
  COUNT(DISTINCT a.prickle_id) as total_prickles_attended,
  SUM(a.duration_minutes) as total_minutes,
  MIN(a.join_time) as first_attendance,
  MAX(a.join_time) as last_attendance,
  
  -- Last 7 days (this week)
  COUNT(DISTINCT CASE 
    WHEN a.join_time >= NOW() - INTERVAL '7 days' 
    THEN a.prickle_id 
  END) as prickles_7d,
  SUM(CASE 
    WHEN a.join_time >= NOW() - INTERVAL '7 days' 
    THEN a.duration_minutes 
  END) as minutes_7d,
  
  -- Last 30 days
  COUNT(DISTINCT CASE 
    WHEN a.join_time >= NOW() - INTERVAL '30 days' 
    THEN a.prickle_id 
  END) as prickles_30d,
  SUM(CASE 
    WHEN a.join_time >= NOW() - INTERVAL '30 days' 
    THEN a.duration_minutes 
  END) as minutes_30d,
  
  -- Current month
  COUNT(DISTINCT CASE 
    WHEN DATE_TRUNC('month', a.join_time) = DATE_TRUNC('month', NOW()) 
    THEN a.prickle_id 
  END) as prickles_this_month,
  SUM(CASE 
    WHEN DATE_TRUNC('month', a.join_time) = DATE_TRUNC('month', NOW()) 
    THEN a.duration_minutes 
  END) as minutes_this_month
FROM members m
LEFT JOIN prickle_attendance a ON m.id = a.member_id
GROUP BY m.id;

-- Monthly attendance summary
CREATE VIEW member_monthly_attendance AS
SELECT 
  m.id as member_id,
  DATE_TRUNC('month', a.join_time) as month,
  COUNT(DISTINCT a.prickle_id) as prickles_attended,
  SUM(a.duration_minutes) as total_minutes,
  COUNT(DISTINCT DATE(a.join_time)) as days_attended,
  COUNT(DISTINCT DATE_TRUNC('week', a.join_time)) as weeks_attended
FROM members m
LEFT JOIN prickle_attendance a ON m.id = a.member_id
GROUP BY m.id, DATE_TRUNC('month', a.join_time)
ORDER BY month DESC;

-- Attendance by prickle type (dynamic, not hardcoded)
CREATE VIEW member_attendance_by_type AS
SELECT 
  m.id as member_id,
  pt.id as prickle_type_id,
  pt.name as prickle_type_name,
  COUNT(DISTINCT a.prickle_id) as prickles_attended,
  SUM(a.duration_minutes) as total_minutes
FROM members m
LEFT JOIN prickle_attendance a ON m.id = a.member_id
LEFT JOIN prickles p ON a.prickle_id = p.id
LEFT JOIN prickle_types pt ON p.prickle_type_id = pt.id
GROUP BY m.id, pt.id, pt.name;

-- Weekly attendance streaks (aligns with sustainability principle)
CREATE OR REPLACE FUNCTION calculate_weekly_streak(p_member_id UUID)
RETURNS TABLE (
  current_streak_weeks INTEGER,
  longest_streak_weeks INTEGER,
  last_attended_week DATE
) AS $$
DECLARE
  v_current_streak INTEGER := 0;
  v_longest_streak INTEGER := 0;
  v_streak INTEGER := 0;
  v_prev_week DATE := NULL;
  v_curr_week DATE;
  v_last_attended_week DATE;
BEGIN
  -- Get distinct weeks with attendance, ordered descending
  FOR v_curr_week IN 
    SELECT DISTINCT DATE_TRUNC('week', join_time)::DATE as week_start
    FROM prickle_attendance
    WHERE member_id = p_member_id
    ORDER BY week_start DESC
  LOOP
    IF v_last_attended_week IS NULL THEN
      v_last_attended_week := v_curr_week;
    END IF;
    
    IF v_prev_week IS NULL THEN
      -- First week
      v_streak := 1;
      v_prev_week := v_curr_week;
    ELSIF v_prev_week - v_curr_week = 7 THEN
      -- Consecutive week
      v_streak := v_streak + 1;
      v_prev_week := v_curr_week;
    ELSE
      -- Streak broken
      IF v_current_streak = 0 AND v_prev_week >= DATE_TRUNC('week', CURRENT_DATE)::DATE THEN
        -- This was the current streak
        v_current_streak := v_streak;
      END IF;
      
      IF v_streak > v_longest_streak THEN
        v_longest_streak := v_streak;
      END IF;
      
      v_streak := 1;
      v_prev_week := v_curr_week;
    END IF;
  END LOOP;
  
  -- Final streak check
  IF v_streak > 0 THEN
    IF v_current_streak = 0 AND v_last_attended_week >= DATE_TRUNC('week', CURRENT_DATE)::DATE - INTERVAL '7 days' THEN
      v_current_streak := v_streak;
    END IF;
    
    IF v_streak > v_longest_streak THEN
      v_longest_streak := v_streak;
    END IF;
  END IF;
  
  RETURN QUERY SELECT v_current_streak, v_longest_streak, v_last_attended_week;
END;
$$ LANGUAGE plpgsql;
```

---

## Dashboard Layout

**Location**: `/dashboard` (member's personal attendance view)

**Access**: Authenticated members viewing their own data

### Summary Cards (Top)

```typescript
interface MemberStats {
  prickles7d: number;
  minutes7d: number;
  prickles30d: number;
  minutes30d: number;
  pricklesThisMonth: number;
  minutesThisMonth: number;
  currentStreak: number;
  longestStreak: number;
}
```

**Component**:
```typescript
export function MemberStatsCards({ stats }: { stats: MemberStats }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardHeader>This Week</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-blue-600">{stats.prickles7d}</div>
          <div className="text-sm text-gray-500">prickles attended</div>
          <div className="text-lg mt-2">{Math.round(stats.minutes7d)} min</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>This Month</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.pricklesThisMonth}</div>
          <div className="text-sm text-gray-500">prickles attended</div>
          <div className="text-lg mt-2">{Math.round(stats.minutesThisMonth)} min</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>Last 30 Days</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats.prickles30d}</div>
          <div className="text-sm text-gray-500">prickles attended</div>
          <div className="text-lg mt-2">{Math.round(stats.minutes30d)} min</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>Current Streak</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-orange-600">
            {stats.currentStreak} 🔥
          </div>
          <div className="text-sm text-gray-500">weeks in a row</div>
          <div className="text-sm mt-2">
            Longest: {stats.longestStreak} weeks
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Design Notes**: 
- "This Week" appears first to reinforce weekly attendance as the baseline habit. Color-coded blue to draw attention as the primary metric.
- Streaks measured in **weeks**, not days, to align with sustainability principle (no pressure for daily attendance).

### Calendar Heatmap (Middle)

**Purpose**: Visualize attendance patterns at a glance.

**Display**: Calendar grid showing last 90 days with color intensity = minutes attended.

**Interaction**: 
- Hover shows date + prickles attended + total minutes
- Click date shows detailed prickle list for that day

**Component**:
```typescript
export function AttendanceCalendar({ memberId }: { memberId: string }) {
  const [attendance, setAttendance] = useState<DailyAttendance[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  
  useEffect(() => {
    async function loadAttendance() {
      const { data } = await supabase
        .from("prickle_attendance")
        .select(`
          join_time,
          duration_minutes,
          prickles (
            prickle_date,
            prickle_types (name)
          )
        `)
        .eq("member_id", memberId)
        .gte("join_time", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order("join_time", { ascending: false });
      
      // Group by date
      const byDate = groupByDate(data);
      setAttendance(byDate);
    }
    
    loadAttendance();
  }, [memberId]);
  
  return (
    <Card>
      <CardHeader>Attendance Calendar (Last 90 Days)</CardHeader>
      <CardContent>
        <CalendarHeatmap
          data={attendance}
          onDateClick={setSelectedDate}
          colorScale={['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127']}
        />
        
        {selectedDate && (
          <DayDetailModal 
            date={selectedDate}
            attendance={attendance.filter(a => a.date === selectedDate)}
            onClose={() => setSelectedDate(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function groupByDate(attendance: any[]): DailyAttendance[] {
  const byDate = new Map<string, DailyAttendance>();
  
  for (const record of attendance) {
    const date = record.prickles.prickle_date;
    
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        prickles: [],
        totalMinutes: 0
      });
    }
    
    const day = byDate.get(date)!;
    day.prickles.push({
      type: record.prickles.prickle_types.name,
      minutes: record.duration_minutes
    });
    day.totalMinutes += record.duration_minutes;
  }
  
  return Array.from(byDate.values());
}
```

### Monthly Summary Table (Bottom Left)

**Purpose**: Show month-by-month attendance trends.

**Columns**:
- Month
- Prickles Attended
- Total Minutes
- Days Attended
- Weeks Attended

**Component**:
```typescript
export function MonthlyAttendanceTable({ memberId }: { memberId: string }) {
  const [months, setMonths] = useState<MonthlyAttendance[]>([]);
  
  useEffect(() => {
    async function loadMonthlyData() {
      const { data } = await supabase
        .from("member_monthly_attendance")
        .select("*")
        .eq("member_id", memberId)
        .order("month", { ascending: false })
        .limit(12);
      
      setMonths(data || []);
    }
    
    loadMonthlyData();
  }, [memberId]);
  
  return (
    <Card>
      <CardHeader>Monthly Summary (Last 12 Months)</CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Prickles</TableHead>
              <TableHead>Minutes</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Morning</TableHead>
              <TableHead>Afternoon</TableHead>
              <TableHead>Salon</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map(month => (
              <TableRow key={month.month}>
                <TableCell>{formatMonth(month.month)}</TableCell>
                <TableCell>{month.prickles_attended}</TableCell>
                <TableCell>{Math.round(month.total_minutes)}</TableCell>
                <TableCell>{month.days_attended}</TableCell>
                <TableCell>{month.morning_writing_count}</TableCell>
                <TableCell>{month.afternoon_writing_count}</TableCell>
                <TableCell>{month.sunday_salon_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

### Prickle Type Breakdown (Bottom Right)

**Purpose**: Show distribution of attendance by prickle type.

**Chart Type**: Pie chart or bar chart.

**Data**: Last 30 days, grouped by prickle type.

**Component**:
```typescript
export function PrickleTypeBreakdown({ memberId }: { memberId: string }) {
  const [breakdown, setBreakdown] = useState<PrickleTypeData[]>([]);
  
  useEffect(() => {
    async function loadBreakdown() {
      const { data } = await supabase
        .from("prickle_attendance")
        .select(`
          prickle_id,
          prickles (
            prickle_types (name)
          )
        `)
        .eq("member_id", memberId)
        .gte("join_time", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      
      // Count by type
      const counts = new Map<string, number>();
      for (const record of data || []) {
        const type = record.prickles.prickle_types.name;
        counts.set(type, (counts.get(type) || 0) + 1);
      }
      
      setBreakdown(
        Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
      );
    }
    
    loadBreakdown();
  }, [memberId]);
  
  return (
    <Card>
      <CardHeader>Prickle Types (Last 30 Days)</CardHeader>
      <CardContent>
        <PieChart width={300} height={300}>
          <Pie
            data={breakdown}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label
          >
            {breakdown.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </CardContent>
    </Card>
  );
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c'];
```

---

## Recent Attendance List

**Purpose**: Quick view of recent prickles attended.

**Location**: Below calendar heatmap.

**Display**: Last 10 prickles with date, type, duration.

**Component**:
```typescript
export function RecentAttendance({ memberId }: { memberId: string }) {
  const [recent, setRecent] = useState<AttendanceRecord[]>([]);
  
  useEffect(() => {
    async function loadRecent() {
      const { data } = await supabase
        .from("prickle_attendance")
        .select(`
          join_time,
          leave_time,
          duration_minutes,
          prickles (
            prickle_date,
            start_time,
            prickle_types (name)
          )
        `)
        .eq("member_id", memberId)
        .order("join_time", { ascending: false })
        .limit(10);
      
      setRecent(data || []);
    }
    
    loadRecent();
  }, [memberId]);
  
  return (
    <Card>
      <CardHeader>Recent Attendance</CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recent.map((record, i) => (
            <div key={i} className="flex items-center justify-between border-b pb-2">
              <div>
                <div className="font-medium">{record.prickles.prickle_types.name}</div>
                <div className="text-sm text-gray-500">
                  {formatDate(record.prickles.prickle_date)} at {record.prickles.start_time}
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{record.duration_minutes} min</div>
                <div className="text-sm text-gray-500">
                  {formatTime(record.join_time)} - {formatTime(record.leave_time)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## API Routes

### GET /api/members/[id]/stats

**Purpose**: Fetch member stats for dashboard.

**Response**:
```typescript
{
  stats: {
    totalPrickles: 234,
    totalMinutes: 14560,
    prickles30d: 18,
    minutes30d: 1080,
    pricklesThisMonth: 12,
    minutesThisMonth: 720,
    currentStreak: 5,
    longestStreak: 23,
    firstAttendance: "2023-06-15",
    lastAttendance: "2024-01-20"
  },
  monthlyBreakdown: [...],
  prickleTypeBreakdown: [...]
}
```

**Implementation**:
```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  
  // Verify authenticated user is requesting their own stats
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== params.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  
  // Run queries in parallel
  const [
    { data: stats },
    { data: streak },
    { data: monthlyBreakdown },
    { data: prickleTypeBreakdown }
  ] = await Promise.all([
    supabase
      .from("member_stats")
      .select("*")
      .eq("member_id", params.id)
      .single(),
    supabase.rpc("calculate_attendance_streak", { p_member_id: params.id }),
    supabase
      .from("member_monthly_attendance")
      .select("*")
      .eq("member_id", params.id)
      .order("month", { ascending: false })
      .limit(12),
    supabase.rpc("get_prickle_type_breakdown", { 
      p_member_id: params.id,
      p_days: 30
    })
  ]);
  
  return NextResponse.json({
    stats: {
      ...stats,
      currentStreak: streak?.[0]?.current_streak_days || 0,
      longestStreak: streak?.[0]?.longest_streak_days || 0
    },
    monthlyBreakdown: monthlyBreakdown || [],
    prickleTypeBreakdown: prickleTypeBreakdown || []
  });
}
```

**SQL Function for Prickle Type Breakdown**:
```sql
CREATE OR REPLACE FUNCTION get_prickle_type_breakdown(
  p_member_id UUID,
  p_days INTEGER DEFAULT 30
) RETURNS TABLE (
  prickle_type TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pt.name as prickle_type,
    COUNT(DISTINCT a.prickle_id)::BIGINT as count
  FROM prickle_attendance a
  JOIN prickles p ON a.prickle_id = p.id
  JOIN prickle_types pt ON p.prickle_type_id = pt.id
  WHERE a.member_id = p_member_id
    AND a.join_time >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY pt.name
  ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;
```

---

## Access Control

**Requirements**:
1. Members can only view their own attendance data
2. Use Supabase RLS to enforce member-scoped queries
3. Authenticated users only

**RLS Policies**:
```sql
-- Members can only see their own attendance
ALTER TABLE prickle_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own attendance"
ON prickle_attendance
FOR SELECT
TO authenticated
USING (member_id = auth.uid());

-- Members can only see their own stats
ALTER TABLE member_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own stats"
ON member_stats
FOR SELECT
TO authenticated
USING (member_id = auth.uid());
```

**Route Protection**:
```typescript
// app/api/members/[id]/stats/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  // Must be authenticated
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  // Can only access own data (unless staff)
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("member_id", user.id)
    .single();
  
  if (user.id !== params.id && !staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  
  // ... rest of handler
}
```

---

## Testing

### Component Tests

```typescript
// tests/components/MemberStatsCards.test.tsx
describe("MemberStatsCards", () => {
  it("renders all stat cards", () => {
    const stats = {
      pricklesThisMonth: 12,
      minutesThisMonth: 720,
      prickles30d: 18,
      minutes30d: 1080,
      currentStreak: 5,
      longestStreak: 23
    };
    
    render(<MemberStatsCards stats={stats} />);
    
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('720 min')).toBeInTheDocument();
    expect(screen.getByText('5 🔥')).toBeInTheDocument();
  });
});

describe("AttendanceCalendar", () => {
  it("renders 90 days of data", () => {
    const attendance = generateMockAttendance(90);
    
    render(<AttendanceCalendar memberId="m1" />);
    
    // Verify calendar grid rendered
    expect(screen.getByText('Attendance Calendar')).toBeInTheDocument();
  });
  
  it("shows day details on click", () => {
    render(<AttendanceCalendar memberId="m1" />);
    
    // Click a date
    fireEvent.click(screen.getByTestId('date-2024-01-15'));
    
    // Verify modal opened
    expect(screen.getByText('January 15, 2024')).toBeInTheDocument();
  });
});
```

### API Tests

```typescript
// tests/api/member-stats.test.ts
describe("GET /api/members/[id]/stats", () => {
  it("returns member stats", async () => {
    // Seed test data
    await seedMember('m1');
    await seedAttendance('m1', 20);
    
    const response = await fetch("/api/members/m1/stats", {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.stats.prickles30d).toBe(20);
  });
  
  it("prevents accessing other members' data", async () => {
    await seedMember('m1');
    await seedMember('m2');
    
    // m1 tries to access m2's stats
    const response = await fetch("/api/members/m2/stats", {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    
    expect(response.status).toBe(403);
  });
  
  it("allows staff to access any member's data", async () => {
    await seedMember('m1');
    await seedStaff('staff1');
    
    const response = await fetch("/api/members/m1/stats", {
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    
    expect(response.status).toBe(200);
  });
});
```

### SQL Function Tests

```typescript
// tests/sql/calculate-attendance-streak.test.ts
describe("calculate_attendance_streak", () => {
  it("calculates current streak", async () => {
    await seedMember('m1');
    
    // Attend last 5 days consecutively
    for (let i = 0; i < 5; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      await seedAttendance('m1', date);
    }
    
    const { data } = await supabase.rpc("calculate_attendance_streak", {
      p_member_id: 'm1'
    });
    
    expect(data[0].current_streak_days).toBe(5);
  });
  
  it("calculates longest streak", async () => {
    await seedMember('m1');
    
    // 7-day streak in the past
    for (let i = 10; i < 17; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      await seedAttendance('m1', date);
    }
    
    // 3-day current streak
    for (let i = 0; i < 3; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      await seedAttendance('m1', date);
    }
    
    const { data } = await supabase.rpc("calculate_attendance_streak", {
      p_member_id: 'm1'
    });
    
    expect(data[0].current_streak_days).toBe(3);
    expect(data[0].longest_streak_days).toBe(7);
  });
  
  it("resets streak when days are skipped", async () => {
    await seedMember('m1');
    
    // Attend today
    await seedAttendance('m1', new Date());
    
    // Skip yesterday
    
    // Attend 2 days ago
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    await seedAttendance('m1', twoDaysAgo);
    
    const { data } = await supabase.rpc("calculate_attendance_streak", {
      p_member_id: 'm1'
    });
    
    expect(data[0].current_streak_days).toBe(1); // Only today
  });
});
```

---

## Success Criteria

1. **Dashboard Performance**:
   - [ ] Dashboard loads in <2s
   - [ ] All queries use RLS (member-scoped)
   - [ ] Calendar heatmap renders smoothly

2. **Data Accuracy**:
   - [ ] Streak calculations are correct
   - [ ] Monthly summaries match raw data
   - [ ] Prickle type breakdown adds up to total

3. **User Experience**:
   - [ ] Calendar is visually clear and informative
   - [ ] Stats cards highlight key metrics
   - [ ] Easy to navigate month-by-month

4. **Security**:
   - [ ] Members cannot access others' data
   - [ ] All queries enforce RLS
   - [ ] Staff can view any member's dashboard

---

## Implementation Phases

### Phase 1: Data Layer (Week 1)
- [ ] Create SQL views (member_stats, member_monthly_attendance)
- [ ] Create calculate_attendance_streak() function
- [ ] Create get_prickle_type_breakdown() function
- [ ] Add RLS policies

### Phase 2: API Routes (Week 1)
- [ ] GET /api/members/[id]/stats
- [ ] Add authentication/authorization

### Phase 3: UI Components (Week 2)
- [ ] MemberStatsCards component
- [ ] AttendanceCalendar component (heatmap)
- [ ] MonthlyAttendanceTable component
- [ ] PrickleTypeBreakdown component
- [ ] RecentAttendance component

### Phase 4: Dashboard Page (Week 2)
- [ ] Create /dashboard page
- [ ] Integrate all components
- [ ] Add member-only middleware
- [ ] Responsive design

### Phase 5: Testing (Week 3)
- [ ] Component tests for all UI
- [ ] API tests for routes
- [ ] SQL function tests (streak calculation)
- [ ] End-to-end test for full dashboard flow

---

## Future Enhancements

1. **Goal Setting**:
   - Members set monthly attendance goals
   - Progress tracking toward goals
   - Achievements/badges for milestones

2. **Social Features**:
   - Leaderboard (opt-in)
   - Streak challenges
   - Compare stats with friends

3. **Insights and Recommendations**:
   - Identify attendance patterns (e.g., "You usually attend on Mondays")
   - Highlight peak performance times (e.g., "Your longest sessions are on weekends")
   - Suggest diversification across prickle types

4. **Export and Sharing**:
   - Download attendance CSV
   - Share calendar on social media
   - Generate attendance certificate

5. **Notifications**:
   - Reminder if streak is about to break
   - Congratulations on new longest streak
   - Monthly summary email

6. **Advanced Stats**:
   - Average session length by prickle type
   - Peak attendance days/times
   - Consistency score

7. **Integrations**:
   - Export to Google Calendar
   - Sync with habit tracking apps
   - Writing goal tracking (words/pages)
