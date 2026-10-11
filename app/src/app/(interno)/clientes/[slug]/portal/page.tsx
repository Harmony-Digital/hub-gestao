import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Circle, CircleCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { can } from "@/lib/authorize";
import { emailConfig } from "@/lib/email";
import { HubError } from "@/lib/errors";
import { formatAge, formatTimestampDay } from "@/lib/format";
import { pageContext } from "@/lib/ui-context";
import { inTx, type TxCtx } from "@/modules/context";
import {
  LINK_DAYS,
  listContacts,
  portalClient,
  type AccessStatus,
  type ContactItem,
} from "@/modules/portal/access";
import {
  portalReadiness,
  type PortalReadiness,
} from "@/modules/portal/readiness";
import {
  ClientPrivacy,
  ContactAccess,
  ContactPrivacy,
  NewContactForm,
} from "./contacts";
import { ROLE_LABEL } from "./form";

export const metadata: Metadata = { title: "Contatos e portal" };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const STATUS: Record<AccessStatus, { label: string; className: string }> = {
  none: { label: "Sem acesso", className: "bg-off-2 text-ink-2" },
  invited: {
    label: "Acesso liberado, ainda não entrou",
    className: "bg-info-soft text-info-fg",
  },
  active: { label: "Com acesso", className: "bg-ok-soft text-ok-fg" },
  revoked: {
    label: "Acesso revogado",
    className: "bg-danger-soft text-danger-fg",
  },
};

export default function PortalDoClientePage({
  params,
}: PageProps<"/clientes/[slug]/portal">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 max-w-4xl rounded-2xl bg-off-2" />
        </div>
      }
    >
      <PortalAdmin params={params} />
    </Suspense>
  );
}

async function PortalAdmin({
  params,
}: Pick<PageProps<"/clientes/[slug]/portal">, "params">) {
  const { slug } = await params;
  if (slug.length > 80 || !SLUG.test(slug)) notFound();
  const { user, ctx } = await pageContext();
  if (!can(user.actor, "workspace.admin")) {
    return (
      <>
        <PageHeader
          trail={[
            { label: "Projetos", href: "/projetos" },
            { label: "Clientes", href: "/clientes" },
            { label: "Contatos e portal" },
          ]}
          title="Contatos e portal"
        />
        <main className="px-4 py-6 sm:px-8">
          <p className="max-w-2xl rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            Só o dono do workspace ou a administração cuidam dos contatos dos
            clientes e do acesso ao portal.
          </p>
        </main>
      </>
    );
  }
  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await inTx(ctx, (t) => load(t, slug));
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const { client, contacts, readiness } = data;
  const owner = can(user.actor, "portal.manage");
  const emailOn = emailConfig() !== null;
  return (
    <>
      <PageHeader
        trail={[
          { label: "Projetos", href: "/projetos" },
          { label: "Clientes", href: "/clientes" },
          { label: client.name },
        ]}
        title="Contatos e portal"
        description="Os contatos deste cliente e o acesso deles ao portal. O contato nasce sem acesso; só o dono libera, e revoga quando quiser."
      />
      <main className="flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
        <section
          aria-labelledby="como-funciona"
          className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-sm text-ink-2 sm:p-5"
        >
          <h2
            id="como-funciona"
            className="font-heading text-base font-semibold text-navy"
          >
            Como funciona o acesso
          </h2>
          <p>
            Portal deste cliente:{" "}
            <strong className="font-semibold text-ink">
              {client.portalEnabled ? "ligado" : "desligado"}
            </strong>
            {client.portalEnabled
              ? "."
              : " (liga quando o dono liberar o acesso do primeiro contato)."}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              Liberar acesso gera um link de uso único, válido por {LINK_DAYS}{" "}
              dias, que o dono copia e manda ao contato por onde preferir.
            </li>
            <li>
              No primeiro acesso, o contato aceita o uso dos dados (LGPD). A
              sessão termina depois de 12 horas sem uso; para voltar, ele pede
              um link novo.
            </li>
            <li>
              O portal mostra os projetos do cliente (fase, progresso e o
              próximo marco, com o texto escrito para ele). Tarefas e textos
              internos nunca aparecem.
            </li>
          </ul>
        </section>

        <Readiness readiness={readiness} />

        <section aria-labelledby="contatos" className="flex flex-col gap-3">
          <h2
            id="contatos"
            className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
          >
            Contatos
            <span className="font-mono text-sm font-normal text-caption">
              {contacts.length}
            </span>
          </h2>
          {contacts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
              Nenhum contato cadastrado ainda.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {contacts.map((c) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  owner={owner}
                  emailOn={emailOn}
                />
              ))}
            </ul>
          )}
          {!owner ? (
            <p className="text-sm text-caption">
              Só o dono libera e revoga o acesso ao portal.
            </p>
          ) : null}
        </section>

        {owner ? (
          <section
            aria-labelledby="dados-pessoais"
            className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4 text-sm text-ink-2 sm:p-5"
          >
            <h2
              id="dados-pessoais"
              className="font-heading text-base font-semibold text-navy"
            >
              Dados pessoais (LGPD)
            </h2>
            <p>
              Para atender um pedido de acesso ou de portabilidade: o que o Hub
              guarda deste cliente e dos contatos dele (cadastro, acessos ao
              portal, mensagens e o que foi entregue), num arquivo JSON. Tarefas
              e textos internos ficam de fora.
            </p>
            <p>
              <a
                href={`/clientes/${client.slug}/portal/exportar`}
                className="font-medium text-navy underline underline-offset-2"
              >
                Exportar os dados de {client.name} (JSON)
              </a>
            </p>
            <p>
              Para excluir os dados pessoais de um contato, use &ldquo;Excluir
              os dados pessoais&rdquo; na linha dele; no fim do contrato, o
              botão abaixo exclui os de todos. Os registros antigos de acesso,
              avisos e entregas saem sozinhos com o tempo (retenção).
            </p>
            <ClientPrivacy clientId={client.id} clientName={client.name} />
          </section>
        ) : null}

        <section
          aria-labelledby="novo-contato"
          className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
        >
          <h2
            id="novo-contato"
            className="font-heading text-base font-semibold text-navy"
          >
            Novo contato
          </h2>
          <NewContactForm clientId={client.id} />
        </section>
      </main>
    </>
  );
}

