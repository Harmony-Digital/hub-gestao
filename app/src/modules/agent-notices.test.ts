import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { toHubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { inbox } from "@/modules/notifications";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { NOTICE_DAILY_LIMIT, postAgentNotice } from "./agent-notices";

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;
let leitor: AgentActor;
let memberId: string;
const asKratos = () => ctxFor(h, kratos, "mcp");
const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 0,
    (e: unknown) => toHubError(e).status,
  );

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
  leitor = await agentActor(h, h.keys.leitor);
  memberId = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('lia.aviso@exemplo.com', 'Lia') returning id`,
    )
  ).rows[0].id;
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, memberId],
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("aviso de agente na caixa de entrada (PRD §5.3)", () => {
  it("o digest chega aos donos, com o agente, o texto e o link do projeto", async () => {
    const result = await inTx(asKratos(), (t) =>
      postAgentNotice(t, {
        title: "Digest de hoje: 3 tarefas vencem e 1 bloqueio espera você",
        body: "VIT: HUB-12 vence amanhã.",
        project: "VIT",
        dedupe_key: "digest-2026-10-12",
      }),
    );
    expect(result).toEqual({ sent: 1, deduplicated: false });
    const {
      items: [item],
    } = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      inbox(t, { limit: 1 }),
    );
    expect(item).toMatchObject({
      type: "agent.notice",
      group: "agents",
      text: "Kratos: Digest de hoje: 3 tarefas vencem e 1 bloqueio espera você",
      detail: "VIT: HUB-12 vence amanhã.",
      href: "/projetos/VIT",
    });
    // A mesma chave em 24 horas não repete.
    expect(
      await inTx(asKratos(), (t) =>
        postAgentNotice(t, {
          title: "Digest de novo",
          dedupe_key: "digest-2026-10-12",
        }),
      ),
    ).toEqual({ sent: 0, deduplicated: true });
    const logged = await h.raw.query(
      `select 1 from ${S}.activity_log where action = 'agent.notice_sent'`,
    );
    expect(logged.rows).toHaveLength(1);
  });

  it("para uma pessoa: só da equipe ativa e que enxergue o projeto citado", async () => {
    expect(
      await status(
        inTx(asKratos(), (t) =>
          postAgentNotice(t, {
            to: memberId,
            title: "Lembrete",
            project: "VIT",
          }),
        ),
      ),
    ).toBe(422);
    await h.raw.query(
      `insert into ${S}.project_members (workspace_id, project_id, profile_id, role) values ($1, $2, $3, 'member')`,
      [h.ws, h.vit, memberId],
    );
    expect(
      await inTx(asKratos(), (t) =>
        postAgentNotice(t, {
          to: memberId,
          title: "Lembrete: HUB-12 vence amanhã",
          project: "VIT",
          link: "/minhas-tarefas",
        }),
      ),
    ).toEqual({ sent: 1, deduplicated: false });
    const lia = {
      type: "user" as const,
      id: memberId,
      scope: "internal" as const,
      role: "member" as const,
      workspaceId: h.ws,
      name: "Lia",
    };
    const {
      items: [item],
    } = await inTx(ctxFor(h, lia, "ui"), (t) => inbox(t, { limit: 1 }));
    expect(item).toMatchObject({
      text: "Kratos: Lembrete: HUB-12 vence amanhã",
      href: "/minhas-tarefas",
    });
    expect(
      await status(
        inTx(asKratos(), (t) =>
          postAgentNotice(t, {
            to: "4dc6721e-2ac8-463d-84cb-3b25ab170bbd",
            title: "Ninguém",
          }),
        ),
      ),
    ).toBe(404);
  });

  it("recusa sem o escopo, de pessoa, link de fora e segredo; limita por dia", async () => {
    expect(
      await status(
        inTx(ctxFor(h, leitor, "mcp"), (t) =>
          postAgentNotice(t, { title: "Sem escopo" }),
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
          postAgentNotice(t, { title: "Pessoa" }),
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        inTx(asKratos(), (t) =>
          postAgentNotice(t, { title: "Fora", link: "https://exemplo.com" }),
        ),
      ),
    ).toBe(400);
    expect(
      await status(
        inTx(asKratos(), (t) =>
          postAgentNotice(t, { title: "Linha 1\nLinha 2" }),
        ),
      ),
    ).toBe(400);
    // O limite conta os avisos do agente nas últimas 24 horas.
    await h.raw.query(
      `insert into ${S}.activity_log (workspace_id, actor_type, actor_id, source, action, entity_type, entity_id, after)
       select $1, 'agent', $2, 'mcp', 'agent.notice_sent', 'agent', $2, '{}'::jsonb
         from generate_series(1, $3)`,
      [h.ws, kratos.id, NOTICE_DAILY_LIMIT],
    );
    expect(
      await status(
        inTx(asKratos(), (t) => postAgentNotice(t, { title: "Demais" })),
      ),
    ).toBe(429);
  });
});
