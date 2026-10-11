import Image from "next/image";
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

/** Borda de destaque com a cor do cliente: só detalhe, nunca a cor de um texto. */
export function accentBorder(
  accent: string | null,
): { borderLeftColor: string; borderLeftWidth: number } | undefined {
  return accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : undefined;
}

/** O topo das páginas do portal: o logo e o nome do cliente, a trilha e o Sair. */
export function PortalTop({
  clientName,
  accent = null,
  logo = null,
  back,
}: {
  clientName: string;
  /** Cor de destaque do cliente (#RRGGBB), num ponto ao lado do nome. */
  accent?: string | null;
  /** Endereço do logo do cliente (rota do portal), se houver (RF-04). */
  logo?: string | null;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        {logo ? (
          // O nome do cliente vem logo abaixo: o logo é decorativo para o leitor de tela.
          // Sem otimização: a imagem exige a sessão do portal, que o otimizador não tem.
          <Image
            src={logo}
            alt=""
            width={160}
            height={40}
            unoptimized
            loading="eager"
            className="h-10 w-auto max-w-40 object-contain object-left"
          />
        ) : null}
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-caption uppercase">
          {accent ? (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: accent }}
            />
          ) : null}
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
