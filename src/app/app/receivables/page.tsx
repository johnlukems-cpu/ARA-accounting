import { AgingPage } from "@/components/finance/aging-page";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <AgingPage side="RECEIVABLE" sp={await searchParams} />;
}
