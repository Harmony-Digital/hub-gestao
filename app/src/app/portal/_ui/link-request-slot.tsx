import { connection } from "next/server";
import { emailConfig } from "@/lib/email";
import { LinkRequestForm } from "./link-request";

/**
 * O pedido de link pelo e-mail só aparece com o e-mail do Hub ligado no servidor (lido a
 * cada pedido, não no build); sem ele, fica o texto de pedir o link a quem convidou.
 */
export async function LinkRequestSlot({ fallback }: { fallback: string }) {
  await connection();
  if (!emailConfig()) return <p className="text-ink-2">{fallback}</p>;
  return <LinkRequestForm />;
}
