import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { entrarNoPortal } from "../../actions";

export const metadata: Metadata = {
  title: "Entrar",
  referrer: "no-referrer",
};

/**
 * Página do link de uso único. O link só é gasto no clique em "Entrar": as prévias de
 * link (WhatsApp, e-mail) só abrem a página, sem gastar o acesso.
 */
export default function EntrarPage({
  params,
}: PageProps<"/portal/entrar/[token]">) {
  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-12 sm:px-6"
    >
      <h1 className="font-heading text-2xl font-semibold text-navy">
        Seu acesso ao portal
      </h1>
      <p className="text-ink-2">
        A Harmony liberou para você o acompanhamento dos seus projetos. O link
        vale uma vez: clique para entrar.
      </p>
      <Suspense fallback={<div className="h-11" />}>
        <EntrarForm params={params} />
      </Suspense>
    </main>
  );
}

async function EntrarForm({
  params,
}: Pick<PageProps<"/portal/entrar/[token]">, "params">) {
  const { token } = await params;
  return (
    <form action={entrarNoPortal}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg">
        Entrar no portal
      </Button>
    </form>
  );
}
