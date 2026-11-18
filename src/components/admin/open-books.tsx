import { getTranslations } from "next-intl/server";
import { openHomeBooksAction } from "@/actions/admin";

/** Opens a page of the accounting app with ARA's own administration as the active context. */
export async function OpenBooks({ to, label }: { to: string; label?: string }) {
  const t = await getTranslations();
  return (
    <form action={openHomeBooksAction}>
      <input type="hidden" name="to" value={to} />
      <button className="text-sm font-medium text-accent hover:underline">{label ?? t("admin.openBooks")}</button>
    </form>
  );
}
