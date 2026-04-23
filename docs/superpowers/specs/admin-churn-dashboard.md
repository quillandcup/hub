# Admin Churn Dashboard

## Context

**Problem**: Admins need visibility into member engagement and churn risk to take proactive action (outreach, check-ins, custom offers).

**Solution**: Dashboard showing engagement metrics, attendance trends, and churn risk indicators with drill-down views and member-level details.

**Dependencies**:
- Member Identity Management (members table)
- Attendance Data Quality (prickles, attendance tables)

**Scope**: MVP feature for churn reduction initiative.

---

## Data Model

### Gold Layer (Aggregated Metrics)

**Note**: Gold layer data is computed on-demand from Silver tables. No new tables needed for MVP.

**Key Queries**:

```sql
-- Member engagement summary (last 30 days)
CREATE VIEW member_engagement_summary AS
SELECT 
  m.id,
  m.name,
  m.email,
  m.status,
  COUNT(DISTINCT a.prickle_id) as prickles_attended_30d,
  SUM(a.duration_minutes) as total_minutes_30d,
  MAX(a.join_time) as last_attendance_date,
  NOW() - MAX(a.join_time) as days_since_last_attendance
FROM members m
LEFT JOIN prickle_attendance a ON m.id = a.member_id
  AND a.join_time >= NOW() - INTERVAL '30 days'
GROUP BY m.id, m.name, m.email, m.status;

-- Churn risk scoring
CREATE VIEW member_churn_risk AS
SELECT 
  e.*,
  CASE
    WHEN days_since_last_attendance > 30 THEN 'high'
    WHEN days_since_last_attendance > 14 THEN 'medium'
    WHEN days_since_last_attendance > 7 THEN 'low'
    ELSE 'active'
  END as churn_risk,
  CASE
    WHEN prickles_attended_30d = 0 THEN 'inactive'
    WHEN prickles_attended_30d < 4 THEN 'low_engagement'
    WHEN prickles_attended_30d < 12 THEN 'moderate_engagement'
    ELSE 'high_engagement'
  END as engagement_level
FROM member_engagement_summary e
WHERE status = 'active';

-- Cohort retention (by join month)
CREATE VIEW cohort_retention AS
SELECT 
  DATE_TRUNC('month', m.created_at) as cohort_month,
  COUNT(DISTINCT m.id) as cohort_size,
  COUNT(DISTINCT CASE 
    WHEN a.join_time >= NOW() - INTERVAL '30 days' 
    THEN m.id 
  END) as active_in_last_30d,
  ROUND(
    100.0 * COUNT(DISTINCT CASE 
      WHEN a.join_time >= NOW() - INTERVAL '30 days' 
      THEN m.id 
    END) / COUNT(DISTINCT m.id),
    1
  ) as retention_rate
FROM members m
LEFT JOIN prickle_attendance a ON m.id = a.member_id
WHERE m.status = 'active'
GROUP BY DATE_TRUNC('month', m.created_at)
ORDER BY cohort_month DESC;

-- Attendance trends (weekly)
CREATE VIEW weekly_attendance_trends AS
SELECT 
  DATE_TRUNC('week', p.prickle_date) as week_start,
  pt.name as prickle_type,
  COUNT(DISTINCT p.id) as prickles_held,
  COUNT(DISTINCT a.member_id) as unique_attendees,
  SUM(a.duration_minutes) as total_minutes,
  ROUND(AVG(a.duration_minutes), 1) as avg_duration
FROM prickles p
JOIN prickle_types pt ON p.prickle_type_id = pt.id
LEFT JOIN prickle_attendance a ON p.id = a.prickle_id
WHERE p.prickle_date >= NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('week', p.prickle_date), pt.name
ORDER BY week_start DESC, prickle_type;
```

---

## Dashboard Layout

**Location**: `/admin/members` (admin churn dashboard)

**Access**: Admin users only

### Overview Cards (Top)

```typescript
interface DashboardMetrics {
  totalMembers: number;
  activeMembers: number; // Attended in last 30 days
  highRiskChurn: number; // No attendance in 30+ days
  avgPricklesPerMember: number; // Last 30 days
}
```

