import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { emailConfig } from "@/lib/email";
import { formatAge } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  workspaceSettings,
  type TeamMember,
  type WorkspaceSettings,
} from "@/modules/workspace/settings";
import { EmailTestButton } from "./email-test";
import {
  AddMemberButton,
  DepartmentLeadForm,
  MemberAccessButton,
  MemberRoleButton,
  WorkspaceNameForm,
} from "./team";

export const metadata: Metadata = { title: "Configurações" };

export default function ConfiguracoesPage() {
  return (
    <>
      <PageHeader
        trail={[{ label: "Configurações" }]}
        title="Configurações"
        description="O workspace, a equipe e os responsáveis dos departamentos. O que já tem tela própria está nos atalhos, no fim da página."
      />
      <main className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-96 rounded-2xl bg-off-2" />
          }
        >
          <Settings />
        </Suspense>
      </main>
    </>
  );
}

const SECTION =
  "flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5";

function SectionTitle({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="font-heading text-lg font-semibold text-navy">
        {title}
      </h2>
      {children ? <p className="text-sm text-ink-2">{children}</p> : null}
    </div>
  );
}

async function Settings() {
  const { user, ctx } = await pageContext();
  if (!can(user.actor, "workspace.admin")) {
    return (
      <>
        <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
          As configurações do workspace são do dono e da administração. Seus
          dados, a senha e o tema ficam em{" "}
          <Link href="/conta" className="font-semibold text-navy underline">
            Minha conta
          </Link>
          .
        </p>
        <Shortcuts admin={false} />
      </>
    );
  }
  const settings = await inTx(ctx, (t) => workspaceSettings(t));
  const owner = user.actor.role === "owner";
  return (
    <>
      <WorkspaceSection settings={settings} owner={owner} />
      <TeamSection team={settings.team} owner={owner} />
      <DepartmentsSection settings={settings} />
      <EmailSection owner={owner} on={emailConfig() !== null} />
      <Shortcuts admin />
    </>
  );
}

function WorkspaceSection({
  settings,
  owner,
}: {
  settings: WorkspaceSettings;
  owner: boolean;
}) {
  const ws = settings.workspace;
  return (
    <section aria-labelledby="workspace" className={SECTION}>
      <SectionTitle id="workspace" title="Workspace" />
      {owner ? <WorkspaceNameForm name={ws.name} /> : null}
      <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-6">
        {owner ? null : (
          <>
            <dt className="font-medium text-navy">Nome</dt>
            <dd className="text-ink-2">{ws.name}</dd>
          </>
        )}
        <dt className="font-medium text-navy">Endereço curto</dt>
        <dd className="font-mono text-ink-2">{ws.slug}</dd>
        <dt className="font-medium text-navy">Fuso horário</dt>
        <dd className="text-ink-2">{ws.timezone}</dd>
        <dt className="font-medium text-navy">Código das tarefas</dt>
        <dd className="font-mono text-ink-2">{ws.taskPrefix}-n</dd>
        <dt className="font-medium text-navy">Teto de IA do mês</dt>
        <dd className="text-ink-2">
          {settings.aiBudgetUsd === null
            ? "Sem teto geral (cada agente tem o próprio orçamento)"
            : `US$ ${settings.aiBudgetUsd.toLocaleString("pt-BR")} para todos os agentes`}
        </dd>
      </dl>
      <p className="text-xs text-ink-2">
        O endereço curto, o fuso e o código das tarefas não mudam pela tela: os
        códigos estão nos plan.md e nos links já enviados. O teto de IA fica no
        servidor (LLM_MONTHLY_BUDGET_USD).
      </p>
    </section>
  );
}

const STATUS_PILL: Record<
  TeamMember["status"],
  { label: string; tone: "ok" | "danger" }
> = {
  active: { label: "Ativa", tone: "ok" },
  suspended: { label: "Suspensa", tone: "danger" },
};

