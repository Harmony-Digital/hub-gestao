import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { updateWorkstream } from "@/modules/workstreams/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import { parsePlanFile } from "@/modules/sync/plan-file";
import { createProject } from "@/modules/projects/admin";
import { importPlan } from "@/modules/sync/service";
import {
  applyTemplateClientTexts,
  applyTemplateDates,
  applyTemplateStatuses,
  TEMPLATE_DATES_REASON,
  createTemplate,
  getTemplate,
  listTemplates,
  removeTemplate,
  templateFromProject,
  TemplateInput,
  updateTemplate,
} from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const SKELETON = [
  "# Modelo · Teste",
  "",
  "## M1 — Descoberta",
  "",
  "### Briefing",
  "",
  "Departamento: Estratégia.",
  "",
  "- [ ] Fazer o briefing",
  "  - [ ] Agendar a reunião",
  "",
  "### GATE M1 (critérios de aceite)",
  "",
  "- [ ] Briefing aprovado",
  "",
].join("\n");

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (err) {
    if (err instanceof HubError)
      return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error("Era para recusar.");
}

const input = (over: Partial<TemplateInput> = {}) =>
  TemplateInput.parse({
    name: "Modelo de teste",
    description: "Para os testes.",
    markdown: SKELETON,
    departments: ["estrategia"],
    ...over,
  });

