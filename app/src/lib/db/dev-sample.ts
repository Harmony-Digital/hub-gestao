import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import { encryptSecret } from "@/lib/crypto";
import type { AgentActor, UserActor } from "@/lib/db/actor";
import { encryptionKeyOrNull } from "@/lib/env";
import { requestApproval } from "@/modules/approvals/service";
import { createComment } from "@/modules/comments/service";
import { inTx } from "@/modules/context";
import {
  blockTask,
  completeTask,
  createTask,
  startTask,
  updateTask,
} from "@/modules/tasks/service";
import type { CreateTaskInput } from "@/modules/tasks/schemas";
import { createWorkstream } from "@/modules/workstreams/service";
import { SCHEMA as S } from "./local";
import type { Db } from "./types";

/**
 * Dados de exemplo para ver as telas cheias no computador de quem programa. Só no banco
 * local (PGlite), só com HUB_DEV_SAMPLE=on no .env.local e nunca em produção: este
 * módulo só é carregado pelo ramo de desenvolvimento de src/lib/db/index.ts.
 * Projeto EXE, cliente e nomes marcados como exemplo.
 */
export async function ensureDevSample(db: Db, raw: PGlite): Promise<void> {
  const exists = await raw.query(
    `select 1 from ${S}.projects where code = 'EXE'`,
  );
  if (exists.rows.length > 0) {
    // Bancos locais criados antes dos pedidos de exemplo ganham só os pedidos.
    await ensureSampleApprovals(db, raw);
    await ensureSampleInternalAgents(raw);
    return;
  }

  const base = (
    await raw.query<{ ws: string; owner: string }>(
      `select w.id as ws, m.profile_id as owner
         from ${S}.workspaces w
         join ${S}.memberships m on m.workspace_id = w.id and m.role = 'owner'
        where w.slug = 'harmony'`,
    )
  ).rows[0];
  if (!base) return;

  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await raw.query<T>(sql, params)).rows[0];

  const client = await one<{ id: string }>(
    `insert into ${S}.clients (workspace_id, slug, name, notes_internal)
     values ($1, 'clinica-exemplo', 'Clínica Exemplo', 'Dados de exemplo, só no banco local.')
     on conflict (workspace_id, slug) do update set name = excluded.name
     returning id`,
    [base.ws],
  );
  const project = await one<{ id: string }>(
    `insert into ${S}.projects
       (workspace_id, client_id, code, name, status, phase, objective_internal, objective_client,
        owner_profile_id, start_date, target_date)
     values ($1, $2, 'EXE', 'Atendimento com IA (exemplo)', 'active', 'validar',
             'Agente de atendimento e agendamento no WhatsApp, com painel para a recepção.',
             'Atendimento mais rápido no WhatsApp, com agendamento automático.',
             $3, current_date - 40, current_date + 60)
     returning id`,
    [base.ws, client.id, base.owner],
  );
  await raw.query(
    `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
     select $1, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
            (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
       from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
      where w.id = $1`,
    [base.ws, project.id],
  );
  await raw.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role)
     values ($1, $2, $3, 'lead') on conflict do nothing`,
    [base.ws, project.id, base.owner],
  );
  const agentRow = async (name: string, kind: string, roles: string[]) =>
    one<{ id: string }>(
      `insert into ${S}.agents (workspace_id, name, kind, roles, mission)
       values ($1, $2, $3::${S}.agent_kind, $4::text[], 'Agente de exemplo, só no banco local.')
       on conflict (workspace_id, name) do update set name = excluded.name
       returning id`,
      [base.ws, name, kind, roles],
    );
  const kratosRow = await agentRow("Kratos (exemplo)", "hermes", [
    "GP-01",
    "VP-05",
  ]);
  const codexRow = await agentRow("Codex (exemplo)", "session", []);

  const owner: UserActor = {
    type: "user",
    id: base.owner,
    scope: "internal",
    role: "owner",
    workspaceId: base.ws,
    name: "Fábio Almeida",
  };
  const agent = (id: string, name: string): AgentActor => ({
    type: "agent",
    id,
    scope: "internal",
    keyId: "00000000-0000-4000-8000-000000000000",
    kind: "session",
    scopes: ["workspace:*"],
    projectIds: null,
    roles: [],
    workspaceId: base.ws,
    name,
  });
  const kratos = agent(kratosRow.id, "Kratos (exemplo)");
  const codex = agent(codexRow.id, "Codex (exemplo)");
  const ctx = (actor: UserActor | AgentActor) => ({
    db,
    actor,
    source: actor.type === "agent" ? ("mcp" as const) : ("ui" as const),
    requestId: "dados-de-exemplo",
  });

  // Marcos nascem em nome do dono: a trava do banco (0006) só deixa uma pessoa aceitar.
  for (const [code, title, status, due, order] of [
    ["M1", "Diagnóstico e desenho do atendimento", "accepted", -20, 1],
    ["M2", "Agente de atendimento no WhatsApp", "in_progress", 14, 2],
    ["M3", "Painel da recepção", "planned", 35, 3],
    ["M4", "Lançamento e treinamento da equipe", "planned", 56, 4],
  ] as const) {
    await inTx(ctx(owner), (t) =>
      t.tx.query(
        `insert into ${S}.milestones
           (workspace_id, project_id, code, title, title_client, due_date, sort_order, status,
            acceptance_criteria, accepted_at, accepted_by_profile_id)
         values ($1, $2, $3, $4, $4, current_date + $5::int, $6, $7::${S}.milestone_status,
                 $8::jsonb, $9, $10)`,
        [
          base.ws,
          project.id,
          code,
          title,
          due,
          order,
          status,
          JSON.stringify(
            code === "M2"
              ? [
                  { text: "Responde dúvidas frequentes", done: true },
                  { text: "Agenda consultas sem humano", done: false },
                  {
                    text: "Passa para a recepção quando não sabe",
                    done: false,
                  },
                ]
              : [],
          ),
          status === "accepted"
            ? new Date(Date.now() - 18 * 86_400_000).toISOString()
            : null,
          status === "accepted" ? base.owner : null,
        ],
      ),
    );
  }

  const fronts: Record<string, string> = {};
  for (const [key, dept, title, visible] of [
    ["fluxo", "agentes-e-automacoes", "Fluxo de conversa do agente", true],
    ["agenda", "sistemas", "Integração com a agenda da clínica", true],
    ["telas", "design", "Telas do painel da recepção", false],
    ["textos", "marketing-e-vendas", "Mensagens e respostas padrão", false],
  ] as const) {
    const w = await inTx(ctx(owner), (t) =>
      createWorkstream(t, {
        project: "EXE",
        milestone: "M2",
        department: dept,
        title,
      }),
    );
    fronts[key] = w.id;
    if (visible) {
      await raw.query(
        `update ${S}.workstreams set visibility = 'client', title_client = title where id = $1`,
        [w.id],
      );
    }
  }

  const task = async (
    who: AgentActor | UserActor,
    title: string,
    front: string,
    extra: Partial<Omit<CreateTaskInput, "project" | "title">> = {},
  ) =>
    inTx(ctx(who), (t) =>
      createTask(t, {
        project: "EXE",
        title,
        workstream_id: fronts[front],
        ...extra,
      }),
    );

  const t1 = await task(kratos, "Mapear as perguntas mais frequentes", "fluxo");
  await inTx(ctx(kratos), (t) => startTask(t, t1.code));
  await inTx(ctx(kratos), (t) =>
    completeTask(t, t1.code, {
      evidence: "Planilha com as 40 perguntas mais comuns no repositório.",
    }),
  );
  const t2 = await task(codex, "Escrever o fluxo de agendamento", "fluxo", {
    priority: "high",
    due_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  });
  await inTx(ctx(codex), (t) => startTask(t, t2.code));
  const t3 = await task(
    codex,
    "Integrar consulta de horários livres",
    "agenda",
    {
      priority: "urgent",
    },
  );
  await inTx(ctx(codex), (t) =>
    blockTask(t, t3.code, {
      reason: "Aguarda a credencial da API da agenda. Depende da clínica.",
    }),
  );
  const t4 = await task(kratos, "Revisar o tom das mensagens", "textos");
  await inTx(ctx(kratos), (t) => startTask(t, t4.code));
  await inTx(ctx(kratos), (t) =>
    updateTask(t, t4.code, { status: "Em revisão" }),
  );
  await task(owner, "Aprovar o roteiro de passagem para a recepção", "fluxo", {
    priority: "high",
    assignee: { type: "user", id: base.owner },
  });
  await task(kratos, "Desenhar a tela de fila da recepção", "telas");
  await task(kratos, "Testar com 20 conversas reais anonimizadas", "fluxo", {
    priority: "low",
  });
  await inTx(ctx(kratos), (t) =>
    createComment(
      t,
      { task: t2.code },
      {
        body_md:
          "O fluxo de agendamento já cobre consulta e retorno. Falta o caso de reagendar.",
      },
    ),
  );
  await ensureSampleApprovals(db, raw);
  await ensureSampleInternalAgents(raw);
}

/**
 * Pedidos de decisão de exemplo, feitos pelo "Kratos (exemplo)" como Gestor de Projetos,
 * para ver a tela Hoje e as Aprovações com conteúdo. Só uma vez por banco local.
 */
async function ensureSampleApprovals(db: Db, raw: PGlite): Promise<void> {
  const already = await raw.query(
    `select 1 from ${S}.approvals a join ${S}.projects p on p.id = a.project_id
      where p.code = 'EXE' limit 1`,
  );
  if (already.rows.length > 0) return;
  const row = (
    await raw.query<{ ws: string; agent: string; front: string | null }>(
      `select w.id as ws, ag.id as agent,
              (select ws.id from ${S}.workstreams ws join ${S}.projects p on p.id = ws.project_id
                where p.code = 'EXE' and ws.visibility = 'internal'
                  and ws.title = 'Mensagens e respostas padrão' limit 1) as front
         from ${S}.workspaces w
         join ${S}.agents ag on ag.workspace_id = w.id and ag.name = 'Kratos (exemplo)'
        where w.slug = 'harmony'`,
    )
  ).rows[0];
  if (!row) return;
  const kratos: AgentActor = {
    type: "agent",
    id: row.agent,
    scope: "internal",
    keyId: "00000000-0000-4000-8000-000000000000",
    kind: "hermes",
    scopes: ["workspace:*"],
    projectIds: null,
    roles: ["GP-01", "VP-05"],
    workspaceId: row.ws,
    name: "Kratos (exemplo)",
    actingRole: "GP-01",
  };
  const ctx = {
    db,
    actor: kratos,
    source: "mcp" as const,
    requestId: "dados-de-exemplo",
  };
  if (row.front) {
    await inTx(ctx, (t) =>
      requestApproval(t, {
        type: "client_visibility",
        project: "EXE",
        workstream_id: row.front!,
        title: "Mostrar ao cliente a frente de mensagens padrão",
        summary:
          "A clínica pediu para acompanhar os textos que o agente vai usar. A frente está pronta para aparecer no portal, com título escrito para ela.",
        payload: {
          title_client: "Mensagens do atendimento",
          description_client:
            "Os textos que o atendente virtual usa para responder e agendar.",
        },
      }),
    );
  }
  await inTx(ctx, (t) =>
    requestApproval(t, {
      type: "replan",
      project: "EXE",
      title: "Mover o lançamento (M4) em uma semana",
      summary:
        "A integração com a agenda está bloqueada à espera da credencial da clínica. Sem ela, o treinamento da equipe não começa na data prevista.",
    }),
  );
  await inTx(ctx, (t) =>
    requestApproval(t, {
      type: "milestone_proposal",
      project: "EXE",
      title: "Criar o marco M5: relatórios mensais para a clínica",
      payload: {
        title: "Relatórios mensais de atendimento",
        acceptance_criteria: [
          "Volume de conversas por semana",
          "Agendamentos feitos pelo agente",
        ],
      },
    }),
  );
}

/**
 * Agentes internos de exemplo, para ver no computador o Concierge (papel CO-10, janela
 * ⌘K) e o Planejador (PL-11, tela Importar o plan.md). Com o modelo simulado ligado
 * (HUB_DEV_FAKE_LLM=on) e a cifra local, eles já vêm com modelo, chave de mentira, preço
 * e teto; sem isso, ficam sem IA (as telas mostram o motivo).
 */
async function ensureSampleInternalAgents(raw: PGlite): Promise<void> {
  const ws = (
    await raw.query<{ id: string }>(
      `select id from ${S}.workspaces where slug = 'harmony'`,
    )
  ).rows[0]?.id;
  if (!ws) return;
  const samples = [
    {
      name: "Concierge (exemplo)",
      role: "CO-10",
      mission:
        "Concierge de exemplo, só no banco local: entende pedidos da barra ⌘K.",
    },
    {
      name: "Planejador (exemplo)",
      role: "PL-11",
      mission:
        "Planejador de exemplo, só no banco local: propõe planos a partir de documentos.",
    },
  ];
  const key = encryptionKeyOrNull();
  const simulated = process.env.HUB_DEV_FAKE_LLM === "on" && key !== null;
  let credentialId: string | null = null;
  for (const sample of samples) {
    const agent = (
      await raw.query<{ id: string; configured: boolean }>(
        `insert into ${S}.agents (workspace_id, name, kind, roles, mission)
         values ($1, $2, 'internal', array[$3], $4)
         on conflict (workspace_id, name) do update set name = excluded.name
         returning id, llm_model is not null as configured`,
        [ws, sample.name, sample.role, sample.mission],
      )
    ).rows[0];
    if (!agent || agent.configured || !simulated) continue;
    if (!credentialId) {
      // Chave de mentira: o modelo simulado não chama provedor nenhum.
      const fake = "sk-modelo-simulado-somente-local-0000";
      const label = "Modelo simulado (só neste computador)";
      credentialId =
        (
          await raw.query<{ id: string }>(
            `select id from ${S}.llm_credentials
              where workspace_id = $1 and label = $2 and revoked_at is null`,
            [ws, label],
          )
        ).rows[0]?.id ??
        (
          await raw.query<{ id: string }>(
            `insert into ${S}.llm_credentials (workspace_id, provider, label, key_ciphertext, key_last4)
             values ($1, 'openai', $2, $3, $4)
             returning id`,
            [ws, label, encryptSecret(fake, key), fake.slice(-4)],
          )
        ).rows[0].id;
    }
    await raw.query(
      `update ${S}.agents
          set llm_provider = 'openai', llm_model = 'modelo-simulado',
              llm_credential_id = $2, budget_usd_month = 1,
              config = config || '{"llm_price_in": 1, "llm_price_out": 2}'::jsonb
        where id = $1`,
      [agent.id, credentialId],
    );
  }
}
