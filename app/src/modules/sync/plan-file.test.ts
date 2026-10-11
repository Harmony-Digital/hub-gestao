import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyItemChanges,
  parsePlanFile,
  renderPlanFile,
  type ParsedPlanFile,
} from "./plan-file";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
// Estrutura real dos plan.md do Certato (trechos) e do IA Posicionamento, com o texto
// trocado por palavras neutras e os números sorteados: nenhum dado dos projetos.
const certato = readFileSync(path.join(FIXTURES, "certato.plan.md"), "utf8");
const posicionamento = readFileSync(
  path.join(FIXTURES, "ia-posicionamento.plan.md"),
  "utf8",
);
// O plano do próprio Hub, como está no repositório.
const hubPlan = readFileSync(
  path.resolve(import.meta.dirname, "../../../../PLAN.md"),
  "utf8",
);

const roundTrip = (text: string) =>
  renderPlanFile(parsePlanFile(text).lines) === text;

function items(parsed: ParsedPlanFile, kind: "task" | "criterion") {
  return parsed.items.filter((i) => i.kind === kind);
}

/**
 * Oráculo simples (para arquivos sem cerca de código): linhas `##` com caixa ou GATE,
 * fora as seções com `<!-- hub: ignorar -->`.
 */
function sectionsWithBoxes(text: string): number[] {
  const found: number[] = [];
  let section: number | null = null;
  let has = false;
  let ignored = false;
  const close = () => {
    if (section !== null && has && !ignored) found.push(section);
  };
  text.split("\n").forEach((line, n) => {
    if (/^#{1,2} /.test(line)) {
      close();
      section =
        line.startsWith("## ") && !/^## Sem marco\s*$/.test(line) ? n : null;
      // Título com o código do marco é marco mesmo sem itens.
      has = /^## (✅\s*)?M\d+\s*[—–-]/u.test(line);
      ignored = false;
    } else if (/^\s*<!--\s*hub:\s*ignorar\s*-->\s*$/.test(line)) {
      ignored = true;
    } else if (
      /^\s*[-*+] \[[ xX]\] \S/.test(line) ||
      /^### .*GATE/.test(line)
    ) {
      has = true;
    }
  });
  close();
  return found;
}

describe("leitura byte-neutra", () => {
  it("devolve o arquivo igual, byte a byte", () => {
    for (const text of [
      certato,
      posicionamento,
      hubPlan,
      "",
      "\n",
      "sem quebra no fim",
      "# T\r\n\r\n## M1 — A\r\n- [ ] x (HUB-1)\r\n",
      "## M1\n\t- [x] tab\n  continua  \n\n```\n- [ ] dentro da cerca\n```\n",
    ]) {
      expect(roundTrip(text)).toBe(true);
    }
  });

  it("ignora itens dentro de cercas de código", () => {
    const parsed = parsePlanFile(
      "## M1 — A\n- [ ] fora\n```md\n- [ ] dentro\n## Não é marco\n```\n~~~\n- [x] também\n~~~\n",
    );
    expect(parsed.items.map((i) => i.title)).toEqual(["fora"]);
    expect(parsed.milestones.map((m) => m.title)).toEqual(["A"]);
  });
});

