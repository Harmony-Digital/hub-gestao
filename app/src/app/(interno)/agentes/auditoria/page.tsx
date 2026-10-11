import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { formatTimestampDay } from "@/lib/format";
import { pageContext } from "@/lib/ui-context";
import { accessAudit, LIMITS, type AuditFinding } from "@/modules/audit/access";
import { inTx } from "@/modules/context";

export const metadata: Metadata = { title: "Auditoria de acesso" };

const SEVERITY: Record<
  AuditFinding["severity"],
  { label: string; className: string }
> = {
  high: { label: "Importante", className: "bg-danger-soft text-danger-fg" },
  medium: { label: "Atenção", className: "bg-warn-soft text-warn-fg" },
  low: { label: "Para conferir", className: "bg-off-2 text-ink-2" },
};

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
});

export default function AuditoriaPage() {
  return (
    <>
      <PageHeader
        trail={[
          { label: "Sala de Controle", href: "/agentes" },
          { label: "Auditoria de acesso" },
        ]}
        title="Auditoria de acesso"
        description="O que olhar nas chaves dos agentes, nos acessos da equipe e dos clientes, nas aprovações paradas e nos custos de IA. O Hub só aponta e sugere: quem revoga, troca ou suspende é você. Toda segunda, o resumo chega na sua caixa de entrada."
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-64 rounded-2xl bg-off-2" />
          }
        >
          <AuditView />
        </Suspense>
      </main>
    </>
  );
}

async function AuditView() {
  const { user, ctx } = await pageContext();
  if (!can(user.actor, "audit.read")) {
    return (
      <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
        Só o dono do workspace e a administração veem a auditoria de acesso.
      </p>
    );
  }
  const audit = await inTx(ctx, (t) => accessAudit(t, new Date()));
  const { counts } = audit;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Count label="Chaves de agente ativas" value={counts.active_keys} />
        <Count label="Pessoas na equipe" value={counts.team_members} />
        <Count
          label="Contatos com acesso ao portal"
          value={counts.portal_contacts_with_access}
        />
        <Count label="Aprovações pendentes" value={counts.pending_approvals} />
        <Count
          label={`Recusas em ${LIMITS.recentDays} dias`}
          value={counts.denials_last_7_days}
        />
        <div className="flex flex-col gap-1 rounded-xl border border-line bg-card p-3 sm:p-4">
          <dt className="text-xs font-medium text-caption">IA neste mês</dt>
          <dd className="font-heading text-2xl font-semibold text-navy">
            {money.format(counts.ai_spent_usd_month)}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="pontos" className="flex flex-col gap-3">
        <h2
          id="pontos"
          className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
        >
          Pontos para olhar
          <span className="font-mono text-sm font-normal text-caption">
            {audit.findings.length}
          </span>
        </h2>
        {audit.findings.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
            Nada a apontar agora: chaves, acessos, aprovações e custos dentro
            das regras.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {audit.findings.map((f, i) => (
              <li
                key={`${f.kind}-${f.subject}-${i}`}
                className="flex flex-col gap-1.5 rounded-2xl border border-line bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY[f.severity].className}`}
                  >
                    {SEVERITY[f.severity].label}
                  </span>
                  <span className="font-medium break-words text-navy">
                    {f.subject}
                  </span>
                </div>
                <p className="text-sm text-ink">{f.detail}</p>
                <p className="text-sm text-ink-2">
                  {f.action}
                  {f.href ? (
                    <>
                      {" "}
                      <Link
                        href={f.href}
                        prefetch={false}
                        className="font-medium text-navy underline underline-offset-2"
                      >
                        Abrir
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="regras"
        className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-sm text-ink-2 sm:p-5"
      >
        <h2
          id="regras"
          className="font-heading text-base font-semibold text-navy"
        >
          As regras
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Chave de agente: trocar a cada {LIMITS.keyRotationDays} dias;
            revogar a parada há mais de {LIMITS.keyIdleDays} dias ou nunca usada
            depois de {LIMITS.keyUnusedGraceDays}; escopo amplo (workspace:*) só
            quando o agente precisa de tudo; gerar a próxima antes de vencer.
          </li>
          <li>
            Chave de IA: trocar a cada {LIMITS.aiCredentialRotationDays} dias e
            na hora em que alguém com acesso a ela sair.
          </li>
          <li>
            Pessoa da equipe sem gravar nada há {LIMITS.memberIdleDays} dias e
            contato com acesso parado há {LIMITS.contactIdleDays}: conferir se
            ainda precisam do acesso.
          </li>
          <li>
            Aprovação parada há mais de {LIMITS.approvalOldBusinessDays} dias
            úteis e gasto de IA acima de {Math.round(LIMITS.aiBudgetWarn * 100)}
            % do orçamento.
          </li>
        </ul>
        <p>
          Gerado em {formatTimestampDay(audit.generated_at)}. O passo a passo de
          cada troca está no runbook (docs/operacao.md, Trocar um segredo).
        </p>
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-card p-3 sm:p-4">
      <dt className="text-xs font-medium text-caption">{label}</dt>
      <dd className="font-heading text-2xl font-semibold text-navy">{value}</dd>
    </div>
  );
}
