import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  departmentsOverview,
  type DepartmentCard,
} from "@/modules/departments/view";

export const metadata: Metadata = { title: "Departamentos" };

export default function DepartamentosPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Departamentos" }]}
        title="Departamentos"
        description="O trabalho de cada departamento em todos os projetos ativos, pelas frentes: o que está aberto, em andamento, bloqueado e sem responsável."
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-64 rounded-2xl bg-off-2" />
          }
        >
          <DepartmentsView />
        </Suspense>
      </main>
    </>
  );
}

async function DepartmentsView() {
  const { ctx } = await pageContext();
  const departments = await inTx(ctx, (t) => departmentsOverview(t));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {departments.map((d) => (
        <Card key={d.slug} department={d} />
      ))}
    </ul>
  );
}

function Card({ department: d }: { department: DepartmentCard }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-full"
          style={{ background: d.color }}
        />
        <Link
          href={`/departamentos/${d.slug}`}
          className="font-heading text-base font-semibold text-navy hover:underline"
        >
          {d.name}
        </Link>
      </div>
      <p className="text-sm text-ink-2">
        {d.lead ? `Responsável: ${d.lead}` : "Sem responsável definido"} ·{" "}
        {d.projects === 1 ? "1 projeto" : `${d.projects} projetos`}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Number label="Abertas" value={d.open} />
        <Number label="Em andamento" value={d.inProgress} />
        <Number label="Bloqueadas" value={d.blocked} alert={d.blocked > 0} />
        <Number label="Concluídas na semana" value={d.doneLast7Days} />
        <Number
          label="Sem responsável"
          value={d.unassigned}
          alert={d.unassigned > 0}
        />
      </dl>
    </li>
  );
}

function Number({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-xl bg-off px-2 py-2">
      <dd
        className={`font-mono text-lg font-semibold ${alert ? "text-danger-fg" : "text-navy"}`}
      >
        {value}
      </dd>
      <dt className="order-first text-xs text-caption">{label}</dt>
    </div>
  );
}
