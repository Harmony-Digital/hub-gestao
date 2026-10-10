import type { Metadata } from "next";

export const metadata: Metadata = { title: "Até logo" };

export default function SaiuPage() {
  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 px-4 py-12 sm:px-6"
    >
      <h1 className="font-heading text-2xl font-semibold text-navy">
        Você saiu do portal
      </h1>
      <p className="text-ink-2">
        Para entrar de novo, use um link novo da equipe da Harmony.
      </p>
    </main>
  );
}
