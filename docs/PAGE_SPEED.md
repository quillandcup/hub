# Page speed baseline

Recorded by `pnpm page-speed --record`; see scripts/page-speed.ts.

### Baseline: before #902, Nov 2 14:00Z to Nov 3 03:00Z

Window 2026-11-02T14:00:00Z to 2026-11-03T03:00:00Z (UTC, 1h buckets); recorded with production at 8ad77bdb. Milliseconds.

| Route | Requests | Server p50 | Server p75 | Visits | FCP p75 | LCP p75 | TTFB p75 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/dashboard` | 1106 | 21 | 92 | 22 | 2954 | 2954 | 1222 |
| `/my-prickles` | 988 | 18 | 45 | 1 | 3316 | 3316 | 411 |
| `/settings` | 392 | 58 | 183 | 16 | 1982 | 1982 | 898 |
| `/projects` | 1011 | 19 | 48 | 16 | 1071 | 1113 | 57 |
| `/courses` | 1006 | 19 | 43 | 4 | 968 | 968 | 71 |
| `/chat/[id]` | 3375 | 226 | 359 | 11 | 1336 | 1544 | 81 |
| `/members` | 925 | 17 | 27 | 2 | 1168 | 1168 | 179 |

### 2026-11-03

Window 2026-11-03T03:11:29.451Z to 2026-11-04T03:11:29.451Z (UTC, 1h buckets); recorded with production at aac864eb. Milliseconds.

| Route | Requests | Server p50 | Server p75 | Visits | FCP p75 | LCP p75 | TTFB p75 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/dashboard` | 2590 | 34 | 175 | 102 | 3040 | 3225 | 1020 |
| `/my-prickles` | 2030 | 19 | 51 | 1 | 1846 | 1901 | 33 |
| `/settings` | 834 | 40 | 156 | 36 | 2440 | 2460 | 1142 |
| `/projects` | 2229 | 23 | 114 | 55 | 1030 | 1030 | 79 |
| `/courses` | 1845 | 18 | 32 | 1 | 1205 | - | 263 |
| `/chat/[id]` | 4508 | 208 | 298 | 12 | 1248 | 1732 | 79 |
| `/members` | 1906 | 18 | 30 | - | - | - | - |

