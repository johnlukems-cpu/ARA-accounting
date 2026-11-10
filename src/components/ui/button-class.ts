import { cn } from "./cn";

/** Button styles; usable from server and client components. */
export function buttonClass(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "md" | "sm" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60",
    size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-xs",
    variant === "primary" && "bg-primary text-primary-foreground hover:bg-navy-800",
    variant === "secondary" && "border border-border bg-surface text-foreground hover:bg-muted",
    variant === "danger" && "bg-danger text-white hover:bg-danger/90",
    variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}
