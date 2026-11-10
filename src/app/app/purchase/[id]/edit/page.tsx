import { InvoiceForm } from "@/components/finance/invoice-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceForm type="PURCHASE" id={(await params).id} />;
}
