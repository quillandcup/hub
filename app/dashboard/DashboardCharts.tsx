"use client";

import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface WeeklyData {
  week: string;
  count: number;
}

interface DailyData {
  date: string;
  hours: number;
}

interface DashboardChartsProps {
  weeklyAttendance: WeeklyData[];
  dailyHours: DailyData[];
}

export default function DashboardCharts({ weeklyAttendance, dailyHours }: DashboardChartsProps) {
  // Format week label to be more readable
  const formatWeekLabel = (weekStr: string) => {
    const date = new Date(weekStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // Format date label for daily chart
  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* Weekly Total Attendance */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">📊 Weekly Attendance</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Total attendees per week (last 8 weeks)
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={weeklyAttendance}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis
              dataKey="week"
              tickFormatter={formatWeekLabel}
              className="text-xs fill-slate-600 dark:fill-slate-400"
            />
            <YAxis className="text-xs fill-slate-600 dark:fill-slate-400" />
            <Tooltip
              labelFormatter={formatWeekLabel}
              contentStyle={{
                backgroundColor: 'var(--tooltip-bg, #1e293b)',
                border: 'none',
                borderRadius: '8px',
                color: 'var(--tooltip-text, #fff)',
              }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Community Writing Hours */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">✍️ Community Writing Hours</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Total hours spent writing together (last 30 days)
        </p>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={dailyHours}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateLabel}
              className="text-xs fill-slate-600 dark:fill-slate-400"
            />
            <YAxis className="text-xs fill-slate-600 dark:fill-slate-400" />
            <Tooltip
              labelFormatter={formatDateLabel}
              formatter={(value: number) => [`${value.toFixed(1)} hrs`, "Writing Time"]}
              contentStyle={{
                backgroundColor: 'var(--tooltip-bg, #1e293b)',
                border: 'none',
                borderRadius: '8px',
                color: 'var(--tooltip-text, #fff)',
              }}
            />
            <Area
              type="monotone"
              dataKey="hours"
              stroke="#8b5cf6"
              fill="#8b5cf6"
              fillOpacity={0.6}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
