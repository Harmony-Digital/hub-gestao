import type { Metadata } from "next";

export const metadata: Metadata = { title: "Acesso" };

/** Link vencido, já usado ou sessão encerrada: sem dizer qual, sem revelar nada. */
export default function SemAcessoPage() {
  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 px-4 py-12 sm:px-6"
    >
      <h1 className="font-heading text-2xl font-semibold text-navy">
        Seu acesso não está ativo
      </h1>
      <p className="text-ink-2">
        O link pode ter vencido ou já ter sido usado, ou a sua sessão terminou.
        Peça um novo link para a equipe da Harmony.
      </p>
    </main>
  );
}
