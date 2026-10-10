/**
 * plan.md ⇄ Hub (PRD §5.5 e §8.5): leitura e escrita byte-neutras do arquivo.
 *
 * O arquivo vira uma lista de linhas com o texto exato, inclusive o fim de linha. O
 * parser reconhece títulos de marco (`##`), de frente (`###`), de GATE (`### 🔒 GATE`) e
 * itens de checklist (`- [ ]` e `- [x]`, com as linhas de continuação); o resto é texto
 * livre e volta igual: `renderPlanFile(parsePlanFile(texto).lines) === texto` para
 * qualquer texto. Escrever no arquivo muda só a caixa do item e acrescenta o código no
 * fim dele (`applyItemChanges`). Puro: sem banco, serve à API, à CLI e aos testes.
 */

export type PlanLine = {
  /** A linha sem o fim de linha. */
  text: string;
  /** "\n", "\r\n" ou "" (última linha sem quebra). */
  eol: string;
};

export type PlanMilestone = {
  line: number;
  /** Última linha da seção (antes do próximo `#` ou `##`). */
  end: number;
  /** Código no título (`## M3 — ...`), quando houver. */
  code: string | null;
  title: string;
  /** Título marcado como concluído (`## ✅ ...`). */
  done: boolean;
  /** Índice do GATE deste marco em `gates`. */
  gate: number | null;
};

export type PlanWorkstream = {
  line: number;
  /** Última linha da frente (antes do próximo título de nível 1 a 3). */
  end: number;
  title: string;
  /** Índice em `milestones`; `null` na seção "Sem marco". */
  milestone: number | null;
};

export type PlanGate = {
  line: number;
  end: number;
  milestone: number;
  title: string;
};

export type PlanItem = {
  /** Linha do item; `lastLine` inclui as linhas de continuação. */
  line: number;
  lastLine: number;
  checked: boolean;
  /** 0: tarefa; 1: subtarefa (um nível só, como no Hub). */
  depth: 0 | 1;
  /** Item-pai (índice em `items`) da subtarefa. */
  parent: number | null;
  /** `criterion`: item de GATE, critério de aceite do marco (nunca vira tarefa). */
  kind: "task" | "criterion";
  milestone: number | null;
  workstream: number | null;
  /** Texto do item, com as continuações, sem o código. */
  text: string;
  /** Título para o Hub: texto simples, em uma linha, até 300 caracteres. */
  title: string;
  /** O que vem depois do título (depois do primeiro " — " ou do negrito com dois-pontos). */
  note: string | null;
  /** Evidência escrita no item (`— evidência: ...`), até 2000 caracteres. */
  evidence: string | null;
  /** Item riscado (`~~...~~`): cancelado ou substituído no plano. */
  struck: boolean;
  code: string | null;
};

export type ParsedPlanFile = {
  lines: PlanLine[];
  /** Primeiro título `#` do arquivo. */
  title: string | null;
  milestones: PlanMilestone[];
  workstreams: PlanWorkstream[];
  gates: PlanGate[];
  items: PlanItem[];
  /** Seção "Sem marco" (da exportação do Hub), se houver. */
  unplanned: { line: number; end: number } | null;
  /** Todas as seções `##` do arquivo (marcos ou não), na ordem. */
  sections: { line: number; end: number; title: string }[];
};

export type ParseOptions = {
  /** Prefixo dos códigos de tarefa do workspace (`HUB` em `HUB-12`). */
  prefix?: string;
};

