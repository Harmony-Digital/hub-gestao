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
import {
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
});
