import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { listClients } from "@/modules/projects/admin";
import { ClientForm } from "./client-forms";

export const metadata: Metadata = { title: "Clientes" };

export default function ClientesPage() {
  return (
    <>
      <PageHeader
        trail={[
          { label: "Projetos", href: "/projetos" },
          { label: "Clientes" },
        ]}
        title="Clientes"
        description="As empresas que a Harmony atende. Cada projeto pertence a um cliente; a própria Harmony é o cliente dos projetos internos."
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-64 rounded-2xl bg-off-2" />
          }
        >
          <ClientsView />
        </Suspense>
      </main>
    </>
  );
}

async function ClientsView() {
  const { user, ctx } = await pageContext();
  const clients = await inTx(ctx, (t) => listClients(t));
  const admin = can(user.actor, "workspace.admin");
  return (
    <>
      {admin ? (
        <section
          aria-labelledby="novo-cliente"
          className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
        >
          <h2
            id="novo-cliente"
            className="font-heading text-base font-semibold text-navy"
          >
            Novo cliente
          </h2>
          <ClientForm />
        </section>
      ) : null}

      <section aria-labelledby="lista-clientes" className="flex flex-col gap-3">
        <h2
          id="lista-clientes"
          className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
        >
          Cadastrados
          <span className="font-mono text-sm font-normal text-caption">
            {clients.length}
          </span>
        </h2>
        {clients.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            Nenhum cliente cadastrado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clients.map((c) => (
              <li key={c.id} className="rounded-2xl border border-line bg-card">
                <details className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="font-medium text-navy">{c.name}</span>
                    {c.segment ? (
                      <span className="text-sm text-caption">{c.segment}</span>
                    ) : null}
                    <span className="ml-auto text-sm text-ink-2">
                      {c.project_count === 1
                        ? "1 projeto"
                        : `${c.project_count} projetos`}
                    </span>
                    {admin ? (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand-strong">
                        <Pencil aria-hidden="true" className="size-3.5" />
                        <span className="group-open:hidden">Editar</span>
                        <span className="hidden group-open:inline">Fechar</span>
                      </span>
                    ) : null}
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-line p-4">
                    {c.notes_internal && !admin ? (
                      <p className="text-sm whitespace-pre-wrap text-ink-2">
                        {c.notes_internal}
                      </p>
                    ) : null}
                    {admin ? <ClientForm client={c} /> : null}
                    {c.project_count > 0 ? (
                      <Link
                        href="/projetos"
                        className="self-start text-sm font-semibold text-brand-strong hover:text-navy"
                      >
                        Ver os projetos
                      </Link>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
