import { badRequest } from "@/lib/errors";
import { iso } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Caixa de entrada do Hub: avisos para pessoas (agentes leem pelo MCP). Cada aviso
 * pertence a um grupo que a pessoa pode desligar nas preferências; quem fez a ação não
 * recebe aviso dela.
 */

export const NOTIFICATION_GROUPS = [
  "mention",
  "assignment",
  "approval",
  "blocked",
  "agents",
  "client",
  "system",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const GROUP_LABEL: Record<NotificationGroup, string> = {
  mention: "Menções",
  assignment: "Tarefas passadas para você",
  approval: "Aprovações",
  blocked: "Bloqueios nos seus projetos",
  agents: "Agentes: avisos, orçamento de IA e recusas de acesso",
  client: "Mensagens dos clientes no portal",
  system: "Operação do Hub: jobs, publicação e backups",
};

export function groupOf(type: string): NotificationGroup | null {
  if (type === "mention") return "mention";
  if (type === "task.assigned" || type === "task.reopened") return "assignment";
  if (type === "task.blocked") return "blocked";
  if (type.startsWith("approval.") || type.startsWith("report.")) {
    return "approval";
  }
  if (type.startsWith("agent.")) return "agents";
  if (type.startsWith("client.")) return "client";
  if (type.startsWith("system.") || type.startsWith("audit.")) return "system";
  return null;
}

/** A pessoa desligou o grupo deste aviso na caixa de entrada? (Sem registro: ligado.) */
const PREF_OFF = (profileSql: string, groupParam: string) =>
  `exists (select 1 from ${S}.notification_prefs np
            where np.profile_id = ${profileSql} and np.type = ${groupParam}
              and np.channel = 'inbox' and not np.enabled)`;

function actorProfile(t: TxCtx): string | null {
  return t.actor.type === "user" ? t.actor.id : null;
}

/** Avisa os donos do workspace na caixa de entrada do Hub. */
export async function notifyOwners(
  t: TxCtx,
  type: string,
  entity: { type: string; id: string },
  payload: Record<string, unknown>,
): Promise<void> {
  await t.tx.query(
    `insert into ${S}.notifications (workspace_id, profile_id, type, entity_type, entity_id, payload)
     select m.workspace_id, m.profile_id, $1, $2, $3, $4::jsonb
       from ${S}.memberships m
      where m.role = 'owner' and m.status = 'active'
        and m.profile_id is distinct from $5
        and not ${PREF_OFF("m.profile_id", "$6")}`,
    [
      type,
      entity.type,
      entity.id,
      json(payload),
      actorProfile(t),
      groupOf(type) ?? type,
    ],
  );
}

/** Avisa uma pessoa específica (nunca quem fez a ação). */
export async function notifyProfile(
  t: TxCtx,
  profileId: string,
  type: string,
  entity: { type: string; id: string },
  payload: Record<string, unknown>,
): Promise<void> {
  if (profileId === actorProfile(t)) return;
  await t.tx.query(
    `insert into ${S}.notifications (workspace_id, profile_id, type, entity_type, entity_id, payload)
     select $1, $2, $3, $4, $5, $6::jsonb
      where not ${PREF_OFF("$2::uuid", "$7")}`,
    [
      t.actor.workspaceId,
      profileId,
      type,
      entity.type,
      entity.id,
      json(payload),
      groupOf(type) ?? type,
    ],
  );
}

// Caixa de entrada --------------------------------------------------------------------

export type InboxItem = {
  id: string;
  type: string;
  group: NotificationGroup | null;
  read: boolean;
  created_at: string;
  /** Frase pronta em PT-BR: "Fábio Almeida mencionou você em HUB-9". */
  text: string;
  /** Complemento (trecho do comentário, motivo do bloqueio, título). */
  detail: string | null;
  /** Para onde o aviso leva, se houver. */
  href: string | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const DECISION: Record<string, string> = {
  approved: "aprovado",
  rejected: "recusado",
  adjust_requested: "devolvido para ajuste",
};

/** Texto e destino de cada aviso. Puro: vale na tela e nos testes. */
export function describeNotification(
  type: string,
  payload: Record<string, unknown>,
): Pick<InboxItem, "text" | "detail" | "href"> {
  const project = str(payload.project_code);
  const task = str(payload.task_code);
  const taskHref =
    project && task ? `/projetos/${project}?tarefa=${task}` : null;
  const who = str(payload.by) ?? str(payload.author) ?? "Alguém";
  switch (type) {
    case "mention":
      return {
        text: `${who} mencionou você em ${task ?? project ?? "um comentário"}`,
        detail: str(payload.excerpt),
        href: taskHref ?? (project ? `/projetos/${project}` : null),
      };
    case "task.assigned":
      return {
        text: `${who} passou ${task ?? "uma tarefa"} para você`,
        detail: str(payload.title),
        href: taskHref,
      };
    case "task.reopened":
      return {
        text: `${task ?? "Uma tarefa"} foi reaberta: concluída sem evidência${project ? ` em ${project}` : ""}`,
        detail: str(payload.title),
        href: taskHref,
      };
    case "task.blocked":
      if (payload.waiting_on_you === true) {
        return {
          text: `${task ?? "Uma tarefa"} está esperando você${project ? ` em ${project}` : ""}`,
          detail: str(payload.reason) ?? str(payload.title),
          href: taskHref,
        };
      }
      return {
        text: `${who} bloqueou ${task ?? "uma tarefa"}${project ? ` em ${project}` : ""}`,
        detail: str(payload.reason) ?? str(payload.title),
        href: taskHref,
      };
    case "approval.requested":
      return {
        text: `Pedido esperando a sua decisão${project ? ` em ${project}` : ""}`,
        detail: str(payload.title),
        href: "/aprovacoes",
      };
    case "approval.decided":
      return {
        text: `Seu pedido foi ${DECISION[str(payload.decision) ?? ""] ?? "decidido"}`,
        detail: str(payload.title),
        href: "/aprovacoes?status=todas",
      };
    case "agent.notice": {
      const link = str(payload.link);
      return {
        text: `${str(payload.agent_name) ?? "Um agente"}: ${str(payload.title) ?? "aviso"}`,
        detail: str(payload.body),
        href:
          link && /^\/(?!\/)/.test(link)
            ? link
            : project
              ? `/projetos/${project}`
              : null,
      };
    }
    case "agent.budget_exceeded":
      return {
        text:
          payload.scope === "workspace"
            ? "O teto de IA do workspace no mês acabou: os agentes pararam de usar IA"
            : `${str(payload.agent_name) ?? "Um agente"} parou de usar IA: o orçamento do mês acabou`,
        detail: str(payload.detail),
        href: "/agentes",
      };
    case "agent.denials_recurring":
      return {
        text: `${str(payload.agent_name) ?? "Um agente"} teve ${String(payload.count ?? "várias")} recusas de acesso na última hora`,
        detail: str(payload.detail),
        href: "/agentes",
      };
    case "system.job_failed":
      return {
        text: `O job "${str(payload.label) ?? "do relógio"}" falhou depois de ${String(payload.attempts ?? "várias")} tentativas`,
        detail: str(payload.detail),
        href: "/agentes",
      };
    case "audit.weekly":
      return {
        text:
          Number(payload.findings ?? 0) === 0
            ? "Auditoria semanal: nada para olhar nas chaves, acessos e custos"
            : `Auditoria semanal: ${String(payload.findings)} ${Number(payload.findings) === 1 ? "ponto" : "pontos"} para olhar${Number(payload.high ?? 0) > 0 ? ` (${String(payload.high)} importantes)` : ""}`,
        detail: str(payload.summary),
        href: "/agentes/auditoria",
      };
    case "system.deploy_failed":
      return {
        text: "A publicação de uma versão nova falhou: o Hub continua na versão anterior",
        detail: str(payload.detail),
        href: null,
      };
    case "system.backup_stale":
      return {
        text: `${str(payload.label) ?? "Um backup"} não dá sinal há ${String(payload.hours ?? "mais de 30")} horas`,
        detail: str(payload.detail),
        href: null,
      };
    case "client.receipt":
      return {
        text: `${who} confirmou o recebimento de ${str(payload.milestone) ?? "uma entrega"}${project ? ` em ${project}` : ""}`,
        detail: str(payload.title),
        href: project ? `/projetos/${project}` : null,
      };
    case "client.comment":
      return {
        text: `${who} escreveu no portal${project ? `, em ${project}` : ""}`,
        detail: str(payload.excerpt),
        href: project ? `/projetos/${project}#canal-do-cliente` : null,
      };
    case "approval.aging":
      return {
        text: `Pedido parado há ${String(payload.business_days ?? "vários")} dias úteis`,
        detail: str(payload.title),
        href: "/aprovacoes",
      };
    default:
      return { text: str(payload.title) ?? type, detail: null, href: null };
  }
}

type InboxRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read_at: Date | string | null;
  created_at: Date | string;
};

export async function inbox(
  t: TxCtx,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<{ items: InboxItem[]; unread: number }> {
  const me = actorProfile(t);
  if (!me) return { items: [], unread: 0 };
  const rows = await many<InboxRow>(
    t,
    `select id, type, payload, read_at, created_at from ${S}.notifications
      where profile_id = $1 ${options.unreadOnly ? "and read_at is null" : ""}
      order by created_at desc, id desc
      limit $2`,
    [me, Math.min(options.limit ?? 50, 200)],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      group: groupOf(r.type),
      read: r.read_at !== null,
      created_at: iso(r.created_at),
      ...describeNotification(r.type, r.payload ?? {}),
    })),
    unread: await unreadCount(t),
  };
}