describe("modelos de projeto", () => {
  it("o seed traz os seis modelos iniciais, com as contas de cada um", async () => {
    const list = await inTx(asOwner(), (t) => listTemplates(t));
    expect(list).toHaveLength(6);
    const site = list.find((t) => t.name === "Site institucional")!;
    expect(site.counts.milestones).toBe(4);
    expect(site.departments.map((d) => d.slug)).toContain("design");
  });

  it("cria, edita (versão nova só quando muda) e remove, com histórico", async () => {
    const created = await inTx(asOwner(), (t) => createTemplate(t, input()));
    expect(created).toMatchObject({
      version: 1,
      counts: { milestones: 1, workstreams: 1, tasks: 1, subtasks: 1 },
      departments: [{ slug: "estrategia", name: "Estratégia" }],
    });
    const same = await inTx(asOwner(), (t) =>
      updateTemplate(t, created.id, input()),
    );
    expect(same.version).toBe(1);
    const renamed = await inTx(asOwner(), (t) =>
      updateTemplate(t, created.id, input({ name: "Modelo renomeado" })),
    );
    expect(renamed).toMatchObject({ version: 2, name: "Modelo renomeado" });
    await inTx(asOwner(), (t) => removeTemplate(t, created.id));
    expect(
      await refusal(inTx(asOwner(), (t) => getTemplate(t, created.id))),
    ).toMatchObject({ status: 404 });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where entity_type = 'template' and entity_id = $1`,
        [created.id],
      ),
    ).toBe(3);
  });

  it("recusa esqueleto sem marco, com código, com caixa marcada, nome repetido e departamento que não existe", async () => {
    const bad = (over: Partial<TemplateInput>) =>
      refusal(inTx(asOwner(), (t) => createTemplate(t, input(over))));
    expect(await bad({ markdown: "- [ ] Solta" })).toMatchObject({
      status: 422,
    });
    expect(
      await bad({
        markdown: SKELETON.replace("o briefing", "o briefing (HUB-3)"),
      }),
    ).toMatchObject({ status: 422 });
    expect(
      await bad({ markdown: SKELETON.replace("- [ ] Fazer", "- [x] Fazer") }),
    ).toMatchObject({ status: 422 });
    expect(await bad({ name: "Site institucional" })).toMatchObject({
      status: 409,
    });
    expect(await bad({ departments: ["inexistente"] })).toMatchObject({
      status: 422,
    });
  });

  it("agente não mexe em modelo", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    expect(
      await refusal(inTx(ctxFor(h, kratos), (t) => listTemplates(t))),
    ).toMatchObject({ status: 403 });
  });

  it("gera o modelo a partir de um projeto: sem códigos, tudo desmarcado, com os departamentos", async () => {
    await inTx(asOwner(), async (t) => {
      await updateWorkstream(t, h.vitWorkstream, { department: "sistemas" });
      const task = await createTask(t, {
        project: "VIT",
        title: "Ligar o WhatsApp — com o número da clínica",
        workstream_id: h.vitWorkstream,
      });
      await createTask(t, {
        project: "VIT",
        title: "Pedir o número",
        parent: task.code,
      });
    });
    const tpl = await inTx(asOwner(), (t) =>
      templateFromProject(t, "VIT", { name: "Atendimento a partir do VIT" }),
    );
    const parsed = parsePlanFile(tpl.markdown);
    expect(parsed.milestones.map((m) => [m.code, m.title])).toEqual([
      ["M1", "Agente no WhatsApp"],
    ]);
    expect(parsed.workstreams.map((w) => [w.title, w.department])).toEqual([
      ["Fluxo de atendimento", "Sistemas"],
    ]);
    // O travessão com espaços abriria a nota no plan.md: vira hífen.
    expect(
      parsed.items.map((i) => [i.title, i.depth, i.checked, i.code]),
    ).toEqual([
      ["Ligar o WhatsApp - com o número da clínica", 0, false, null],
      ["Pedir o número", 1, false, null],
    ]);
  });
  it("leva o conjunto de status e os textos para o cliente, e usa no projeto novo (RF-36)", async () => {
    // O VIT ganha um status a mais e textos para o cliente.
    await h.raw.query(
      `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
       values ($1, $2, 'Aguardando cliente', '#B45309', 'blocked', 6, false)`,
      [h.ws, h.vit],
    );
    await h.raw.query(
      `update ${S}.projects set objective_client = 'Atender seus pacientes no WhatsApp.' where id = $1`,
      [h.vit],
    );
    await h.raw.query(
      `update ${S}.milestones set title_client = 'Atendente virtual', description_client = 'Responde e agenda.' where id = $1`,
      [h.vitMilestone],
    );
    await h.raw.query(
      `update ${S}.workstreams set title_client = 'Conversas do atendimento' where id = $1`,
      [h.vitWorkstream],
    );
    const tpl = await inTx(asOwner(), (t) =>
      templateFromProject(t, "VIT", { name: "Atendimento com textos" }),
    );
    expect(tpl.statuses?.map((st) => st.name)).toEqual([
      "A fazer",
      "Em andamento",
      "Em revisão",
      "Bloqueada",
      "Concluída",
      "Aguardando cliente",
    ]);
    expect(tpl.client).toEqual({
      objective: "Atender seus pacientes no WhatsApp.",
      milestones: {
        "Agente no WhatsApp": {
          title_client: "Atendente virtual",
          description_client: "Responde e agenda.",
        },
      },
      workstreams: {
        "Fluxo de atendimento": {
          title_client: "Conversas do atendimento",
          description_client: null,
        },
      },
    });
    // Editar o esqueleto na tela não perde os status nem os textos.
    const edited = await inTx(asOwner(), (t) =>
      updateTemplate(
        t,
        tpl.id,
        TemplateInput.parse({
          name: tpl.name,
          markdown: tpl.markdown,
          description: "Com textos",
          departments: tpl.departments.map((d) => d.slug),
        }),
      ),
    );
    expect(edited.statuses).toEqual(tpl.statuses);
    expect(edited.client).toEqual(tpl.client);

    // Projeto novo com o modelo: os status do modelo e, depois da importação, os textos.
    const clientId = (
      await h.raw.query<{ client_id: string }>(
        `select client_id from ${S}.projects where id = $1`,
        [h.vit],
      )
    ).rows[0].client_id;
    const created = await inTx(asOwner(), async (t) => {
      const project = await createProject(t, {
        code: "MOD",
        name: "Projeto do modelo",
        client_id: clientId,
        phase: "descobrir",
        status: "active",
        objective_internal: null,
        objective_client: tpl.client!.objective,
        start_date: null,
        target_date: null,
        owner_profile_id: null,
        pm_agent_id: null,
        repo_url: null,
        plan_path: null,
        require_evidence: false,
        client_can_confirm_receipt: false,
        departments: [],
      });
      await applyTemplateStatuses(t, project.id, tpl.statuses!);
      return project;
    });
    const statuses = await h.raw.query<{ name: string; is_default: boolean }>(
      `select name, is_default from ${S}.task_statuses where project_id = $1 order by sort_order`,
      [created.id],
    );
    expect(statuses.rows.map((r) => r.name)).toContain("Aguardando cliente");
    expect(statuses.rows.filter((r) => r.is_default)).toEqual([
      { name: "A fazer", is_default: true },
    ]);
    const applied = await inTx(asOwner(), async (t) => {
      await importPlan(t, { project: "MOD", markdown: tpl.markdown });
      return applyTemplateClientTexts(t, "MOD", tpl.id);
    });
    expect(applied).toBe(2);
    const milestone = await h.raw.query(
      `select title_client, description_client from ${S}.milestones m
         join ${S}.projects p on p.id = m.project_id where p.code = 'MOD'`,
    );
    expect(milestone.rows).toEqual([
      {
        title_client: "Atendente virtual",
        description_client: "Responde e agenda.",
      },
    ]);
    const ws = await h.raw.query(
      `select w.title_client, w.visibility::text as visibility from ${S}.workstreams w
         join ${S}.projects p on p.id = w.project_id where p.code = 'MOD'`,
    );
    // O texto entra; mostrar a frente ao cliente continua sendo pedido de aprovação.
    expect(ws.rows).toEqual([
      { title_client: "Conversas do atendimento", visibility: "internal" },
    ]);
    // De novo: nada é sobrescrito.
    expect(
      await inTx(asOwner(), (t) => applyTemplateClientTexts(t, "MOD", tpl.id)),
    ).toBe(0);
  });

  it("recusa conjunto de status sem todas as categorias ou sem padrão em A fazer", async () => {
    const base = TemplateInput.parse({
      name: "Status tortos",
      markdown: SKELETON,
    });
    const bad = async (statuses: Parameters<typeof createTemplate>[2]) => {
      const err = await inTx(asOwner(), (t) =>
        createTemplate(t, base, statuses),
      ).catch((e: unknown) => e);
      return (err as HubError).status;
    };
    expect(
      await bad({
        statuses: [
          {
            name: "A fazer",
            color: "#999999",
            category: "todo",
            is_default: true,
          },
        ],
      }),
    ).toBe(422);
  });
});

describe("datas dos marcos do modelo", () => {
  it("espalha as datas entre o início e a entrega, só nos marcos sem data", async () => {
    const clientId = (
      await h.raw.query<{ client_id: string }>(
        `select client_id from ${S}.projects where id = $1`,
        [h.vit],
      )
    ).rows[0].client_id;
    const markdown = [
      "# Plano",
      "",
      "## M1 — Descoberta",
      "### Briefing",
      "- [ ] Fazer o briefing",
      "",
      "## M2 — Construção",
      "### Obra",
      "- [ ] Construir",
      "",
    ].join("\n");
    const base = {
      client_id: clientId,
      phase: "descobrir" as const,
      status: "active" as const,
      objective_internal: null,
      objective_client: null,
      owner_profile_id: null,
      pm_agent_id: null,
      repo_url: null,
      plan_path: null,
      require_evidence: false,
      client_can_confirm_receipt: false,
      departments: [],
    };
    const dated = await inTx(asOwner(), async (t) => {
      await createProject(t, {
        ...base,
        code: "DAT",
        name: "Com datas",
        start_date: "2026-10-12",
        target_date: "2026-12-11",
      });
      await importPlan(t, { project: "DAT", markdown });
      return applyTemplateDates(t, "DAT");
    });
    expect(dated).toBe(2);
    const rows = await h.raw.query<{ code: string; due: string }>(
      `select m.code, m.due_date::text as due from ${S}.milestones m
         join ${S}.projects p on p.id = m.project_id
        where p.code = 'DAT' order by m.sort_order`,
    );
    expect(rows.rows).toEqual([
      { code: "M1", due: "2026-11-11" },
      { code: "M2", due: "2026-12-11" },
    ]);
    // O motivo fica no histórico de datas; a primeira data não conta como revisão.
    const history = await h.raw.query<{
      reason: string;
      old_due: string | null;
    }>(
      `select h.reason_internal as reason, h.old_due::text as old_due
         from ${S}.milestone_date_history h
         join ${S}.milestones m on m.id = h.milestone_id
         join ${S}.projects p on p.id = m.project_id where p.code = 'DAT'`,
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]).toEqual({
      reason: TEMPLATE_DATES_REASON,
      old_due: null,
    });
    // De novo: os marcos já têm data, nada muda.
    expect(await inTx(asOwner(), (t) => applyTemplateDates(t, "DAT"))).toBe(0);

    // Sem início e entrega no projeto, os marcos ficam sem data.
    const none = await inTx(asOwner(), async (t) => {
      await createProject(t, {
        ...base,
        code: "SDT",
        name: "Sem datas",
        start_date: null,
        target_date: null,
      });
      await importPlan(t, { project: "SDT", markdown });
      return applyTemplateDates(t, "SDT");
    });
    expect(none).toBe(0);
  });
});
