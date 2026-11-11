"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { cn } from "./cn";
import { buttonClass } from "./button-class";
import { OneTimeValue } from "./one-time-value";

type FormAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;
const ErrorsContext = createContext<Record<string, string[]> | undefined>(undefined);
/** Per-form id prefix so labels stay bound to their own field when a page has several forms with the same field names. */
const IdContext = createContext<string>("");

/** The element id for a field name inside the current form. */
export function useFieldId(name: string) {
  const prefix = useContext(IdContext);
  return prefix ? `${prefix}-${name}` : name;
}

/** Form bound to a server action: shows the result message, field errors and a pending state. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  dataLabels,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Labels for one-time values returned in `state.data` (e.g. { link: "Invitation link" }); shown with a copy button. */
  dataLabels?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const idPrefix = `f${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <IdContext.Provider value={idPrefix}>
    <ErrorsContext.Provider value={state?.errors}>
      <form ref={ref} action={formAction} className={cn("space-y-4", className)} noValidate>
        {state?.message && (
          <div
            role={state.ok ? "status" : "alert"}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
              state.ok ? "border-accent/30 bg-accent-soft text-foreground" : "border-danger/30 bg-danger/5 text-danger",
            )}
          >
            {state.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" /> : <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>{state.message}</span>
          </div>
        )}
        {state?.ok && dataLabels &&
          Object.entries(dataLabels).map(([key, label]) => (state.data?.[key] ? <OneTimeValue key={key} label={label} value={state.data[key]} /> : null))}
        {children}
      </form>
    </ErrorsContext.Provider>
    </IdContext.Provider>
  );
}

export function useFieldErrors(name: string) {
  return useContext(ErrorsContext)?.[name];
}

export function SubmitButton({ children, variant = "primary", className }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(buttonClass(variant), className)} aria-busy={pending}>
      {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}


export function Field({ label, name, hint, children, className }: { label: string; name: string; hint?: string; children: ReactNode; className?: string }) {
  const errors = useFieldErrors(name);
  const id = useFieldId(name);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !errors && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-danger" id={`${id}-error`}>
          {e}
        </p>
      ))}
    </div>
  );
}

const inputClass =
  "block h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const errors = useFieldErrors(props.name);
  const id = useFieldId(props.name);
  return <input id={id} aria-invalid={!!errors} aria-describedby={errors ? `${id}-error` : undefined} {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { name: string }) {
  const errors = useFieldErrors(props.name);
  const id = useFieldId(props.name);
  return <select id={id} aria-invalid={!!errors} {...props} className={cn(inputClass, "pr-8", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  const errors = useFieldErrors(props.name);
  const id = useFieldId(props.name);
  return <textarea id={id} aria-invalid={!!errors} {...props} className={cn(inputClass, "h-auto min-h-20 py-2", props.className)} />;
}

export function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 rounded border-border accent-[var(--accent)]" />
      {label}
    </label>
  );
}
