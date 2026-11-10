import { InvoiceForm } from "@/components/finance/invoice-pages";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <InvoiceForm type="SALES" id={(await params).id} />;
}
