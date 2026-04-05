"use client";

import { useState } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface WeeklyData {
  week: string;
  uniqueAttendees: number;
  repeatAttendance: number;
}

interface DailyData {
  date: string;
  hours: number;
}

interface DashboardChartsProps {
  weeklyAttendance: WeeklyData[];
  dailyHours: DailyData[];
}

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-block ml-2">
      <button
        type="button"
        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
      {show && (
        <div className="absolute z-10 left-6 top-0 w-64 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-lg p-3 shadow-lg">
          {text}
        </div>
      )}
    </div>
  );
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
        <div className="flex items-center mb-4">
          <h2 className="text-xl font-bold">📊 Weekly Attendance</h2>
          <InfoTooltip text="Stacked bar shows unique members (teal, bottom) and their repeat attendance (orange, top). Height = total attendance. Example: 20 unique members + 30 repeat visits = 50 total." />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Attendance patterns over last 8 weeks
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
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="uniqueAttendees" stackId="a" fill="#14b8a6" name="Unique Attendees" />
            <Bar dataKey="repeatAttendance" stackId="a" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Repeat Attendance" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Community Writing Hours */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-center mb-4">
          <h2 className="text-xl font-bold">✍️ Community Writing Hours</h2>
          <InfoTooltip text="Daily total of hours all members spent in prickles. Calculated by summing the duration each person attended (join to leave time). Shows collective creative time across the community." />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Collective writing time per day (last 30 days)
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
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.6}
              name="Writing Hours"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
