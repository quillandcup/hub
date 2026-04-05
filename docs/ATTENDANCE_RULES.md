# Attendance Tracking Rules & Thresholds

This document defines all the rules and time thresholds used in the attendance tracking system.

## Table of Contents
- [Meeting Segmentation (20-minute threshold)](#meeting-segmentation-20-minute-threshold)
- [PUP Attendance Filtering (15-minute threshold)](#pup-attendance-filtering-15-minute-threshold)
- [Host Warning Indicators (5-minute threshold)](#host-warning-indicators-5-minute-threshold)
- [Zero-Duration Filtering](#zero-duration-filtering)

---

## Meeting Segmentation (20-minute threshold)

**Purpose**: Split Zoom meetings into segments (scheduled prickles + Pop-Up Prickles) based on overlapping calendar events.

**Location**: `app/api/process/attendance/route.ts` → `splitMeetingIntoSegments()`

**Threshold**: **20 minutes** (1200000 ms)

### The 7 Rules

These rules determine how a Zoom meeting gets split when it overlaps with calendar prickles:

1. **First prickle absorbs early arrivals (≤20 min)**
   - If meeting starts ≤20 min before first scheduled prickle, first prickle starts at meeting start
   - If meeting starts >20 min before, create a PUP before the scheduled prickle

2. **Last prickle absorbs late stayers (≤20 min)**
   - If meeting ends ≤20 min after last scheduled prickle, last prickle ends at meeting end
   - If meeting ends >20 min after, create a PUP after the scheduled prickle

3. **Non-first prickles start at scheduled time**
   - All prickles except the first start at their scheduled start time

4. **Non-last prickles end at scheduled time**
   - All prickles except the last end at their scheduled end time

5. **Gaps between prickles become PUPs**
   - If there's a gap between consecutive scheduled prickles, create a PUP for that gap
   - Only creates PUP if gap is forward (segmentStart > lastEndTime)

6. **Early PUP creation (>20 min early)**
   - If first scheduled prickle starts >20 min after meeting start, create PUP from meeting start to scheduled start

7. **Late PUP creation (>20 min late)**
   - If last scheduled prickle ends >20 min before meeting end, create PUP from scheduled end to meeting end

### Example

**Zoom meeting**: 9:00 AM - 12:00 PM  
**Scheduled prickle**: 10:00 AM - 11:00 AM

**Result**:
- PUP #1: 9:00 AM - 10:00 AM (Rule 6: >20 min early)
- Scheduled: 10:00 AM - 11:00 AM
- PUP #2: 11:00 AM - 12:00 PM (Rule 7: >20 min late)

---

## PUP Attendance Filtering (15-minute threshold)

**Purpose**: Prevent double-counting people who show up early/late for scheduled prickles as also attending adjacent PUPs.

**Location**: `app/api/process/attendance/route.ts` → attendance record creation loop

**Threshold**: **15 minutes**

### Rules

1. **Standalone PUPs**: Always count attendance, regardless of duration
   - Example: Person shows up for 10-minute PUP and leaves → counts as PUP attendance

2. **PUP + Adjacent Scheduled**: Only count if PUP duration ≥15 minutes
   - Example: Person joins 7 min early for scheduled prickle → counts for scheduled only, NOT PUP
   - Example: Person attends 30-min PUP then stays for scheduled → counts for both

### Logic

```
For each PUP attendance intersection:
  IF person is ALSO attending an adjacent scheduled prickle:
    IF PUP duration < 15 minutes:
      SKIP this PUP attendance (they're just early/late)
    ELSE:
      COUNT both (substantial PUP attendance + scheduled)
  ELSE:
    COUNT the PUP (standalone attendance)
```

### Example

**Scenario 1**: Mica joins at 5:52 AM, leaves at 6:00 AM
- PUP: 5:23 AM - 6:00 AM (37 min)
- Scheduled: 6:00 AM - 7:00 AM
- Mica's PUP overlap: 8 minutes
- **Result**: Count scheduled only, NOT PUP (8 min < 15 min threshold)

**Scenario 2**: Nicole joins at 5:23 AM, leaves at 6:00 AM  
- PUP: 5:23 AM - 6:00 AM (37 min)
- Scheduled: 6:00 AM - 7:00 AM  
- Nicole's PUP overlap: 37 minutes (entire PUP)
- **Result**: Count PUP only (no scheduled attendance)

---

## Host Warning Indicators (5-minute threshold)

**Purpose**: Flag when scheduled hosts don't show up or are late to their own prickles.

**Location**: 
- `app/dashboard/calendar/page.tsx` (calendar view)
- `app/dashboard/prickles/[id]/page.tsx` (prickle details)

**Threshold**: **5 minutes**

### Rules

1. **Host Missing**: Host has no attendance record for their scheduled prickle
   - Shows: ⚠️ "Host did not attend"

2. **Host Late**: Host joined >5 minutes after prickle start time
   - Shows: ⚠️ "Host was late (>5 min)"

### Display

- Calendar view: Warning emoji appears after prickle type name
- Prickle details: Warning emoji and text appear next to host name
- Tooltip: Explains the specific warning

---

## Zero-Duration Filtering

**Purpose**: Filter out invalid prickles where someone joined and immediately left.

**Location**: `app/dashboard/calendar/CalendarWeekView.tsx`

**Rule**: Filter out prickles where `start_time === end_time`

### Example

**Bad PUP**: 9:55 AM - 9:55 AM (0 minutes)
- Someone joined Zoom and immediately disconnected
- **Result**: Filtered from calendar display

---

## Summary Table

| Threshold | Purpose | Value | Location |
|-----------|---------|-------|----------|
| Meeting segmentation | Determine when to create PUPs vs extend scheduled prickles | **20 minutes** | `app/api/process/attendance/route.ts` |
| PUP attendance filtering | Prevent double-counting early/late arrivals | **15 minutes** | `app/api/process/attendance/route.ts` |
| Host late warning | Flag late hosts | **5 minutes** | Calendar & prickle details pages |
| Zero-duration | Filter invalid prickles | **0 minutes** | Calendar display |

---

## Rationale

### Why 20 minutes for segmentation?

Allows for reasonable flexibility in start/end times while still detecting genuine separate activities. If someone shows up 25 minutes early, they're probably doing something different than the scheduled prickle.

### Why 15 minutes for PUP filtering?

Prevents crediting short overlaps (early arrivals) while still counting substantial PUP participation. If someone spent 20+ minutes in a PUP before a scheduled prickle started, that's real engagement.

### Why 5 minutes for late hosts?

Gives hosts a reasonable grace period for technical issues while still catching consistently late hosts. Balances between being too strict (1-2 min) and too lenient (10+ min).

---

## Related Documentation

- [PRD.md](./PRD.md) - Product requirements and medallion architecture
- [Python reference](../zoom-analytics/analyzer.py) - Original segmentation algorithm
