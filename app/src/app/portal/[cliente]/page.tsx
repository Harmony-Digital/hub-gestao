import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { Progress } from "@/components/shell/pill";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { PHASES } from "@/lib/labels";
import { inTx } from "@/modules/context";
import { portalAccent, portalProjects } from "@/modules/portal/views";
import { aceitarTermos } from "../actions";
import { accentBorder, NoAccess, PortalTop } from "../_ui/parts";
import { portalContext, portalSessionFor } from "../_ui/session";

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

async function Portal({
  params,
}: Pick<PageProps<"/portal/[cliente]">, "params">) {
  await connection();
  const { cliente } = await params;
  const session = await portalSessionFor(cliente);
  if (!session) return <NoAccess />;

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

  const { projects, accent } = await inTx(
    await portalContext(session),
    async (t) => ({
      projects: await portalProjects(t),
      accent: await portalAccent(t),
    }),
  );

  return (
    <main
      id="conteudo"
      className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6"
    >
      <PortalTop clientName={session.clientName} accent={accent} />
      <h1 className="-mt-3 font-heading text-3xl font-semibold text-navy">
        Seus projetos
      </h1>
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
              style={accentBorder(accent)}
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
              <Link
                href={`/portal/${cliente}/${p.code}`}
                className="inline-flex items-center gap-1 self-start text-sm font-semibold text-brand-strong hover:text-navy"
              >
                Ver as entregas de {p.name}
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
