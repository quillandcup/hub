"use client";

interface DatePickerProps {
  id: string;
  label: string;
  /** YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest pickable day, YYYY-MM-DD. */
  min?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

const inputClass =
  "px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm disabled:opacity-50";

/**
 * A calendar day picker with its label. Today it's the browser's native date input; new pages use
 * this instead of a bare `<input type="date">` so a fuller calendar picker can replace it in one
 * place. Values are always YYYY-MM-DD strings.
 */
export default function DatePicker({ id, label, value, onChange, min, disabled, required, className = "" }: DatePickerProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={min}
        disabled={disabled}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