describe("estrutura", () => {
  it("lê marcos, frentes, GATEs e critérios no formato do Hub", () => {
    const parsed = parsePlanFile(
      [
        "# PLAN.md — Projeto",
        "",
        "## Regras",
        "Texto livre, sem itens.",
        "",
        "## ✅ Preparação",
        "- [x] Feito antes (HUB-1)",
        "",
        "## M1 — Primeiro marco",
        "### Frente A",
        "- [ ] Tarefa (HUB-2)",
        "  - [x] Subtarefa (HUB-3)",
        "### 🔒 GATE M1 (aprovação do Fábio)",
        "- [x] Critério marcado no arquivo",
        "",
        "## Sem marco",
        "### Frente solta",
        "- [ ] Solta (HUB-4)",
        "### Tarefas sem frente",
        "- [ ] Sem frente (HUB-5)",
        "",
        "## Registro de Execução",
        "| Data | O quê |",
        "|---|---|",
      ].join("\n"),
    );
    expect(parsed.title).toBe("PLAN.md — Projeto");
    expect(parsed.milestones).toMatchObject([
      { code: null, title: "Preparação", done: true, gate: null },
      { code: "M1", title: "Primeiro marco", done: false, gate: 0 },
    ]);
    expect(parsed.workstreams).toMatchObject([
      { title: "Frente A", milestone: 1 },
      { title: "Frente solta", milestone: null },
    ]);
    expect(parsed.gates).toMatchObject([
      { milestone: 1, title: "🔒 GATE M1 (aprovação do Fábio)" },
    ]);
    expect(
      parsed.items.map((i) => [
        i.code,
        i.kind,
        i.depth,
        i.milestone,
        i.workstream,
        i.checked,
      ]),
    ).toEqual([
      ["HUB-1", "task", 0, 0, null, true],
      ["HUB-2", "task", 0, 1, 0, false],
      ["HUB-3", "task", 1, 1, 0, true],
      [null, "criterion", 0, 1, null, true],
      ["HUB-4", "task", 0, null, 1, false],
      ["HUB-5", "task", 0, null, null, false],
    ]);
    expect(parsed.items[2].parent).toBe(1);
  });

  it("título com o código do marco é marco mesmo sem itens", () => {
    const parsed = parsePlanFile(
      "## M1 — Vazio\n### Frente sem itens\n\n## Regras\nTexto.\n",
    );
    expect(parsed.milestones).toMatchObject([
      { code: "M1", title: "Vazio", end: 2 },
    ]);
    expect(parsed.workstreams).toMatchObject([
      { title: "Frente sem itens", milestone: 0, end: 2 },
    ]);
    expect(parsed.sections.map((x) => [x.title, x.line, x.end])).toEqual([
      ["M1 — Vazio", 0, 2],
      ["Regras", 3, 4],
    ]);
  });

  it("trata a seção com <!-- hub: ignorar --> como texto livre", () => {
    const text = [
      "## Decisões do dono",
      "",
      "<!-- hub: ignorar -->",
      "- [x] **D1** Domínio próprio.",
      "",
      "## M1 — A",
      "- [ ] Tarefa",
    ].join("\n");
    const parsed = parsePlanFile(text);
    expect(parsed.milestones.map((m) => m.code)).toEqual(["M1"]);
    expect(parsed.items.map((i) => i.title)).toEqual(["Tarefa"]);
    expect(renderPlanFile(parsed.lines)).toBe(text);
  });

  it("lê o departamento escrito logo abaixo da frente, antes dos itens", () => {
    const text = [
      "## M1 — Site",
      "### Layout",
      "",
      "Departamento: Design.",
      "",
      "- [ ] Desenhar a home",
      "### Integrações",
      "**Departamento sugerido:** sistemas",
      "- [ ] Ligar o formulário",
      "### Textos",
      "- [ ] Escrever a home",
      "Departamento: Marketing.",
      "### 🔒 GATE M1",
      "Departamento: Design.",
      "- [ ] Site no ar",
    ].join("\n");
    const parsed = parsePlanFile(text);
    expect(parsed.workstreams.map((w) => [w.title, w.department])).toEqual([
      ["Layout", "Design"],
      ["Integrações", "sistemas"],
      // Depois do primeiro item, a linha é texto do plano, não o departamento.
      ["Textos", null],
    ]);
    expect(renderPlanFile(parsed.lines)).toBe(text);
  });

  it("junta as linhas de continuação do item", () => {
    const parsed = parsePlanFile(
      "## Entrega — 09/10\n\n- [x] Página nova com o texto\n  “Em breve”, sem revelar o produto.\n- [ ] Próxima\n",
    );
    expect(parsed.items[0]).toMatchObject({
      line: 2,
      lastLine: 3,
      title: "Página nova com o texto “Em breve”, sem revelar o produto.",
    });
    expect(parsed.items[1].line).toBe(4);
  });

  it("separa título, nota e evidência, e marca o item riscado", () => {
    const parsed = parsePlanFile(
      [
        "## M2 — B",
        "- [x] Publicar a tela — evidência: PR #33, conferido no navegador (HUB-9)",
        "- [x] **Ligar áreas às análises:** b5c2973 publicado",
        "- [ ] **(Nota)** Resumo do campo",
        "- [ ] ~~Perfil dedicado~~ — **cancelado** por D6",
        `- [ ] ${"palavra ".repeat(60)}fim`,
      ].join("\n"),
    );
    const [a, b, c, d, e] = parsed.items;
    expect(a).toMatchObject({
      title: "Publicar a tela",
      evidence: "PR #33, conferido no navegador",
      code: "HUB-9",
      struck: false,
    });
    expect(b).toMatchObject({
      title: "Ligar áreas às análises",
      note: "b5c2973 publicado",
    });
    expect(c.title).toBe("(Nota) Resumo do campo");
    expect(d).toMatchObject({ title: "Perfil dedicado", struck: true });
    expect(e.title.length).toBeLessThanOrEqual(300);
    expect(e.title.endsWith("…")).toBe(true);
  });

  it("só reconhece códigos com o prefixo do workspace, e o último vale", () => {
    const parsed = parsePlanFile(
      "## M1\n- [x] Modelo (GPT-5) trocado (HUB-1) depois (HUB-7)\n- [ ] Outro (ABC-2)\n",
      { prefix: "HUB" },
    );
    expect(parsed.items.map((i) => [i.code, i.title])).toEqual([
      ["HUB-7", "Modelo (GPT-5) trocado (HUB-1) depois"],
      [null, "Outro (ABC-2)"],
    ]);
    expect(
      parsePlanFile("## M1\n- [ ] Outro (ABC-2)\n", { prefix: "ABC" }).items[0]
        .code,
    ).toBe("ABC-2");
  });
});

