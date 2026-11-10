import { InvoiceList } from "@/components/finance/invoice-pages";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <InvoiceList type="PURCHASE" sp={await searchParams} />;
}
