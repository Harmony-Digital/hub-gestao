import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sairDoPortal } from "../actions";

/** Sem sessão (ou de outro cliente): a mesma resposta, sem revelar nada. */
export function NoAccess() {
  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 px-4 py-12 sm:px-6"
    >
      <h1 className="font-heading text-2xl font-semibold text-navy">
        Seu acesso não está ativo
      </h1>
      <p className="text-ink-2">
        Para entrar, use o link que a equipe da Harmony mandou. Se ele já foi
        usado ou venceu, peça um novo.
      </p>
    </main>
  );
}

/** O topo das páginas do portal: o nome do cliente, a trilha e o Sair. */
export function PortalTop({
  clientName,
  back,
}: {
  clientName: string;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-mono text-[11px] tracking-[0.12em] text-caption uppercase">
          {clientName}
        </p>
        {back ? (
          <Link
            href={back.href}
            className="text-sm font-semibold text-brand-strong hover:text-navy"
          >
            {back.label}
          </Link>
        ) : null}
      </div>
      <form action={sairDoPortal}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut aria-hidden="true" />
          Sair
        </Button>
      </form>
    </div>
  );
}
