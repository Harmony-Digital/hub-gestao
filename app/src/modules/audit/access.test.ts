import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { createAgentKey } from "@/modules/agents/service";
import { requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import { accessAudit, weeklyAuditNotice } from "./access";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

beforeAll(async () => {
  h = await openTestHub();
  const kratos = await agentActor(h, h.keys.kratos);
  // Chave do Kratos: criada há 100 dias, usada ontem, vence em 5 dias.
  await h.raw.query(
    `update ${S}.agent_api_keys
        set created_at = now() - interval '100 days', last_used_at = now() - interval '1 day',
            expires_at = now() + interval '5 days'
      where id = $1`,
    [kratos.keyId],
  );
  // Chave do leitor: criada há 20 dias e nunca usada.
  const leitor = await agentActor(h, h.keys.leitor);
  await h.raw.query(
    `update ${S}.agent_api_keys
        set created_at = now() - interval '20 days', last_used_at = null
      where id = $1`,
    [leitor.keyId],
  );
  // Pessoa da equipe sem gravar nada há 100 dias.
  await h.raw.query(
    `with p as (
       insert into ${S}.profiles (email, full_name) values ('parada@harmony.test', 'Pessoa Parada')
       returning id)
     insert into ${S}.memberships (workspace_id, profile_id, role, created_at)
     select $1, p.id, 'member', now() - interval '100 days' from p`,
    [h.ws],
  );
  // Contato com acesso liberado há 120 dias e sem usar.
  await h.raw.query(
    `insert into ${S}.client_contacts
       (workspace_id, client_id, name, email, access_status, invited_at, created_at)
     select $1, c.id, 'Contato Parado', 'parado@cliente.test', 'active',
            now() - interval '120 days', now() - interval '120 days'
       from ${S}.clients c where c.slug = 'clinica-exemplo'`,
    [h.ws],
  );
  // Pedido de aprovação parado há 10 dias.
  const approval = await inTx(ctxFor(h, kratos), (t) =>
    requestApproval(t, {
      type: "replan",
      project: "VIT",
      title: "Pedido antigo de replanejamento",
      summary: "Esperando a decisão há dias.",
    }),
  );
  await h.raw.query(
    `update ${S}.approvals set created_at = now() - interval '10 days' where id = $1`,
    [approval.id],
  );
  // Recusas, gasto de IA, chave de IA antiga e webhook falhando.
  await h.raw.query(
    `insert into ${S}.agent_denials (workspace_id, agent_id, source, status, action, reason)
     values ($1, $2, 'mcp', 403, 'hub_complete_task', 'Sem o escopo.')`,
    [h.ws, h.agents.kratos],
  );
  await h.raw.query(
    `update ${S}.agents set budget_usd_month = 10, spent_usd_month = 9 where id = $1`,
    [h.agents.kratos],
  );
  await h.raw.query(
    `insert into ${S}.llm_credentials (workspace_id, provider, label, key_ciphertext, key_last4, created_at)
     values ($1, 'anthropic', 'Chave antiga', 'cifrado', 'ab12', now() - interval '200 days')`,
    [h.ws],
  );
  const hook = await h.raw.query<{ id: string }>(
    `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
     values ($1, 'https://hermes.exemplo.com.br/hub', array['approval.requested'], 'x')
     returning id`,
    [h.ws],
  );
  await h.raw.query(
    `insert into ${S}.webhook_deliveries (workspace_id, webhook_id, event, payload, attempts, last_error)
     values ($1, $2, 'approval.requested', '{}', 3, 'HTTP 500')`,
    [h.ws, hook.rows[0].id],
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("auditoria de acesso (AC-14)", () => {
  it("aponta cada regra, com o que fazer, das mais importantes para as outras", async () => {
    const audit = await inTx(asOwner(), (t) => accessAudit(t, new Date()));
    const kinds = new Set(audit.findings.map((f) => f.kind));
    for (const kind of [
      "key_old",
      "key_expiring",
      "key_unused",
      "key_broad",
      "key_paused_agent",
      "member_idle",
      "contact_idle",
      "approval_old",
      "denials",
      "ai_budget",
      "ai_credential_old",
      "webhook_failing",
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    expect(audit.findings.find((f) => f.kind === "member_idle")?.subject).toBe(
      "Pessoa Parada",
    );
    expect(
      audit.findings.find((f) => f.kind === "webhook_failing")?.subject,
    ).toBe("hermes.exemplo.com.br");
    // Toda sugestão diz o que fazer; a ordem vai da mais importante para a menor.
    const order = { high: 0, medium: 1, low: 2 } as const;
    const severities = audit.findings.map((f) => order[f.severity]);
    expect([...severities].sort((a, b) => a - b)).toEqual(severities);
    expect(audit.findings.every((f) => f.action.length > 10)).toBe(true);
    expect(audit.counts.pending_approvals).toBeGreaterThanOrEqual(1);
    expect(audit.counts.ai_spent_usd_month).toBeGreaterThanOrEqual(9);
  });

  it("agente só com agents:read e todos os projetos; chave de projeto não lê", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    expect(await status(inTx(ctxFor(h, kratos), (t) => accessAudit(t)))).toBe(
      403,
    );
    const todos = await agentActor(h, h.keys.todos);
    expect(await status(inTx(ctxFor(h, todos), (t) => accessAudit(t)))).toBe(
      200,
    );
    const restricted = await inTx(asOwner(), (t) =>
      createAgentKey(
        t,
        {
          agent_id: h.agents.executor,
          scopes: ["agents:read"],
          projects: ["VIT"],
        },
        TEST_PEPPER,
      ),
    );
    const scoped = await agentActor(h, restricted.key);
    expect(await status(inTx(ctxFor(h, scoped), (t) => accessAudit(t)))).toBe(
      403,
    );
  });

  it("o relatório semanal chega na caixa de entrada do dono", async () => {
    const result = await inTx(ctxFor(h, systemActor(h.ws), "cron"), (t) =>
      weeklyAuditNotice(t, new Date()),
    );
    expect(result.findings).toBeGreaterThan(0);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.notifications
          where type = 'audit.weekly' and profile_id = $1
            and (payload->>'findings')::int = $2`,
        [h.owner, result.findings],
      ),
    ).toBe(1);
  });
});
