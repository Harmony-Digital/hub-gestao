import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { getPlan } from "@/modules/projects/service";
import { getTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import { parsePlanFile } from "./plan-file";
import { importPlan } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

/** Projeto novo, sem marcos nem tarefas, com os status padrão do workspace. */
async function emptyProject(code: string): Promise<string> {
  const project = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.projects (workspace_id, client_id, code, name, status)
       select $1, c.id, $2, $3, 'active'
         from ${S}.clients c where c.workspace_id = $1 limit 1
       returning id`,
      [h.ws, code, `Projeto ${code}`],
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
     select $1, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
            (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
       from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
      where w.id = $1`,
    [h.ws, project.id],
  );
  return project.id;
}

const PLAN = [
  "# Plano",
  "",
  "## ✅ Preparação",
  "- [x] Feito antes",
  "",
  "## M0 — Fundação",
  "### Banco",
  "- [x] Criar o schema — evidência: PR #1",
  "- [ ] Testar a RLS",
  "  - [x] Caso do cliente",
  "### 🔒 GATE M0 (aprovação do Fábio)",
  "- [x] Fábio aprova o PRD",
  "",
  "## M2 — Publicação",
  "### Pipeline",
  "- [ ] Publicar na VPS",
  "### 🔒 GATE M2",
  "- [ ] Health no ar",
  "",
  "## Registro de Execução",
  "| Data | O quê |",
  "",
].join("\n");

const owner = () => ctxFor(h, h.owner_actor, "ui");

describe("importação do plan.md", () => {
  it("cria marcos com o código e a ordem do arquivo, frentes, tarefas e critérios", async () => {
    await emptyProject("IMPA");
    const result = await inTx(owner(), (t) =>
      importPlan(t, { project: "IMPA", markdown: PLAN }),
    );
    expect(result.dry_run).toBe(false);
    expect(result.conflicts).toEqual([]);
    expect(result.summary).toMatchObject({
      milestones_created: 3,
      workstreams_created: 3,
      created: 5,
      completed: 3,
    });
    expect(result.milestones).toEqual([
      { code: "M0", title: "Fundação", status: "delivered" },
      { code: "M2", title: "Publicação", status: "planned" },
      { code: "M3", title: "Preparação", status: "delivered" },
    ]);

    const plan = await inTx(owner(), (t) => getPlan(t, "IMPA"));
    // A ordem é a do arquivo; o marco sem código ganhou o próximo livre.
    expect(plan.milestones.map((m) => m.code)).toEqual(["M3", "M0", "M2"]);
    const m0 = plan.milestones.find((m) => m.code === "M0")!;
    expect(m0.acceptance_criteria).toEqual([
      { text: "Fábio aprova o PRD", done: true },
    ]);
    expect(m0.workstreams.map((w) => w.title)).toEqual(["Banco"]);

    // Códigos no arquivo devolvido; concluídas com a evidência certa.
    const items = parsePlanFile(result.markdown).items;
    const code = (title: string) =>
      items.find((i) => i.title === title)?.code as string;
    const done = async (title: string) =>
      (await inTx(owner(), (t) => getTask(t, code(title)))).done_evidence;
    expect(await done("Criar o schema")).toBe("PR #1");
    expect(await done("Feito antes")).toMatch(
      /^Já estava concluída no plan\.md quando ele foi importado/,
    );
    expect(await done("Caso do cliente")).toMatch(/^Já estava concluída/);
    expect(result.markdown).toContain(
      "## Registro de Execução\n| Data | O quê |\n",
    );
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.plan_sync_runs where id = $1 and direction = 'import'`,
        [result.run_id],
      ),
    ).toBe(1);

    // Importar de novo o arquivo devolvido não cria nada.
    const again = await inTx(owner(), (t) =>
      importPlan(t, { project: "IMPA", markdown: result.markdown }),
    );
    expect(again.summary).toMatchObject({
      milestones_created: 0,
      created: 0,
      completed: 0,
    });
    expect(again.changed).toBe(false);
  });

  it("a prévia mostra o que entra e não grava nada", async () => {
    const id = await emptyProject("IMPB");
    const preview = await inTx(owner(), (t) =>
      importPlan(t, { project: "IMPB", markdown: PLAN, dry_run: true }),
    );
    expect(preview).toMatchObject({
      dry_run: true,
      run_id: "",
      summary: { milestones_created: 3, created: 5 },
    });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.milestones where project_id = $1`,
        [id],
      ),
    ).toBe(0);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where project_id = $1`,
        [id],
      ),
    ).toBe(0);
  });

  it("agente não importa (marco é decisão de pessoa)", async () => {
    const actor = await agentActor(h, h.keys.todos);
    const err = await inTx(ctxFor(h, actor, "api"), (t) =>
      importPlan(t, { project: "VIT", markdown: PLAN }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).status).toBe(403);
  });
});
