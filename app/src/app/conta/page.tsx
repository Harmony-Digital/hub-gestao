import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SenhaForm } from "./senha-form";

export const metadata: Metadata = { title: "Minha conta" };

const ROLE_LABEL = {
  owner: "Dono",
  admin: "Administração",
  member: "Equipe",
} as const;

export default function ContaPage() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <section className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-navy">
            Minha conta
          </h1>
          <p className="leading-relaxed text-ink-2">
            Seus dados de acesso ao Hub. O login é o mesmo dos outros sistemas
            da Harmony que usam o Supabase compartilhado.
          </p>
        </section>
        <Suspense fallback={<div className="h-64 rounded-xl bg-off-2" />}>
          <ContaView />
        </Suspense>
      </main>
    </div>
  );
}

async function ContaView() {
  const user = await getCurrentUser();
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
    </div>
  );
}
