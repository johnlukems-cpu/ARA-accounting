"use client";

import { useRef } from "react";

/** A select that switches the active organisation/company/administration/fiscal year via a server action. */
export function ContextSelect({
  action,
  field,
  value,
  label,
  options,
}: {
  action: (fd: FormData) => Promise<void>;
  field: "organization" | "company" | "administration" | "fiscalYear";
  value: string | undefined;
  label: string;
  options: { value: string; label: string }[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  if (options.length === 0) return null;
  return (
    <form ref={ref} action={action} className="min-w-0">
      <input type="hidden" name="field" value={field} />
      <label className="sr-only" htmlFor={`ctx-${field}`}>{label}</label>
      <select
        id={`ctx-${field}`}
        name="value"
        defaultValue={value}
        title={label}
        onChange={() => ref.current?.requestSubmit()}
        className="h-9 max-w-[14rem] truncate rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent [&>option]:text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </form>
  );
}
