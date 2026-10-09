import Image from "next/image";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-1 flex-col bg-background">
      <header className="bg-navy text-mist">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Image
            src="/brand/harmony-logo-branco.png"
            alt="Harmony Digital"
            width={140}
            height={40}
            priority
            className="h-8 w-auto"
          />
          <span className="rounded-full border border-brand/40 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-brand-soft uppercase">
            Hub · em construção
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-12 sm:px-6">
        <section className="flex flex-col gap-4">
          <p className="font-mono text-xs tracking-[0.12em] text-brand-strong uppercase">
            Hub de Gestão · Harmony Digital
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-navy sm:text-5xl">
            A IA executa. O humano decide.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
            Projetos, departamentos e atividades da Harmony em um só lugar. Os
            agentes executam e registram tudo. Para você, ficam as decisões.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg" className="h-11 px-4 text-[15px]">
              <a href="/api/health">
                Ver a saúde do serviço
                <ArrowUpRight aria-hidden="true" />
              </a>
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

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-caption sm:px-6">
          <span>Harmony Digital · uso interno</span>
          <span className="font-mono text-xs">
            versão {process.env.APP_VERSION ?? "local"}
          </span>
        </div>
      </footer>
    </div>
  );
}
