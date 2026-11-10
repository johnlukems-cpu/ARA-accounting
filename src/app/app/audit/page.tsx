import { getFormatter, getTranslations } from "next-intl/server";
import { requireApp } from "@/core/auth/context";
import { withTenant } from "@/core/tenancy/tenant";
import { verifyAuditChain } from "@/core/audit/audit";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui/misc";

const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const t = await getTranslations();
  const format = await getFormatter();
  const ctx = await requireApp("audit.view");
  const { before } = await searchParams;
  const beforeSeq = before && /^\d+$/.test(before) ? BigInt(before) : undefined;

  const { rows, chain, users } = await withTenant(ctx.access, async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: { organizationId: ctx.access.organizationId, ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) },
      orderBy: { seq: "desc" },
      take: PAGE,
    });
    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return { rows, chain: await verifyAuditChain(tx, ctx.access.organizationId), users };
  }, { timeout: 30_000 });

  return (
    <>
      <PageHeader
        title={t("audit.title")}
        description={t("audit.intro")}
        actions={chain.ok ? <Badge tone="success">{t("audit.chainOk", { count: chain.checked })}</Badge> : <Badge tone="danger">{t("audit.chainBroken", { seq: chain.firstBrokenSeq ?? "" })}</Badge>}
      />
      <Card>
        <Table head={[t("audit.when"), t("audit.who"), t("audit.action"), t("audit.object"), "#"]}>
          {rows.map((r) => (
            <tr key={r.seq.toString()}>
              <Td className="whitespace-nowrap">{format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "medium" })}</Td>
              <Td>{r.userId ? users.get(r.userId) ?? "—" : t("audit.system")}</Td>
              <Td><code className="text-xs">{r.action}</code></Td>
              <Td className="text-xs text-muted-foreground">{r.entity}{r.entityId ? ` · ${r.entityId.slice(0, 10)}` : ""}</Td>
              <Td className="amount text-xs text-muted-foreground">{r.seq.toString()}</Td>
            </tr>
          ))}
        </Table>
        {rows.length === PAGE && (
          <a className="mt-4 inline-block text-sm font-medium text-accent hover:underline" href={`/app/audit?before=${rows[rows.length - 1]!.seq.toString()}`}>{t("common.older")}</a>
        )}
      </Card>
    </>
  );
}
