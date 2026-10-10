import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { Progress } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { PHASES } from "@/lib/labels";
import { currentPortalSession } from "@/lib/portal/session";
import { inTx } from "@/modules/context";
import { portalProjects } from "@/modules/portal/views";
import { aceitarTermos, sairDoPortal } from "../actions";

export const metadata: Metadata = { title: "Seus projetos" };

const PHASE_LABEL = Object.fromEntries(PHASES.map((p) => [p.key, p.label]));

export default function PortalClientePage({
  params,
}: PageProps<"/portal/[cliente]">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="mx-auto w-full max-w-4xl px-4 py-10">
          <div className="h-40 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <Portal params={params} />
    </Suspense>
  );
}

function NoAccess() {
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

async function Portal({
  params,
}: Pick<PageProps<"/portal/[cliente]">, "params">) {
  await connection();
  const { cliente } = await params;
  const session = await currentPortalSession();
  // Sem sessão, ou sessão de outro cliente: a mesma resposta, sem revelar nada.
  if (!session || session.clientSlug !== cliente) return <NoAccess />;

  if (!session.consentAt) {
    return (
      <main
        id="conteudo"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-12 sm:px-6"
      >
        <h1 className="font-heading text-2xl font-semibold text-navy">
          Boas-vindas, {session.contactName}
        </h1>
        <div className="flex flex-col gap-3 text-ink-2">
          <p>
            Aqui você acompanha os seus projetos com a Harmony Digital: o
            andamento e as próximas entregas.
          </p>
          <p>
            Para isso, guardamos o seu nome, o seu e-mail e a data dos seus
            acessos, só para o portal funcionar e para sabermos quem acompanha
            cada projeto. Não usamos rastreadores nem repassamos esses dados. Se
            quiser ver, corrigir ou apagar os seus dados, é só pedir para a
            equipe da Harmony.
          </p>
        </div>
        <form action={aceitarTermos}>
          <Button type="submit" size="lg">
            Concordo e quero continuar
          </Button>
        </form>
      </main>
    );
  }

  const projects = await inTx(
    {
      db: await getDb(),
      actor: session.actor,
      source: "ui",
      requestId: randomUUID(),
    },
    (t) => portalProjects(t),
  );

  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] tracking-[0.12em] text-caption uppercase">
            {session.clientName}
          </p>
          <h1 className="font-heading text-3xl font-semibold text-navy">
            Seus projetos
          </h1>
        </div>
        <form action={sairDoPortal}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut aria-hidden="true" />
            Sair
          </Button>
        </form>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-ink-2">
          Ainda não há projeto para mostrar aqui. Quando a equipe liberar o
          acompanhamento, ele aparece nesta página.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {projects.map((p) => (
            <li
              key={p.code}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-xl font-semibold text-navy">
                  {p.name}
                </h2>
                <span className="text-sm text-ink-2">
                  Fase: {PHASE_LABEL[p.phase] ?? p.phase}
                </span>
              </div>
              {p.objective ? <p className="text-ink">{p.objective}</p> : null}
              <Progress
                value={p.progressPct}
                label={`Andamento de ${p.name}`}
              />
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {p.nextMilestone ? (
                  <div>
                    <dt className="text-caption">Próxima entrega</dt>
                    <dd className="text-ink">
                      {p.nextMilestone.title}
                      {p.nextMilestone.dueDate
                        ? `, previsão ${formatDate(p.nextMilestone.dueDate)}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {p.targetDate ? (
                  <div>
                    <dt className="text-caption">Entrega final prevista</dt>
                    <dd className="text-ink">{formatDate(p.targetDate)}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
