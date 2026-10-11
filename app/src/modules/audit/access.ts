import { z } from "zod";
import { authorize } from "@/lib/authorize";
import { forbidden } from "@/lib/errors";
import { iso } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { businessDaysBetween } from "@/modules/health/rule";
import { notifyOwners } from "@/modules/notifications";

/**
 * Auditoria de acesso e segurança (AC-14, M8): regras em código sobre as chaves de agente,
 * as pessoas da equipe, os contatos do portal, as aprovações paradas, as recusas, o gasto
 * de IA, as chaves dos provedores de IA e os webhooks. O Hub só aponta e sugere; quem
 * revoga, troca ou suspende é o dono (Sala de Controle). A política de rotação está em
 * `docs/operacao.md`.
 */

export const LIMITS = {
  keyRotationDays: 90,
  keyIdleDays: 30,
  keyUnusedGraceDays: 14,
  keyExpiryWarningDays: 14,
  memberIdleDays: 60,
  contactIdleDays: 90,
  approvalOldBusinessDays: 3,
  aiBudgetWarn: 0.8,
  aiCredentialRotationDays: 180,
  recentDays: 7,
} as const;

const Severity = z.enum(["high", "medium", "low"]);

export const AuditFinding = z.object({
  kind: z.enum([
    "key_old",
    "key_idle",
    "key_unused",
    "key_broad",
    "key_expiring",
    "key_paused_agent",
    "member_idle",
    "contact_idle",
    "approval_old",
    "denials",
    "ai_budget",
    "ai_credential_old",
    "webhook_failing",
  ]),
  severity: Severity,
  subject: z.string(),
  detail: z.string(),
  action: z.string().describe("O que o dono pode fazer, em PT-BR."),
  href: z.string().nullable(),
  key_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Só nos pontos de chave: o id para pedir a revogação ao Fábio (hub_request_approval, tipo agent_key, payload.key_id).",
    ),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

export const AccessAuditDto = z.object({
  generated_at: z.string(),
  counts: z.object({
    active_keys: z.number().int(),
    team_members: z.number().int(),
    portal_contacts_with_access: z.number().int(),
    pending_approvals: z.number().int(),
    denials_last_7_days: z.number().int(),
    ai_spent_usd_month: z.number(),
  }),
  findings: z.array(AuditFinding),
});
export type AccessAuditDto = z.infer<typeof AccessAuditDto>;

const DAY = 86_400_000;
const daysSince = (value: Date | string, now: Date) =>
  Math.floor((now.getTime() - new Date(value).getTime()) / DAY);
const money = (n: number) => `US$ ${n.toFixed(2)}`;

const ORDER: Record<AuditFinding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * A auditoria do workspace agora. Só o dono e a administração, o próprio Hub (relatório
 * semanal) e agente com `agents:read` e acesso a todos os projetos (o AC-14).
 */
export async function accessAudit(
  t: TxCtx,
  now: Date = new Date(),
): Promise<AccessAuditDto> {
  authorize(t.actor, "audit.read");
  if (t.actor.type === "agent" && t.actor.projectIds !== null) {
    throw forbidden(
      "A auditoria olha o workspace inteiro: precisa de chave com acesso a todos os projetos.",
    );
  }
  const findings: AuditFinding[] = [];

  // Chaves de agente ativas (as vencidas o Hub já recusa por regra).
  const keys = await many<{
    id: string;
    key_prefix: string;
    scopes: string[];
    all_projects: boolean;
    expires_at: Date | string;
    last_used_at: Date | string | null;
    created_at: Date | string;
    agent_name: string;
    agent_status: string;
  }>(
    t,
    `select k.id, k.key_prefix, k.scopes, k.project_ids is null as all_projects,
            k.expires_at, k.last_used_at, k.created_at,
            a.name as agent_name, a.status::text as agent_status
       from ${S}.agent_api_keys k
       join ${S}.agents a on a.id = k.agent_id
      where k.revoked_at is null and k.expires_at > now()
      order by a.name, k.created_at`,
  );
  for (const k of keys) {
    const subject = `${k.agent_name} (${k.key_prefix})`;
    const first = findings.length;
    const age = daysSince(k.created_at, now);
    if (k.agent_status === "paused") {
      findings.push({
        kind: "key_paused_agent",
        severity: "low",
        subject,
        detail: "O agente está pausado e a chave continua valendo.",
        action:
          "Se o agente não volta, revogue a chave na Sala de Controle; se volta, deixe como está.",
        href: "/agentes",
      });
    }
    if (age > LIMITS.keyRotationDays) {
      findings.push({
        kind: "key_old",
        severity: "medium",
        subject,
        detail: `Chave criada há ${age} dias (a política é trocar a cada ${LIMITS.keyRotationDays}).`,
        action:
          "Gere uma chave nova, ponha no agente e revogue esta (Sala de Controle).",
        href: "/agentes",
      });
    }
    if (!k.last_used_at && age > LIMITS.keyUnusedGraceDays) {
      findings.push({
        kind: "key_unused",
        severity: "medium",
        subject,
        detail: `Chave criada há ${age} dias e nunca usada.`,
        action: "Se o agente não vai usar, revogue a chave.",
        href: "/agentes",
      });
    } else if (
      k.last_used_at &&
      daysSince(k.last_used_at, now) > LIMITS.keyIdleDays
    ) {
      findings.push({
        kind: "key_idle",
        severity: "low",
        subject,
        detail: `Sem uso há ${daysSince(k.last_used_at, now)} dias.`,
        action: "Se o agente parou, revogue a chave.",
        href: "/agentes",
      });
    }
    if (k.scopes.includes("workspace:*")) {
      findings.push({
        kind: "key_broad",
        severity: "medium",
        subject,
        detail:
          "Escopo amplo (workspace:*): a chave faz tudo o que um agente pode fazer, em todos os projetos.",
        action:
          "Troque por uma chave só com os escopos e os projetos que o agente usa (AGENTES.md §4).",
        href: "/agentes",
      });
    }
    const left = Math.ceil(
      (new Date(k.expires_at).getTime() - now.getTime()) / DAY,
    );
    if (left <= LIMITS.keyExpiryWarningDays) {
      findings.push({
        kind: "key_expiring",
        severity: "medium",
        subject,
        detail: `A chave vence em ${left} ${left === 1 ? "dia" : "dias"}.`,
        action:
          "Gere a próxima chave e ponha no agente antes de vencer, para ele não parar.",
        href: "/agentes",
      });
    }
    // Os pontos desta chave levam o id dela: o auditor pode pedir a revogação (agent_key).
    for (const finding of findings.slice(first)) finding.key_id = k.id;
  }

  // Pessoas da equipe: quem não grava nada há muito tempo.
  const members = await many<{
    full_name: string;
    role: string;
    status: string;
    created_at: Date | string;
    last_activity: Date | string | null;
  }>(
    t,
    `select p.full_name, m.role::text as role, m.status, m.created_at,
            (select max(a.created_at) from ${S}.activity_log a
              where a.actor_type = 'user' and a.actor_id = p.id) as last_activity
       from ${S}.memberships m
       join ${S}.profiles p on p.id = m.profile_id
      order by p.full_name`,
  );
  for (const m of members) {
    if (m.status !== "active" || m.role === "owner") continue;
    const idle = daysSince(m.last_activity ?? m.created_at, now);
    if (idle > LIMITS.memberIdleDays) {
      findings.push({
        kind: "member_idle",
        severity: "low",
        subject: m.full_name,
        detail: `Sem gravar nada no Hub há ${idle} dias.`,
        action: "Se a pessoa saiu da equipe, suspenda o acesso dela.",
        href: null,
      });
    }
  }

  // Contatos do portal com acesso e sem usar.
  const contacts = await many<{
    name: string;
    client: string;
    slug: string;
    since: Date | string;
  }>(
    t,
    `select c.name, cl.name as client, cl.slug,
            coalesce((select max(s.last_seen_at) from ${S}.client_sessions s
                       where s.contact_id = c.id), c.invited_at, c.created_at) as since
       from ${S}.client_contacts c
       join ${S}.clients cl on cl.id = c.client_id
      where c.access_status in ('invited', 'active') and c.anonymized_at is null
      order by cl.name, c.name`,
  );
  for (const c of contacts) {
    const idle = daysSince(c.since, now);
    if (idle > LIMITS.contactIdleDays) {
      findings.push({
        kind: "contact_idle",
        severity: "low",
        subject: `${c.name} (${c.client})`,
        detail: `Com acesso ao portal e sem usar há ${idle} dias.`,
        action:
          "Se o contato não acompanha mais o projeto, revogue o acesso (Contatos e portal).",
        href: `/clientes/${c.slug}/portal`,
      });
    }
  }

  // Aprovações paradas.
  const approvals = await many<{
    title: string;
    created_at: Date | string;
    code: string | null;
  }>(
    t,
    `select a.title, a.created_at, p.code
       from ${S}.approvals a
       left join ${S}.projects p on p.id = a.project_id
      where a.status = 'pending'
      order by a.created_at`,
  );
  for (const a of approvals) {
    const days = businessDaysBetween(new Date(a.created_at), now);
    if (days > LIMITS.approvalOldBusinessDays) {
      findings.push({
        kind: "approval_old",
        severity: "medium",
        subject: a.code ? `${a.code}: ${a.title}` : a.title,
        detail: `Pedido parado há ${days} dias úteis.`,
        action: "Decida, peça ajuste ou recuse no Hoje.",
        href: "/aprovacoes",
      });
    }
  }

  // Recusas de acesso da última semana, por agente.
  const denials = await many<{ agent: string | null; n: number }>(
    t,
    `select ag.name as agent, count(*)::int as n
       from ${S}.agent_denials d
       left join ${S}.agents ag on ag.id = d.agent_id
      where d.created_at > now() - make_interval(days => $1)
      group by ag.name
      order by n desc`,
    [LIMITS.recentDays],
  );
  for (const d of denials) {
    findings.push({
      kind: "denials",
      severity: "low",
      subject: d.agent ?? "Chave sem agente",
      detail: `${d.n} ${d.n === 1 ? "recusa" : "recusas"} de acesso nos últimos ${LIMITS.recentDays} dias.`,
      action:
        "Veja o motivo em Recusas de acesso: se o agente precisa, ajuste a chave; se não, confira quem está usando.",
      href: "/agentes",
    });
  }

  // Gasto de IA no mês.
  const agents = await many<{ name: string; budget: number; spent: number }>(
    t,
    `select name, budget_usd_month::float8 as budget, spent_usd_month::float8 as spent
       from ${S}.agents where status <> 'revoked' order by name`,
  );
  for (const a of agents) {
    if (a.budget > 0 && a.spent >= a.budget * LIMITS.aiBudgetWarn) {
      findings.push({
        kind: "ai_budget",
        severity: a.spent >= a.budget ? "high" : "medium",
        subject: a.name,
        detail: `Gastou ${money(a.spent)} de ${money(a.budget)} de IA no mês.`,
        action:
          "Confira se o uso faz sentido; ajuste o orçamento do agente se for o caso.",
        href: "/agentes",
      });
    }
  }
  const spent = agents.reduce((sum, a) => sum + Number(a.spent), 0);
  const ceiling = Number(process.env.LLM_MONTHLY_BUDGET_USD);
  if (
    Number.isFinite(ceiling) &&
    ceiling > 0 &&
    spent >= ceiling * LIMITS.aiBudgetWarn
  ) {
    findings.push({
      kind: "ai_budget",
      severity: spent >= ceiling ? "high" : "medium",
      subject: "Workspace",
      detail: `A IA gastou ${money(spent)} de ${money(ceiling)} (teto do mês).`,
      action:
        "Confira os agentes que mais gastam; o teto é o LLM_MONTHLY_BUDGET_USD.",
      href: "/agentes",
    });
  }

  // Chaves dos provedores de IA.
  const credentials = await many<{
    provider: string;
    label: string;
    key_last4: string;
    since: Date | string;
  }>(
    t,
    `select provider::text as provider, label, key_last4,
            coalesce(rotated_at, created_at) as since
       from ${S}.llm_credentials where revoked_at is null order by provider, label`,
  );
  for (const c of credentials) {
    const age = daysSince(c.since, now);
    if (age > LIMITS.aiCredentialRotationDays) {
      findings.push({
        kind: "ai_credential_old",
        severity: "low",
        subject: `${c.label} (${c.provider}, final ${c.key_last4})`,
        detail: `Chave de IA sem troca há ${age} dias (a política é trocar a cada ${LIMITS.aiCredentialRotationDays}).`,
        action:
          "Gere uma chave nova no site do provedor, troque em Chaves de IA e revogue a antiga lá.",
        href: "/agentes",
      });
    }
  }

  // Webhooks com entrega falhando.
  const webhooks = await many<{ url: string; failed: number }>(
    t,
    `select w.url, count(d.id)::int as failed
       from ${S}.webhooks w
       join ${S}.webhook_deliveries d on d.webhook_id = w.id
      where w.active and d.delivered_at is null and d.last_error is not null
        and d.created_at > now() - make_interval(days => $1)
      group by w.url
      order by failed desc`,
    [LIMITS.recentDays],
  );
  for (const w of webhooks) {
    let host = w.url;
    try {
      host = new URL(w.url).host;
    } catch {
      // Endereço guardado sempre é válido; o texto cru serve de reserva.
    }
    findings.push({
      kind: "webhook_failing",
      severity: "medium",
      subject: host,
      detail: `${w.failed} ${w.failed === 1 ? "aviso" : "avisos"} sem entrega nos últimos ${LIMITS.recentDays} dias.`,
      action:
        "Veja o erro em Webhooks de saída e confira o receptor (Hermes, n8n).",
      href: "/agentes",
    });
  }

  const pendingCount = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.approvals where status = 'pending'`,
  );
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return {
    generated_at: iso(now),
    counts: {
      active_keys: keys.length,
      team_members: members.filter((m) => m.status === "active").length,
      portal_contacts_with_access: contacts.length,
      pending_approvals: pendingCount?.n ?? 0,
      denials_last_7_days: denials.reduce((sum, d) => sum + d.n, 0),
      ai_spent_usd_month: Math.round(spent * 100) / 100,
    },
    findings,
  };
}

/**
 * O relatório da semana (job `access-audit`): um aviso na caixa de entrada do dono, com
 * os pontos para olhar e o link para a auditoria. Sai mesmo sem nada a apontar: assim o
 * dono sabe que a conferência rodou.
 */
export async function weeklyAuditNotice(
  t: TxCtx,
  now: Date = new Date(),
): Promise<{ findings: number; high: number }> {
  const audit = await accessAudit(t, now);
  const high = audit.findings.filter((f) => f.severity === "high").length;
  const summary = audit.findings
    .slice(0, 3)
    .map((f) => `${f.subject}: ${f.detail}`)
    .join(" · ");
  await notifyOwners(
    t,
    "audit.weekly",
    { type: "workspace", id: t.actor.workspaceId },
    {
      findings: audit.findings.length,
      high,
      summary: summary || null,
    },
  );
  return { findings: audit.findings.length, high };
}