const TITLE_MAX = 300;
const EVIDENCE_MAX = 2000;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)[-*+][ \t]+\[([ xX])\][ \t]+(\S.*)$/;
const BOX = /^([ \t]*[-*+][ \t]+)\[[ xX]\]/;
const GATE = /(?:^|[\s(])(?:🔒\s*)?GATE\b/u;
const MILESTONE_TITLE = /^(✅\s*)?(?:(M\d+)\s*[—–-]\s*)?(.+)$/u;
/** Título com o código do marco (`## M3 — ...`): é marco mesmo sem itens. */
const MILESTONE_CODE = /^(✅\s*)?M\d+\s*[—–-]/u;
const UNPLANNED = /^sem marco$/i;
/** `<!-- hub: ignorar -->` numa seção `##`: a sincronização trata a seção como texto livre. */
const IGNORE = /^\s*<!--\s*hub:\s*(?:ignorar|ignore)\s*-->\s*$/i;
const NO_WORKSTREAM = /^tarefas sem frente$/i;

type LineKind =
  | { type: "heading"; level: number; title: string }
  | { type: "item"; indent: number; checked: boolean; rest: string }
  | { type: "blank" }
  | { type: "text"; indent: number }
  | { type: "ignore" }
  | { type: "fenced" };

/** Quebra o texto em linhas sem perder nenhum caractere. */
export function splitPlanLines(text: string): PlanLine[] {
  const lines: PlanLine[] = [];
  const eol = /\r?\n/g;
  let start = 0;
  for (let m = eol.exec(text); m; m = eol.exec(text)) {
    lines.push({ text: text.slice(start, m.index), eol: m[0] });
    start = m.index + m[0].length;
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: "" });
  return lines;
}

export function renderPlanFile(lines: PlanLine[]): string {
  return lines.map((l) => l.text + l.eol).join("");
}

function width(indent: string): number {
  return indent.replace(/\t/g, "    ").length;
}

/** Texto simples para o Hub: sem marcação de ênfase e de código, em uma linha. */
function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function classify(lines: PlanLine[]): LineKind[] {
  const kinds: LineKind[] = [];
  let fence: string | null = null;
  for (const { text } of lines) {
    const f = FENCE.exec(text);
    if (fence) {
      kinds.push({ type: "fenced" });
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      kinds.push({ type: "fenced" });
      continue;
    }
    const h = HEADING.exec(text);
    if (h) {
      kinds.push({ type: "heading", level: h[1].length, title: h[2].trim() });
      continue;
    }
    const i = ITEM.exec(text);
    if (i) {
      kinds.push({
        type: "item",
        indent: width(i[1]),
        checked: i[2] !== " ",
        rest: i[3],
      });
      continue;
    }
    kinds.push(
      text.trim() === ""
        ? { type: "blank" }
        : IGNORE.test(text)
          ? { type: "ignore" }
          : { type: "text", indent: width(/^[ \t]*/.exec(text)![0]) },
    );
  }
  return kinds;
}

/**
 * Seções `##`: as que são marcos (têm item ou GATE antes do próximo `#` ou `##`) e as
 * ignoradas (`<!-- hub: ignorar -->`), que ficam como texto livre.
 */
function sectionKinds(kinds: LineKind[]) {
  const milestones = new Set<number>();
  const ignored = new Set<number>();
  let section: number | null = null;
  let unplanned = false;
  for (let n = 0; n < kinds.length; n++) {
    const k = kinds[n];
    if (k.type === "heading" && k.level <= 2) {
      section = k.level === 2 ? n : null;
      unplanned = k.level === 2 && UNPLANNED.test(k.title);
      if (k.level === 2 && MILESTONE_CODE.test(k.title)) milestones.add(n);
      continue;
    }
    if (section === null) continue;
    if (k.type === "ignore") ignored.add(section);
    if (unplanned) continue;
    if (
      k.type === "item" ||
      (k.type === "heading" && k.level === 3 && GATE.test(k.title))
    ) {
      milestones.add(section);
    }
  }
  for (const n of ignored) milestones.delete(n);
  return { milestones, ignored };
}

