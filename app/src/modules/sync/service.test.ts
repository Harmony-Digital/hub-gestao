import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask, getTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import { parsePlanFile } from "./plan-file";
import { syncPlan } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

/** Push ou pull com a chave do Kratos (sync:plan, tarefas, frentes e comentários). */
async function sync(
  direction: "pull" | "push",
  markdown: string,
  extra: { base_markdown?: string; commit_sha?: string } = {},
  key = h.keys.kratos,
) {
  const actor = await agentActor(h, key);
  return inTx(ctxFor(h, actor, "api"), (t) =>
    syncPlan(t, { project: "VIT", direction, markdown, ...extra }),
  );
}

const codesIn = (markdown: string) =>
  parsePlanFile(markdown).items.map((i) => i.code);

describe("push", () => {
  it("cria as tarefas novas com código, conclui com evidência e registra os conflitos", async () => {
    const file = [
      "# Plano do VIT",
      "",
      "## M1 — Agente no WhatsApp",
      "",
      "### Fluxo de atendimento",
      "- [ ] Mapear as perguntas do sync",
      "  - [ ] Separar por tema",
      "- [x] Publicar o fluxo do sync — evidência: PR #7 conferido",
      "- [x] Concluída sem prova no sync",
      "- [ ] ~~Ideia cancelada~~ — cancelado",
      "- [ ] Código de outro lugar (HUB-9999)",
      "",
      "### Frente nova do sync",
      "- [ ] Item na frente nova",
      "",
      "### 🔒 GATE M1 (aprovação do Fábio)",
      "- [x] Critério marcado no arquivo",
      "",
      "## M9 — Marco que não existe",
      "- [ ] Item do marco inexistente",
      "",
    ].join("\n");
    const result = await sync("push", file);

    expect(result.summary).toMatchObject({
      created: 5,
      completed: 1,
      workstreams_created: 1,
    });
    expect(result.conflicts.map((c) => c.kind).sort()).toEqual(
      [
        "gate_checked",
        "milestone_missing",
        "no_evidence",
        "unknown_code",
      ].sort(),
    );
    // O arquivo devolvido tem os códigos novos; o resto do texto é o mesmo.
    const codes = codesIn(result.markdown);
    expect(codes.slice(0, 4).every((c) => c && /^HUB-\d+$/.test(c))).toBe(true);
    expect(result.markdown).toContain("~~Ideia cancelada~~ — cancelado\n");
    expect(result.markdown).toContain("## M9 — Marco que não existe\n");
    expect(result.changed).toBe(true);

    const [mapear, separar, publicar, semProva] = codes as string[];
    const owner = ctxFor(h, h.owner_actor, "ui");
    const sub = await inTx(owner, (t) => getTask(t, separar));
    expect(sub.parent_code).toBe(mapear);
    const done = await inTx(owner, (t) => getTask(t, publicar));
    expect(done.status.category).toBe("done");
    expect(done.done_evidence).toBe("PR #7 conferido");
    const open = await inTx(owner, (t) => getTask(t, semProva));
    expect(open.status.category).not.toBe("done");

    // Origem plan_md, atividade com origem sync e comentário na tarefa sem prova.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where code = any($1) and source = 'plan_md'`,
        [codes.slice(0, 4)],
      ),
    ).toBe(4);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where action = 'task.created' and source = 'sync' and entity_id in
            (select id from ${S}.tasks where code = any($1))`,
        [codes.slice(0, 4)],
      ),
    ).toBe(4);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.comments c join ${S}.tasks k on k.id = c.entity_id
          where k.code = $1 and c.body_md like 'Sincronização do plan.md:%'`,
        [semProva],
      ),
    ).toBe(1);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.plan_sync_runs
          where id = $1 and direction = 'push' and jsonb_array_length(conflicts) = 4`,
        [result.run_id],
      ),
    ).toBe(1);

    // De novo, com o arquivo devolvido: nada novo, e o aviso não se repete.
    const again = await sync("push", result.markdown);
    expect(again.summary).toMatchObject({ created: 0, completed: 0 });
    expect(again.changed).toBe(false);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.comments c join ${S}.tasks k on k.id = c.entity_id
          where k.code = $1 and c.body_md like 'Sincronização do plan.md:%'`,
        [semProva],
      ),
    ).toBe(1);
  });

  it("com o commit, conclui o item marcado sem evidência escrita", async () => {
    const result = await sync(
      "push",
      "## M1 — Agente no WhatsApp\n### Fluxo de atendimento\n- [x] Feito no commit\n",
      { commit_sha: "3f9a2c1d00aa" },
    );
    expect(result.summary.completed).toBe(1);
    const code = codesIn(result.markdown)[0] as string;
    const task = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      getTask(t, code),
    );
    expect(task.done_evidence).toBe("plan.md marcado no commit 3f9a2c1d00aa");
  });

  it("sem a versão anterior, o Hub vence; com ela, reabre, renomeia e arquiva", async () => {
    const created = await sync(
      "push",
      "## M1 — Agente no WhatsApp\n### Fluxo de atendimento\n- [x] Base A — evidência: teste\n- [ ] Base B\n- [ ] Base C\n",
    );
    const [a, b, c] = codesIn(created.markdown) as string[];
    const base = created.markdown;

    // Desmarcado no arquivo sem a versão anterior: o Hub vence e devolve marcado.
    const stale = base.replace(
      `- [x] Base A — evidência: teste (${a})`,
      `- [ ] Base A — evidência: teste (${a})`,
    );
    const wins = await sync("push", stale);
    expect(wins.conflicts.map((x) => x.kind)).toContain("hub_wins");
    expect(wins.markdown).toContain(`- [x] Base A — evidência: teste (${a})`);

    // Com a versão anterior: desmarcar reabre, renomear renomeia, tirar arquiva.
    const edited = stale
      .replace(`- [ ] Base B (${b})`, `- [ ] Base B renomeada (${b})`)
      .replace(`- [ ] Base C (${c})\n`, "");
    const applied = await sync("push", edited, { base_markdown: base });
    expect(applied.summary).toMatchObject({
      reopened: 1,
      renamed: 1,
      archived: 1,
    });
    const owner = ctxFor(h, h.owner_actor, "ui");
    expect((await inTx(owner, (t) => getTask(t, a))).status.category).not.toBe(
      "done",
    );
    expect((await inTx(owner, (t) => getTask(t, b))).title).toBe(
      "Base B renomeada",
    );
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where code = $1 and archived_at is not null`,
        [c],
      ),
    ).toBe(1);
    expect(applied.markdown).not.toContain(c);
  });
});

describe("pull", () => {
  it("leva o Hub para o arquivo sem gravar tarefas", async () => {
    const owner = ctxFor(h, h.owner_actor, "ui");
    const made = await inTx(owner, (t) =>
      createTask(t, {
        project: "VIT",
        title: "Criada pela tela",
        workstream_id: h.vitWorkstream,
      }),
    );
    const before = await count(
      h,
      `select count(*)::int as n from ${S}.tasks where project_id = $1`,
      [h.vit],
    );
    const result = await sync(
      "pull",
      "# Plano\n\n## M1 — Agente no WhatsApp\n\n### Fluxo de atendimento\n\n## Registro\nTexto livre.\n",
    );
    expect(result.markdown).toContain(`- [ ] Criada pela tela (${made.code})`);
    expect(result.markdown).toMatch(/## Registro\nTexto livre\.\n$/);
    expect(result.summary.inserted_in_file).toBeGreaterThan(0);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where project_id = $1`,
        [h.vit],
      ),
    ).toBe(before);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.plan_sync_runs where id = $1 and direction = 'pull'`,
        [result.run_id],
      ),
    ).toBe(1);
  });

  it("chave sem o escopo sync:plan recebe 403", async () => {
    const err = await sync("pull", "", {}, h.keys.leitor).catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).status).toBe(403);
  });
});

describe("planos reais", () => {
  it("num projeto vazio: o pull não muda nada e o push só aponta os marcos que faltam", async () => {
    // Projeto novo, sem marcos nem tarefas, com os status padrão do workspace.
    const project = (
      await h.raw.query<{ id: string }>(
        `insert into ${S}.projects (workspace_id, client_id, code, name, status)
         select $1, c.id, 'REAL', 'Planos reais', 'active'
           from ${S}.clients c where c.workspace_id = $1 limit 1
         returning id`,
        [h.ws],
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
    const fixtures = path.join(import.meta.dirname, "fixtures");
    const files = [
      readFileSync(path.join(fixtures, "certato.plan.md"), "utf8"),
      readFileSync(path.join(fixtures, "ia-posicionamento.plan.md"), "utf8"),
      readFileSync(
        path.resolve(import.meta.dirname, "../../../../PLAN.md"),
        "utf8",
      ),
    ];
    const owner = ctxFor(h, h.owner_actor, "api");
    for (const markdown of files) {
      const pulled = await inTx(owner, (t) =>
        syncPlan(t, { project: "REAL", direction: "pull", markdown }),
      );
      expect(pulled.markdown).toBe(markdown);
      expect(pulled.changed).toBe(false);

      const pushed = await inTx(owner, (t) =>
        syncPlan(t, { project: "REAL", direction: "push", markdown }),
      );
      expect(pushed.markdown).toBe(markdown);
      expect(pushed.summary.created).toBe(0);
      const kinds = new Set(pushed.conflicts.map((c) => c.kind));
      kinds.delete("gate_checked");
      expect([...kinds]).toEqual(
        parsePlanFile(markdown).milestones.length > 0
          ? ["milestone_missing"]
          : [],
      );
      expect(
        pushed.conflicts.filter((c) => c.kind === "milestone_missing").length,
      ).toBe(parsePlanFile(markdown).milestones.length);
    }
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where project_id = $1`,
        [project.id],
      ),
    ).toBe(0);
  });
});
