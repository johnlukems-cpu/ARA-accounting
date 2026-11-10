import { InvoiceDetail } from "@/components/finance/invoice-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceDetail type="PURCHASE" id={(await params).id} />;
}