/** Título, nota, evidência e risco a partir do texto do item (já sem o código). */
function describe(text: string) {
  let head = text;
  let note: string | null = null;
  // "**Título:** resto" — o título é o trecho em negrito que termina em dois-pontos.
  const bold = /^\*\*([^*]+?):\*\*\s*(.*)$/.exec(text);
  if (bold) {
    head = bold[1];
    note = bold[2].trim() || null;
  } else {
    const dash = text.indexOf(" — ");
    if (dash >= 0) {
      head = text.slice(0, dash);
      note = text.slice(dash + 3).trim() || null;
    }
  }
  const struck = /^~~.+~~/.test(head.trim());
  const title = clip(plain(head.replace(/~~/g, "")), TITLE_MAX);
  const found = note ? /evid[eê]ncia:\s*(.+)$/iu.exec(note) : null;
  const evidence = found ? clip(found[1].trim(), EVIDENCE_MAX) : null;
  return { title, note, evidence, struck };
}

/**
 * Lê o plan.md. Um título `##` vira marco quando traz o código (`## M3 — ...`) ou quando a
 * seção tem algum item ou um GATE; as outras seções (regras, registro, decisões) são texto
 * livre. `###` dentro de um marco é
 * frente, menos o GATE, cujos itens são critérios de aceite do marco. A seção "Sem marco"
 * (da exportação do Hub) guarda frentes e tarefas sem marco. Uma seção com a linha
 * `<!-- hub: ignorar -->` (decisões registradas como caixas, por exemplo) fica inteira
 * como texto livre.
 */
export function parsePlanFile(
  text: string,
  options: ParseOptions = {},
): ParsedPlanFile {
  const prefix = (options.prefix ?? "HUB").replace(/[^A-Z]/g, "");
  const lines = splitPlanLines(text);
  const kinds = classify(lines);
  const sections = sectionKinds(kinds);
  const parsed: ParsedPlanFile = {
    lines,
    title: null,
    milestones: [],
    workstreams: [],
    gates: [],
    items: [],
    unplanned: null,
    sections: [],
  };

  // Seções abertas, para anotar onde terminam.
  let openMilestone: number | null = null;
  let openWorkstream: number | null = null;
  let openGate: number | null = null;
  let openUnplanned = false;
  let openSection: number | null = null;
  const closeInner = (end: number) => {
    if (openWorkstream !== null) parsed.workstreams[openWorkstream].end = end;
    if (openGate !== null) parsed.gates[openGate].end = end;
    openWorkstream = null;
    openGate = null;
  };
  const closeAll = (end: number) => {
    closeInner(end);
    if (openMilestone !== null) parsed.milestones[openMilestone].end = end;
    if (openUnplanned && parsed.unplanned) parsed.unplanned.end = end;
    if (openSection !== null) parsed.sections[openSection].end = end;
    openMilestone = null;
    openUnplanned = false;
    openSection = null;
  };

  let milestone: number | null = null;
  let workstream: number | null = null;
  let ignored = false; // seção com <!-- hub: ignorar -->
  let inSection = false; // dentro de um marco ou da seção "Sem marco"
  let gateMode = false;
  let lastTop: number | null = null; // último item de nível 0 (pai das subtarefas)
  let open: { item: number; indent: number } | null = null; // aceita continuação

  for (let n = 0; n < kinds.length; n++) {
    const k = kinds[n];
    if (k.type === "heading") {
      open = null;
      if (k.level <= 2) {
        closeAll(n - 1);
        milestone = null;
        workstream = null;
        inSection = false;
        gateMode = false;
        lastTop = null;
        ignored = k.level === 2 && sections.ignored.has(n);
        if (k.level === 2) {
          openSection =
            parsed.sections.push({ line: n, end: n, title: plain(k.title) }) -
            1;
        }
        if (k.level === 1) {
          parsed.title ??= k.title;
        } else if (sections.milestones.has(n)) {
          const m = MILESTONE_TITLE.exec(k.title)!;
          milestone =
            parsed.milestones.push({
              line: n,
              end: n,
              code: m[2] ?? null,
              title: plain(m[3]),
              done: Boolean(m[1]),
              gate: null,
            }) - 1;
          openMilestone = milestone;
          inSection = true;
        } else {
          inSection = !ignored && UNPLANNED.test(k.title);
          if (inSection) {
            parsed.unplanned = { line: n, end: n };
            openUnplanned = true;
          }
        }
      } else if (k.level === 3 && inSection) {
        closeInner(n - 1);
        lastTop = null;
        if (GATE.test(k.title) && milestone !== null) {
          const gate =
            parsed.gates.push({
              line: n,
              end: n,
              milestone,
              title: plain(k.title),
            }) - 1;
          parsed.milestones[milestone].gate = gate;
          openGate = gate;
          gateMode = true;
          workstream = null;
        } else {
          gateMode = false;
          workstream = NO_WORKSTREAM.test(k.title)
            ? null
            : parsed.workstreams.push({
                line: n,
                end: n,
                title: plain(k.title),
                milestone,
              }) - 1;
          openWorkstream = workstream;
        }
      }
      continue;
    }

    if (k.type === "item" && !ignored) {
      const sub: boolean = k.indent >= 2 && lastTop !== null;
      const index: number =
        parsed.items.push({
          line: n,
          lastLine: n,
          checked: k.checked,
          depth: sub ? 1 : 0,
          parent: sub ? lastTop : null,
          kind: gateMode ? "criterion" : "task",
          milestone,
          workstream: gateMode ? null : workstream,
          text: k.rest,
          title: "",
          note: null,
          evidence: null,
          struck: false,
          code: null,
        }) - 1;
      if (!sub) lastTop = index;
      open = { item: index, indent: k.indent };
      continue;
    }

    // Continuação: texto com recuo maior que o do item, logo abaixo dele.
    if (k.type === "text" && open && k.indent > open.indent) {
      const item = parsed.items[open.item];
      item.lastLine = n;
      item.text = `${item.text} ${lines[n].text.trim()}`;
      continue;
    }
    open = null;
    if (k.type === "text" && k.indent === 0) lastTop = null;
  }
  closeAll(lines.length - 1);

  // O código é o último entre parênteses com o prefixo do workspace.
  const pattern = new RegExp(`\\((${prefix}-\\d{1,9})\\)`, "g");
  for (const item of parsed.items) {
    const last = [...item.text.matchAll(pattern)].at(-1);
    if (last && last.index !== undefined) {
      item.code = last[1];
      item.text = (
        item.text.slice(0, last.index) +
        item.text.slice(last.index + last[0].length)
      )
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    }
    Object.assign(item, describe(item.text));
  }
  return parsed;
}

