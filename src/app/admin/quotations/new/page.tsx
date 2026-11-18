import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/modules/admin/guard";
import { QuoteForm } from "@/components/admin/quote-form";
import { Card, PageHeader } from "@/components/ui/misc";

export default async function NewQuotation({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const t = await getTranslations();
  const a = await requireAdmin("quotes.create");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title={t("admin.quote.new")} description={t("admin.quote.newIntro")} />
      <Card><QuoteForm a={a} customerId={sp.customer} /></Card>
    </>
  );
}