function TeamSection({ team, owner }: { team: TeamMember[]; owner: boolean }) {
  return (
    <section aria-labelledby="equipe" className={SECTION}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle id="equipe" title="Equipe">
          {owner
            ? "Quem entra no Hub. Suspender tira o acesso na hora; o histórico e as tarefas da pessoa continuam."
            : "Quem entra no Hub. Pôr gente na equipe, mudar o papel e suspender são do dono."}
        </SectionTitle>
        {owner ? <AddMemberButton /> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line" aria-label="Equipe">
        {team.map((m) => (
          <li
            key={m.profileId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-semibold text-navy">
                {m.name}
                {m.me ? (
                  <span className="font-normal text-ink-2"> (você)</span>
                ) : null}
              </p>
              <p className="text-xs break-all text-ink-2">{m.email}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={m.role === "member" ? "neutral" : "info"}>
                  {ROLE_LABEL[m.role]}
                </Pill>
                <Pill tone={STATUS_PILL[m.status].tone}>
                  {STATUS_PILL[m.status].label}
                </Pill>
                <span className="text-xs text-ink-2">
                  {m.linked ? "Já entrou no Hub" : "Ainda não entrou"}
                  {m.lastActivity
                    ? ` · última atividade ${formatAge(m.lastActivity)}`
                    : ""}
                </span>
              </div>
            </div>
            {owner && !m.me && m.role !== "owner" ? (
              <div className="flex flex-wrap items-start gap-1">
                <MemberRoleButton
                  profileId={m.profileId}
                  name={m.name}
                  role={m.role}
                />
                <MemberAccessButton
                  profileId={m.profileId}
                  name={m.name}
                  status={m.status}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DepartmentsSection({ settings }: { settings: WorkspaceSettings }) {
  const people = settings.team
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.profileId, name: m.name }));
  return (
    <section aria-labelledby="departamentos" className={SECTION}>
      <SectionTitle id="departamentos" title="Departamentos">
        O responsável de cada departamento, da equipe ativa. A carga e o quadro
        de cada um ficam em Departamentos.
      </SectionTitle>
      <ul className="flex flex-col divide-y divide-line">
        {settings.departments.map((d) => (
          <li
            key={d.id}
            className="grid items-center gap-2 py-3 sm:grid-cols-[minmax(0,14rem)_1fr]"
          >
            <Link
              href={`/departamentos/${d.slug}`}
              className="text-sm font-semibold text-navy hover:underline"
            >
              {d.name}
            </Link>
            <DepartmentLeadForm
              departmentId={d.id}
              departmentName={d.name}
              leadProfileId={d.leadProfileId}
              leadName={d.leadName}
              people={people}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmailSection({ owner, on }: { owner: boolean; on: boolean }) {
  return (
    <section aria-labelledby="email" className={SECTION}>
      <SectionTitle id="email" title="E-mail do Hub">
        {on
          ? "Ligado: o convite do portal pode sair pelo Hub, por e-mail, com o clique do dono."
          : "Desligado: falta configurar o Resend no servidor (docs/email.md). Até lá, o dono copia o convite do portal e manda por onde preferir."}
      </SectionTitle>
      {owner ? <EmailTestButton on={on} /> : null}
    </section>
  );
}

/** Atalhos; `adminOnly` some para quem é só da equipe (a tela de destino recusaria). */
const SHORTCUTS: {
  href: string;
  label: string;
  hint: string;
  adminOnly?: boolean;
}[] = [
  {
    href: "/agentes",
    label: "Sala de Controle",
    hint: "Agentes, chaves dos agentes, chaves e modelos de IA e webhooks de saída.",
  },
  {
    href: "/agentes/auditoria",
    label: "Auditoria de acesso",
    adminOnly: true,
    hint: "Chaves velhas, paradas ou largas demais, pessoas e contatos sem uso, recusas, gasto de IA e webhooks com falha.",
  },
  {
    href: "/modelos",
    label: "Modelos de projeto",
    adminOnly: true,
    hint: "Os esqueletos de marcos, frentes e tarefas para começar um projeto.",
  },
  {
    href: "/clientes",
    label: "Clientes e portal",
    hint: "Cadastro dos clientes, contatos, acesso ao portal e os dados pessoais (LGPD).",
  },
  {
    href: "/caixa-de-entrada",
    label: "Avisos",
    hint: "A caixa de entrada e as preferências de aviso.",
  },
  {
    href: "/conta",
    label: "Minha conta",
    hint: "Seus dados, a senha e o tema das telas.",
  },
];

function Shortcuts({ admin }: { admin: boolean }) {
  return (
    <section aria-labelledby="atalhos" className={SECTION}>
      <SectionTitle id="atalhos" title="Atalhos">
        Configurações com tela própria. Os status das tarefas e os campos
        personalizados ficam no Editar de cada projeto.
      </SectionTitle>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SHORTCUTS.filter((s) => admin || !s.adminOnly).map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex h-full flex-col gap-0.5 rounded-xl border border-line p-3 transition-colors hover:border-brand"
            >
              <span className="text-sm font-semibold text-navy">{s.label}</span>
              <span className="text-xs text-ink-2">{s.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