**Component**:
```typescript
export function MetricsCards({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardHeader>Total Members</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{metrics.totalMembers}</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>Active (30d)</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">
            {metrics.activeMembers}
          </div>
          <div className="text-sm text-gray-500">
            {Math.round(100 * metrics.activeMembers / metrics.totalMembers)}% of total
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>High Churn Risk</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-red-600">
            {metrics.highRiskChurn}
          </div>
          <div className="text-sm text-gray-500">
            No attendance in 30+ days
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>Avg Prickles/Member</CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            {metrics.avgPricklesPerMember.toFixed(1)}
          </div>
          <div className="text-sm text-gray-500">
            Last 30 days
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Churn Risk Table (Middle)

**Purpose**: Identify members needing outreach.

**Columns**:
- Name
- Email
- Last Attendance
- Days Inactive
- Prickles (30d)
- Total Minutes (30d)
- Risk Level (badge)
- Actions (email, view details)

**Features**:
- Sort by risk level, last attendance, prickles attended
- Filter by risk level, engagement level
- Search by name/email
- Export to CSV for outreach campaigns

**Component**:
```typescript
export function ChurnRiskTable() {
  const [members, setMembers] = useState<MemberChurnRisk[]>([]);
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  
  useEffect(() => {
    async function loadMembers() {
      const { data } = await supabase
        .from("member_churn_risk")
        .select("*")
        .order("days_since_last_attendance", { ascending: false });
      
      setMembers(data || []);
    }
    loadMembers();
  }, []);
  
  const filtered = filter === 'all' 
    ? members 
    : members.filter(m => m.churn_risk === filter);
  
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <Button 
          onClick={() => setFilter('all')}
          variant={filter === 'all' ? 'default' : 'outline'}
        >
          All ({members.length})
        </Button>
        <Button 
          onClick={() => setFilter('high')}
          variant={filter === 'high' ? 'default' : 'outline'}
        >
          High Risk ({members.filter(m => m.churn_risk === 'high').length})
        </Button>
        <Button 
          onClick={() => setFilter('medium')}
          variant={filter === 'medium' ? 'default' : 'outline'}
        >
          Medium ({members.filter(m => m.churn_risk === 'medium').length})
        </Button>
      </div>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Last Attendance</TableHead>
            <TableHead>Days Inactive</TableHead>
            <TableHead>Prickles (30d)</TableHead>
            <TableHead>Minutes (30d)</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map(member => (
            <TableRow key={member.id}>
              <TableCell>{member.name}</TableCell>
              <TableCell>{member.email}</TableCell>
              <TableCell>
                {member.last_attendance_date 
                  ? formatDate(member.last_attendance_date)
                  : 'Never'
                }
              </TableCell>
              <TableCell>
                {member.days_since_last_attendance?.toFixed(0) || 'N/A'}
              </TableCell>
              <TableCell>{member.prickles_attended_30d}</TableCell>
              <TableCell>{member.total_minutes_30d}</TableCell>
              <TableCell>
                <Badge variant={getRiskVariant(member.churn_risk)}>
                  {member.churn_risk}
                </Badge>
              </TableCell>
              <TableCell>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => window.location.href = `/admin/members/${member.id}`}
                >
                  Details
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

### Attendance Trends Chart (Bottom Left)

**Purpose**: Visualize attendance patterns over time.

**Chart Type**: Line chart with multiple series (one per prickle type).

**X-axis**: Week (last 12 weeks)
**Y-axis**: Unique attendees

**Component**:
```typescript
export function AttendanceTrendsChart() {
  const [data, setData] = useState<WeeklyTrend[]>([]);
  
  useEffect(() => {
    async function loadTrends() {
      const { data } = await supabase
        .from("weekly_attendance_trends")
        .select("*")
        .order("week_start", { ascending: true });
      
      setData(data || []);
    }
    loadTrends();
  }, []);
  
  // Transform data for recharts
  const chartData = transformToWeeklyFormat(data);
  const prickleTypes = getUniquePrickleTypes(data); // Dynamic from actual data
  const colors = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];
  
  return (
    <Card>
      <CardHeader>Attendance Trends (12 weeks)</CardHeader>
      <CardContent>
        <LineChart width={600} height={300} data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" />
          <YAxis />
          <Tooltip />
          <Legend />
          {prickleTypes.map((type, index) => (
            <Line 
              key={type} 
              type="monotone" 
              dataKey={type} 
              stroke={colors[index % colors.length]} 
            />
          ))}
        </LineChart>
      </CardContent>
    </Card>
  );
}
```

### Cohort Retention Table (Bottom Right)

**Purpose**: Track retention by signup month.

**Columns**:
- Cohort Month
- Cohort Size
- Active (30d)
- Retention %

**Component**:
```typescript
export function CohortRetentionTable() {
  const [cohorts, setCohorts] = useState<CohortRetention[]>([]);
  
  useEffect(() => {
    async function loadCohorts() {
      const { data } = await supabase
        .from("cohort_retention")
        .select("*")
        .order("cohort_month", { ascending: false })
        .limit(12);
      
      setCohorts(data || []);
    }
    loadCohorts();
  }, []);
  
  return (
    <Card>
      <CardHeader>Cohort Retention (12 months)</CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cohort</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Retention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cohorts.map(cohort => (
              <TableRow key={cohort.cohort_month}>
                <TableCell>{formatMonth(cohort.cohort_month)}</TableCell>
                <TableCell>{cohort.cohort_size}</TableCell>
                <TableCell>{cohort.active_in_last_30d}</TableCell>
                <TableCell>
                  <span className={getRetentionColor(cohort.retention_rate)}>
                    {cohort.retention_rate}%
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

---

## API Routes

### GET /api/metrics/dashboard

**Purpose**: Fetch all dashboard data in single request.

**Response**:
```typescript
{
  metrics: {
    totalMembers: 150,
    activeMembers: 98,
    highRiskChurn: 23,
    avgPricklesPerMember: 8.5
  },
  churnRisk: [...],
  weeklyTrends: [...],
  cohortRetention: [...]
}
```

**Implementation**:
```typescript
export async function GET(request: NextRequest) {
  const supabase = createClient();
  
  // Run queries in parallel
  const [
    { data: metrics },
    { data: churnRisk },
    { data: weeklyTrends },
    { data: cohortRetention }
  ] = await Promise.all([
    supabase.rpc("get_dashboard_metrics"),
    supabase.from("member_churn_risk").select("*").order("days_since_last_attendance", { ascending: false }),
    supabase.from("weekly_attendance_trends").select("*").order("week_start", { ascending: false }).limit(12),
    supabase.from("cohort_retention").select("*").order("cohort_month", { ascending: false }).limit(12)
  ]);
  
  return NextResponse.json({
    metrics: metrics?.[0] || {},
    churnRisk: churnRisk || [],
    weeklyTrends: weeklyTrends || [],
    cohortRetention: cohortRetention || []
  });
}
```

**SQL Function**:
```sql
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS TABLE (
  total_members BIGINT,
  active_members BIGINT,
  high_risk_churn BIGINT,
  avg_prickles_per_member NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT m.id)::BIGINT as total_members,
    COUNT(DISTINCT CASE 
      WHEN a.join_time >= NOW() - INTERVAL '30 days' 
      THEN m.id 
    END)::BIGINT as active_members,
    COUNT(DISTINCT CASE 
      WHEN NOW() - MAX(a.join_time) > INTERVAL '30 days' 
      THEN m.id 
    END)::BIGINT as high_risk_churn,
    ROUND(
      AVG(CASE 
        WHEN a.join_time >= NOW() - INTERVAL '30 days' 
        THEN prickle_count 
      END),
      1
    ) as avg_prickles_per_member
  FROM members m
  LEFT JOIN prickle_attendance a ON m.id = a.member_id
  LEFT JOIN (
    SELECT member_id, COUNT(DISTINCT prickle_id) as prickle_count
    FROM prickle_attendance
    WHERE join_time >= NOW() - INTERVAL '30 days'
    GROUP BY member_id
  ) counts ON m.id = counts.member_id
  WHERE m.status = 'active';
END;
$$ LANGUAGE plpgsql;
```

---

## Member Detail Page

**Purpose**: Deep dive into individual member engagement.

**Location**: `/admin/members/[id]`

**Sections**:

### 1. Member Info
- Name, email, status
- Member since date
- Total prickles attended (all-time)
- Total minutes (all-time)

### 2. Engagement Timeline
**Chart**: Calendar heatmap showing attendance by day (last 90 days)
- Green = attended
- Gray = no attendance
- Intensity = number of prickles

### 3. Attendance History
**Table**: All prickles attended with details
- Columns: Date, Prickle Type, Duration, Time
- Sort by date (descending)
- Paginated (20 per page)

### 4. Engagement Trends
**Chart**: Line chart showing prickles per week (last 12 weeks)

**Component**:
```typescript
export default function MemberDetailPage({ params }: { params: { id: string } }) {
  const [member, setMember] = useState<Member | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  
  useEffect(() => {
    async function loadMemberData() {
      const { data: memberData } = await supabase
        .from("members")
        .select("*")
        .eq("id", params.id)
        .single();
      
      const { data: attendanceData } = await supabase
        .from("prickle_attendance")
        .select(`
          *,
          prickles (
            prickle_date,
            start_time,
            prickle_types (name)
          )
        `)
        .eq("member_id", params.id)
        .order("join_time", { ascending: false });
      
      setMember(memberData);
      setAttendance(attendanceData || []);
    }
    
    loadMemberData();
  }, [params.id]);
  
  if (!member) return <div>Loading...</div>;
  
  return (
    <div className="space-y-6">
      <MemberInfoCard member={member} />
      <EngagementTimeline attendance={attendance} />
      <AttendanceHistoryTable attendance={attendance} />
      <EngagementTrendsChart attendance={attendance} />
    </div>
  );
}
```

---

## Access Control

**Requirements**:
1. Only staff can access admin dashboard
2. Use Supabase RLS to enforce staff-only queries
3. Redirect non-staff to member dashboard

**RLS Policies**:
```sql
-- Staff table (from Local layer)
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'moderator')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- RLS: Only staff can read dashboard views
ALTER TABLE member_churn_risk ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view churn risk"
ON member_churn_risk
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM staff 
    WHERE member_id = auth.uid()
  )
);
```

**Middleware**:
```typescript
// middleware.ts
export async function middleware(request: NextRequest) {
  const supabase = createClient();
  
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    
    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("member_id", user.id)
      .single();
    
    if (!staff) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/admin/:path*'
};
```

---

## Testing

### Component Tests

```typescript
// tests/components/ChurnRiskTable.test.tsx
describe("ChurnRiskTable", () => {
  it("renders all members by default", () => {
    const members = [
      { id: '1', name: 'Alice', churn_risk: 'high' },
      { id: '2', name: 'Bob', churn_risk: 'low' }
    ];
    
    render(<ChurnRiskTable members={members} />);
    
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
  
  it("filters by risk level", () => {
    const members = [
      { id: '1', name: 'Alice', churn_risk: 'high' },
      { id: '2', name: 'Bob', churn_risk: 'low' }
    ];
    
    render(<ChurnRiskTable members={members} />);
    
    fireEvent.click(screen.getByText('High Risk'));
    
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });
});
```

### API Tests

```typescript
// tests/api/metrics-dashboard.test.ts
describe("GET /api/metrics/dashboard", () => {
  it("returns dashboard metrics", async () => {
    // Seed test data
    await seedMembers();
    await seedAttendance();
    
    const response = await fetch("/api/metrics/dashboard");
    const data = await response.json();
    
    expect(data.metrics.totalMembers).toBeGreaterThan(0);
    expect(data.churnRisk).toBeInstanceOf(Array);
    expect(data.weeklyTrends).toBeInstanceOf(Array);
    expect(data.cohortRetention).toBeInstanceOf(Array);
  });
  
  it("requires authentication", async () => {
    // No auth header
    const response = await fetch("/api/metrics/dashboard");
    
    expect(response.status).toBe(401);
  });
  
  it("requires staff role", async () => {
    // Auth as regular member (not staff)
    const response = await fetch("/api/metrics/dashboard", {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    
    expect(response.status).toBe(403);
  });
});
```

### View Tests

```typescript
// tests/views/member-churn-risk.test.ts
describe("member_churn_risk view", () => {
  it("calculates days since last attendance", async () => {
    await supabase.from("members").insert({ id: 'm1', name: 'Alice' });
    await supabase.from("prickle_attendance").insert({
      member_id: 'm1',
      join_time: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) // 15 days ago
    });
    
    const { data } = await supabase
      .from("member_churn_risk")
      .select("*")
      .eq("id", 'm1')
      .single();
    
    expect(data.days_since_last_attendance).toBeCloseTo(15, 0);
    expect(data.churn_risk).toBe('medium'); // 14-30 days
  });
  
  it("categorizes engagement level", async () => {
    await supabase.from("members").insert({ id: 'm1', name: 'Alice' });
    
    // Attend 2 prickles in last 30 days
    await supabase.from("prickle_attendance").insert([
      { member_id: 'm1', prickle_id: 'p1', join_time: new Date() },
      { member_id: 'm1', prickle_id: 'p2', join_time: new Date() }
    ]);
    
    const { data } = await supabase
      .from("member_churn_risk")
      .select("*")
      .eq("id", 'm1')
      .single();
    
    expect(data.prickles_attended_30d).toBe(2);
    expect(data.engagement_level).toBe('low_engagement'); // < 4 prickles
  });
});
```

---

## Success Criteria

1. **Dashboard Performance**:
   - [ ] Dashboard loads in <3s with 150 members
   - [ ] All queries use indexes (no sequential scans)
   - [ ] Views refresh in <1s

2. **Data Accuracy**:
   - [ ] Churn risk calculations match manual verification
   - [ ] Cohort retention percentages are correct
   - [ ] Attendance trends reflect actual participation

3. **User Experience**:
   - [ ] Churn risk table is sortable and filterable
   - [ ] Charts are readable and informative
   - [ ] Member detail page loads quickly

4. **Security**:
   - [ ] Non-staff cannot access admin dashboard
   - [ ] RLS policies enforce staff-only queries
   - [ ] No member PII exposed in logs

---

## Implementation Phases

### Phase 1: Data Layer (Week 1)
- [ ] Create SQL views (member_engagement_summary, member_churn_risk, etc.)
- [ ] Create get_dashboard_metrics() function
- [ ] Add indexes for performance
- [ ] Create RLS policies

### Phase 2: API Routes (Week 1)
- [ ] GET /api/metrics/dashboard
- [ ] Add authentication/authorization

### Phase 3: UI Components (Week 2)
- [ ] MetricsCards component
- [ ] ChurnRiskTable component
- [ ] AttendanceTrendsChart component
- [ ] CohortRetentionTable component

### Phase 4: Dashboard Page (Week 2)
- [ ] Create /admin/members page
- [ ] Integrate all components
- [ ] Add staff-only middleware
- [ ] Responsive design

### Phase 5: Member Detail Page (Week 3)
- [ ] Create /admin/members/[id] page
- [ ] MemberInfoCard component
- [ ] EngagementTimeline component
- [ ] AttendanceHistoryTable component

### Phase 6: Testing (Week 3)
- [ ] Component tests for all UI
- [ ] API tests for routes
- [ ] View tests for SQL calculations
- [ ] End-to-end test for full dashboard flow

---

## Future Enhancements

1. **Advanced Churn Prediction**:
   - ML model predicting churn probability
   - Historical patterns (attendance slope, consistency)
   - Engagement decay indicators

2. **Automated Outreach**:
   - Email templates for different risk levels
   - Scheduled campaigns for high-risk members
   - Track outreach effectiveness

3. **Custom Segments**:
   - Create member segments (e.g., "New members", "Regulars")
   - Compare metrics across segments
   - Segment-specific outreach

4. **Goal Tracking**:
   - Set retention goals by cohort
   - Track progress toward goals
   - Alert when falling behind

5. **Export and Reporting**:
   - PDF reports for stakeholders
   - CSV export for external analysis
   - Scheduled email reports

6. **Real-Time Updates**:
   - WebSocket updates for live attendance
   - Dashboard auto-refresh
   - Push notifications for high-risk members

7. **A/B Testing Integration**:
   - Test different outreach strategies
   - Measure impact on retention
   - Optimize messaging
