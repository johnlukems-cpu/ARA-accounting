/**
 * Dependency-free charts for the admin dashboard (inline SVG, server-rendered). Values are base-currency strings.
 * Each bar group has an accessible label; the data is also available as a table on the reports page.
 */
export function BarChart({ data, series, label, format }: { data: Record<string, string | number>[]; series: { key: string; label: string; className: string }[]; label: string; format: (v: number) => string }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Math.abs(Number(d[s.key]) || 0))));
  const W = 640;
  const H = 180;
  const group = W / Math.max(1, data.length);
  const bar = Math.max(4, (group - 10) / series.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={label} className="h-auto w-full">
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" />
        {data.map((d, i) => (
          <g key={String(d.month ?? i)}>
            <title>{`${d.month}: ${series.map((s) => `${s.label} ${format(Number(d[s.key]) || 0)}`).join(", ")}`}</title>
            {series.map((s, j) => {
              const v = Math.max(0, Number(d[s.key]) || 0);
              const h = (v / max) * (H - 8);
              return <rect key={s.key} x={i * group + 5 + j * bar} y={H - h} width={bar - 2} height={h} rx={2} className={s.className} />;
            })}
            <text x={i * group + group / 2} y={H + 15} textAnchor="middle" className="fill-muted-foreground text-[10px]">{String(d.month).slice(5)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" className={s.className} /></svg>{s.label}</span>)}
      </figcaption>
    </figure>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" | "danger" | "success" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-accent" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