export type ItemChange = {
  /** Índice do item em `items`. */
  item: number;
  checked?: boolean;
  /** Código para acrescentar no fim do item, se ele ainda não tiver. */
  code?: string;
};

/**
 * Aplica as mudanças nos itens e devolve o arquivo novo. Só muda a caixa do item (`[ ]` ou
 * `[x]`) e acrescenta o código no fim dele, na última linha do item; o resto do arquivo
 * volta byte a byte.
 */
export function applyItemChanges(
  parsed: ParsedPlanFile,
  changes: ItemChange[],
): string {
  const lines = parsed.lines.slice();
  for (const change of changes) {
    const item = parsed.items[change.item];
    if (!item) throw new Error(`Item ${change.item} não existe no arquivo.`);
    if (change.checked !== undefined && change.checked !== item.checked) {
      const first = lines[item.line];
      lines[item.line] = {
        ...first,
        text: first.text.replace(BOX, `$1[${change.checked ? "x" : " "}]`),
      };
    }
    if (change.code && !item.code) {
      const last = lines[item.lastLine];
      const body = last.text.replace(/[ \t]+$/, "");
      lines[item.lastLine] = {
        ...last,
        text: `${body} (${change.code})${last.text.slice(body.length)}`,
      };
    }
  }
  return renderPlanFile(lines);
}
