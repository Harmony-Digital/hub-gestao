import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock3,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { roadmap, statusLabel, type MilestoneStatus } from "@/lib/roadmap";

const statusStyle: Record<MilestoneStatus, string> = {
  concluido: "bg-ok-soft text-ok-fg",
  "em-andamento": "bg-warn-soft text-warn-fg",
  planejado: "bg-off-2 text-ink-2",
  adiado: "bg-off-2 text-caption",
};

const statusIcon: Record<MilestoneStatus, typeof CircleCheck> = {
  concluido: CircleCheck,
  "em-andamento": Clock3,
  planejado: CircleDashed,
  adiado: CirclePause,
};

export default function Home() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Hoje" }]}
        title="Hoje"
        description="A IA executa. O humano decide. O painel do dia (decisões, bloqueios, riscos e o que os agentes fizeram) chega nas próximas entregas do M3."
      />

      {/* Todo o conteúdo depende da sessão conferida: sem acesso, nada aparece. */}
      <Suspense fallback={<MainSkeleton />}>
        <HomeContent />
      </Suspense>

      <footer className="mt-auto border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-caption sm:px-8">
          <span>Harmony Digital · uso interno</span>
          <span className="font-mono text-xs">
            versão {process.env.APP_VERSION ?? "local"}
          </span>
        </div>
      </footer>
    </>
  );
}

async function HomeContent() {
  const user = await getCurrentUser();
  const firstName = user.fullName.trim().split(/\s+/)[0];
  return (
    <main className="flex w-full max-w-5xl flex-col gap-10 px-4 py-8 sm:px-8">
      <section className="flex flex-col gap-4">
        <p className="text-lg leading-relaxed text-ink-2">
          Olá, {firstName}. Projetos, departamentos e atividades da Harmony em
          um só lugar. Os agentes executam e registram tudo. Para você, ficam as
          decisões.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="h-11 px-4 text-[15px]">
            <Link href="/projetos">
              Ver os projetos
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-11 px-4 text-[15px]"
          >
            <Link href="/agentes">Abrir a Sala de Controle</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="etapas" className="flex flex-col gap-4">
        <h2 id="etapas" className="text-xl font-semibold text-navy">
          Etapas da construção
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          {roadmap.map((m) => {
            const Icon = statusIcon[m.status];
            return (
              <li
                key={m.code}
                className={`flex flex-col gap-2 rounded-xl border bg-card p-4 ${
                  m.status === "em-andamento"
                    ? "border-2 border-brand"
                    : "border-line"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-caption">
                    {m.code}
                  </span>
                  <span
                    className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[m.status]}`}
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                    {statusLabel[m.status]}
                  </span>
                </div>
                <p className="font-heading text-base font-semibold text-navy">
                  {m.title}
                </p>
                <p className="text-sm leading-relaxed text-ink-2">
                  {m.summary}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}

function MainSkeleton() {
  return (
    <main
      aria-busy="true"
      className="flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-8"
    >
      <div className="h-4 w-48 rounded bg-off-2" />
      <div className="h-12 w-full max-w-xl rounded bg-off-2" />
      <div className="h-20 w-full max-w-2xl rounded bg-off-2" />
    </main>
  );
}