export async function unreadCount(t: TxCtx): Promise<number> {
  const me = actorProfile(t);
  if (!me) return 0;
  const row = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.notifications where profile_id = $1 and read_at is null`,
    [me],
  );
  return row?.n ?? 0;
}

/** Marca como lidos os avisos indicados (ou todos), só os da própria pessoa. */
export async function markRead(
  t: TxCtx,
  ids: string[] | "all",
): Promise<number> {
  const me = actorProfile(t);
  if (!me) throw badRequest("Só pessoas têm caixa de entrada.");
  const result = await t.tx.query(
    ids === "all"
      ? `update ${S}.notifications set read_at = now()
          where profile_id = $1 and read_at is null returning id`
      : `update ${S}.notifications set read_at = now()
          where profile_id = $1 and read_at is null and id = any($2::uuid[]) returning id`,
    ids === "all" ? [me] : [me, ids],
  );
  return result.rows.length;
}

export async function notificationPrefs(
  t: TxCtx,
): Promise<Record<NotificationGroup, boolean>> {
  const me = actorProfile(t);
  const prefs = Object.fromEntries(
    NOTIFICATION_GROUPS.map((g) => [g, true]),
  ) as Record<NotificationGroup, boolean>;
  if (!me) return prefs;
  const rows = await many<{ type: string; enabled: boolean }>(
    t,
    `select type, enabled from ${S}.notification_prefs where profile_id = $1 and channel = 'inbox'`,
    [me],
  );
  for (const r of rows) {
    if ((NOTIFICATION_GROUPS as readonly string[]).includes(r.type)) {
      prefs[r.type as NotificationGroup] = r.enabled;
    }
  }
  return prefs;
}

export async function setNotificationPref(
  t: TxCtx,
  group: NotificationGroup,
  enabled: boolean,
): Promise<void> {
  const me = actorProfile(t);
  if (!me) throw badRequest("Só pessoas têm caixa de entrada.");
  await t.tx.query(
    `insert into ${S}.notification_prefs (workspace_id, profile_id, type, channel, enabled)
     values ($1, $2, $3, 'inbox', $4)
     on conflict (profile_id, type, channel) do update set enabled = excluded.enabled`,
    [t.actor.workspaceId, me, group, enabled],
  );
}