async function load(t: TxCtx, slug: string) {
  const client = await portalClient(t, slug);
  return {
    client,
    contacts: await listContacts(t, client.id),
    readiness: await portalReadiness(t, client.id),
  };
}

function Step({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <CircleCheck
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-ok"
        />
      ) : (
        <Circle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-caption"
        />
      )}
      <span className="min-w-0">
        <span className="sr-only">{done ? "Feito: " : "Falta: "}</span>
        {children}
      </span>
    </li>
  );
}

/** OB-13: o que já está pronto para o cliente ver e o que falta, do próprio banco. */
function Readiness({ readiness: r }: { readiness: PortalReadiness }) {
  return (
    <section
      aria-labelledby="preparacao"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <h2
        id="preparacao"
        className="font-heading text-base font-semibold text-navy"
      >
        Preparação do portal
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm text-ink">
        <Step done={r.contacts > 0}>Contatos cadastrados: {r.contacts}</Step>
        <Step done={r.released > 0}>
          Acesso liberado: {r.released} de {r.contacts}
        </Step>
        <Step done={r.released > 0 && r.consented === r.released}>
          Aceite do uso dos dados (LGPD), no primeiro acesso: {r.consented} de{" "}
          {r.released}
        </Step>
      </ul>
      {r.projects.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nenhum projeto ativo deste cliente ainda: o portal fica vazio até
          haver um.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {r.projects.map((p) => (
            <li
              key={p.code}
              className="flex flex-col gap-1.5 rounded-xl bg-off p-3"
            >
              <Link
                href={`/projetos/${p.code}`}
                className="text-sm font-semibold text-navy hover:underline"
              >
                {p.name}
              </Link>
              <ul className="flex flex-col gap-1 text-sm text-ink">
                <Step done={p.hasClientObjective}>
                  Objetivo escrito para o cliente
                  {p.hasClientObjective ? null : (
                    <>
                      {" "}
                      (
                      <Link
                        href={`/projetos/${p.code}/editar`}
                        className="text-brand-strong underline-offset-2 hover:underline"
                      >
                        Editar projeto
                      </Link>
                      )
                    </>
                  )}
                </Step>
                <Step done={p.clientMilestones > 0}>
                  Entregas que aparecem no portal: {p.clientMilestones}
                </Step>
                <Step done={p.clientWorkstreams > 0}>
                  Frentes que aparecem no portal: {p.clientWorkstreams}
                </Step>
              </ul>
              {p.milestonesWithoutText > 0 ? (
                <p className="flex items-start gap-2 text-sm text-warn-fg">
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  {p.milestonesWithoutText === 1
                    ? "1 entrega marcada para o cliente está sem o título para ele e não aparece."
                    : `${p.milestonesWithoutText} entregas marcadas para o cliente estão sem o título para ele e não aparecem.`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ContactRow({
  contact: c,
  owner,
  emailOn,
}: {
  contact: ContactItem;
  owner: boolean;
  /** O Resend está configurado: o convite pode sair pelo Hub (D9). */
  emailOn: boolean;
}) {
  if (c.anonymizedAt) {
    return (
      <li className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex-1 font-medium text-ink-2">{c.name}</span>
          <span className="rounded-full bg-off-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
            Dados pessoais excluídos
          </span>
        </div>
        <p className="text-sm text-ink-2">
          Excluídos em {formatTimestampDay(c.anonymizedAt)} (LGPD). O histórico
          guarda que o contato existiu.
        </p>
      </li>
    );
  }
  const status = STATUS[c.accessStatus];
  const facts = [
    c.invitedAt ? `Liberado em ${formatTimestampDay(c.invitedAt)}` : null,
    c.consentAt
      ? `Aceitou o uso dos dados em ${formatTimestampDay(c.consentAt)}`
      : null,
    c.lastSeenAt ? `Último acesso ${formatAge(c.lastSeenAt)}` : null,
    c.pendingLinkUntil
      ? `Link sem uso, vale até ${formatTimestampDay(c.pendingLinkUntil)}`
      : null,
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-56 flex-col">
          <span className="font-medium break-words text-navy">{c.name}</span>
          <span className="font-mono text-xs break-all text-ink-2">
            {c.email}
          </span>
          <span className="text-sm text-caption">{ROLE_LABEL[c.role]}</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}
        >
          {status.label}
        </span>
      </div>
      {facts.length > 0 ? (
        <p className="text-sm text-ink-2">{facts.join(" · ")}</p>
      ) : null}
      {owner ? (
        <>
          <ContactAccess
            contactId={c.id}
            name={c.name}
            email={c.email}
            emailOn={emailOn}
            status={c.accessStatus}
          />
          <ContactPrivacy contactId={c.id} name={c.name} />
        </>
      ) : null}
    </li>
  );
}
