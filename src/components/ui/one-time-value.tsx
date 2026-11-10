"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Shows a value that is displayed only once (invitation link, recovery codes) with a copy button. */
export function OneTimeValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
      <p className="font-medium">{label}</p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs">{value}</code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
          className="rounded p-1 hover:bg-surface"
          aria-label="Copy"
        >
          {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
