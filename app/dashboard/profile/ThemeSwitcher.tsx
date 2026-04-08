"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by only rendering after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded-md w-full"></div>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor="theme"
        className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
      >
        Theme Preference
      </label>
      <select
        id="theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System (Auto)</option>
      </select>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        {theme === "system"
          ? "Automatically matches your device's theme preference"
          : `Always use ${theme} mode`}
      </p>
    </div>
  );
}