describe("planos reais", () => {
  it("IA Posicionamento: marcos M0 a M6 com GATE e critérios fora das tarefas", () => {
    const parsed = parsePlanFile(posicionamento);
    const codes = parsed.milestones.map((m) => m.code).filter(Boolean);
    expect(codes).toEqual(["M0", "M1", "M2", "M3", "M4", "M5", "M6"]);
    for (const m of parsed.milestones.filter((x) => x.code)) {
      expect(m.gate).not.toBeNull();
    }
    expect(parsed.milestones[0]).toMatchObject({ done: true, code: null });
    const criteria = items(parsed, "criterion");
    expect(criteria.length).toBeGreaterThan(0);
    expect(criteria.every((c) => c.workstream === null)).toBe(true);
    // Toda caixa do arquivo vira item, fora as que estão em seções sem marco.
    const boxes = posicionamento.match(/^\s*[-*+] \[[ xX]\] \S/gm)!.length;
    expect(parsed.items.length).toBe(boxes);
    // Só as seções com caixa viram marco; regras, decisões e registro ficam como texto.
    expect(parsed.milestones.map((m) => m.line)).toEqual(
      sectionsWithBoxes(posicionamento),
    );
  });

  it("Certato: seções com data viram marcos, com subitens e continuações", () => {
    const parsed = parsePlanFile(certato);
    expect(parsed.gates).toEqual([]);
    expect(parsed.milestones.map((m) => m.line)).toEqual(
      sectionsWithBoxes(certato),
    );
    expect(parsed.items.some((i) => i.depth === 1 && i.parent !== null)).toBe(
      true,
    );
    expect(parsed.items.some((i) => i.lastLine > i.line)).toBe(true);
    const boxes = certato.match(/^\s*[-*+] \[[ xX]\] \S/gm)!.length;
    expect(parsed.items.length).toBe(boxes);
  });

  it("o PLAN.md do Hub: marcos M0 a M9, um GATE por marco e o registro fora", () => {
    const parsed = parsePlanFile(hubPlan);
    const codes = parsed.milestones.map((m) => m.code).filter(Boolean);
    expect(codes).toEqual(
      ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"].filter((c) =>
        new RegExp(`^## ${c} `, "m").test(hubPlan),
      ),
    );
    const gateLines = hubPlan.match(/^### 🔒 GATE/gm)!.length;
    expect(parsed.gates.length).toBe(gateLines);
    expect(parsed.milestones.map((m) => m.line)).toEqual(
      sectionsWithBoxes(hubPlan),
    );
    expect(parsed.milestones.some((m) => /Registro/.test(m.title))).toBe(false);
    expect(parsed.items.some((i) => i.struck)).toBe(true);
  });
});

describe("escrita", () => {
  const file =
    "# P\r\n\r\n## M1 — A\r\n- [ ] Primeiro  \r\n- [x] Segundo\r\n  continua aqui\r\n- [ ] Terceiro (HUB-3)\r\nfim";

  it("muda só a caixa e acrescenta o código no fim do item", () => {
    const parsed = parsePlanFile(file);
    const out = applyItemChanges(parsed, [
      { item: 0, checked: true, code: "HUB-1" },
      { item: 1, checked: false, code: "HUB-2" },
      { item: 2, checked: true, code: "HUB-9" },
    ]);
    expect(out).toBe(
      "# P\r\n\r\n## M1 — A\r\n- [x] Primeiro (HUB-1)  \r\n- [ ] Segundo\r\n  continua aqui (HUB-2)\r\n- [x] Terceiro (HUB-3)\r\nfim",
    );
    const again = parsePlanFile(out);
    expect(again.items.map((i) => [i.code, i.checked])).toEqual([
      ["HUB-1", true],
      ["HUB-2", false],
      ["HUB-3", true],
    ]);
  });

  it("sem mudanças, devolve o mesmo texto", () => {
    expect(applyItemChanges(parsePlanFile(hubPlan), [])).toBe(hubPlan);
  });
});
