import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { pageContext } from "@/lib/ui-context";
import { ROLE_LABEL } from "@/lib/labels";
import { Aparencia } from "./aparencia";
import { SenhaForm } from "./senha-form";

export const metadata: Metadata = { title: "Minha conta" };

export default function ContaPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Minha conta" }]}
        title="Minha conta"
        description="Seus dados de acesso ao Hub. O login é o mesmo dos outros sistemas da Harmony que usam o Supabase compartilhado."
      />
      <main className="flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-8">
        <Suspense fallback={<div className="h-64 rounded-xl bg-off-2" />}>
          <ContaView />
        </Suspense>
      </main>
    </>
  );
}

async function ContaView() {
  const { user } = await pageContext();
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-2 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        <dt className="font-medium text-navy">Nome</dt>
        <dd className="text-ink-2">{user.fullName}</dd>
        <dt className="font-medium text-navy">E-mail</dt>
        <dd className="text-ink-2">{user.email}</dd>
        <dt className="font-medium text-navy">Papel</dt>
        <dd className="text-ink-2">{ROLE_LABEL[user.actor.role]}</dd>
      </dl>

      <section
        aria-labelledby="senha"
        className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="senha"
            className="font-heading text-lg font-semibold text-navy"
          >
            Definir senha
          </h2>
          <p className="text-sm text-ink-2">
            Com uma senha, você entra direto pela tela de login, sem precisar do
            link no e-mail. Quem digita a senha é sempre você.
          </p>
        </div>
        <SenhaForm email={user.email} />
      </section>

      <section
        aria-labelledby="aparencia"
        className="flex flex-col gap-4 rounded-xl border border-line bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="aparencia"
            className="font-heading text-lg font-semibold text-navy"
          >
            Aparência
          </h2>
          <p className="text-sm text-ink-2">
            Tema das telas do Hub. Também dá para trocar pela busca (⌘K).
          </p>
        </div>
        <Aparencia />
      </section>
    </div>
  );
}
