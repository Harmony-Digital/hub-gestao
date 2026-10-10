import { describe, expect, it } from "vitest";
import {
  assigneeValue,
  changedTaskFields,
  parseAssignee,
  parseChecklistForm,
  parseCommentForm,
  parseDependencyForm,
  parseInlineEdit,
  parseMoveForm,
  parseNewTaskForm,
  parseReorderForm,
  parseTaskFieldsForm,
  parseViewForm,
} from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const WS = "7b1cc803-4c2f-423e-87dc-33d394046350";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("responsável", () => {
  it("lê pessoa, agente e ninguém, e recusa o resto", () => {
    expect(parseAssignee("")).toEqual({ ok: true, value: null });
    expect(parseAssignee(`agent:${ID}`)).toEqual({
      ok: true,
      value: { type: "agent", id: ID },
    });
    expect(parseAssignee(`user:${ID.toUpperCase()}`)).toEqual({
      ok: true,
      value: { type: "user", id: ID },
    });
    expect(parseAssignee(`system:${ID}`).ok).toBe(false);
    expect(parseAssignee("agent:abc").ok).toBe(false);
  });

  it("monta o valor do campo a partir da tarefa", () => {
    expect(assigneeValue({ type: "agent", id: ID })).toBe(`agent:${ID}`);
    expect(assigneeValue({ type: "system", id: null })).toBe("");
    expect(assigneeValue(null)).toBe("");
  });
});

describe("mudança de status", () => {
  it("exige código, versão inteira e status válidos", () => {
    expect(
      parseMoveForm(
        form({
          code: "HUB-12",
          version: "3",
          status_id: WS,
          reason: " x \r\n y ",
        }),
      ),
    ).toEqual({
      ok: true,
      value: { code: "HUB-12", version: 3, status_id: WS, reason: "x \n y" },
    });
    expect(parseMoveForm(form({ code: "hub-1", status_id: WS })).ok).toBe(
      false,
    );
    expect(
      parseMoveForm(form({ code: "HUB-1", version: "1.5", status_id: WS })).ok,
    ).toBe(false);
    expect(parseMoveForm(form({ code: "HUB-1", status_id: "x" })).ok).toBe(
      false,
    );
    expect(
      parseMoveForm(
        form({ code: "HUB-1", status_id: WS, evidence: "a".repeat(2001) }),
      ).ok,
    ).toBe(false);
  });
});

describe("campos da tarefa", () => {
  it("lê só os campos enviados", () => {
    const parsed = parseTaskFieldsForm(
      form({ code: "HUB-3", version: "7", priority: "high", due_date: "" }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        code: "HUB-3",
        version: 7,
        fields: { priority: "high", due_date: null },
      },
    });
  });

  it("recusa título vazio, com quebra de linha ou longo, e data estranha", () => {
    const base = { code: "HUB-3", version: "1" };
    expect(parseTaskFieldsForm(form({ ...base, title: "  " })).ok).toBe(false);
    expect(parseTaskFieldsForm(form({ ...base, title: "a\nb" })).ok).toBe(
      false,
    );
    expect(
      parseTaskFieldsForm(form({ ...base, title: "a".repeat(301) })).ok,
    ).toBe(false);
    expect(
      parseTaskFieldsForm(form({ ...base, due_date: "20/10/2026" })).ok,
    ).toBe(false);
    expect(parseTaskFieldsForm(form({ ...base, priority: "max" })).ok).toBe(
      false,
    );
  });

  it("descrição: quebras do navegador viram \\n e vazio vira nulo", () => {
    const parsed = parseTaskFieldsForm(
      form({ code: "HUB-3", description_md: "linha 1\r\nlinha 2\r\n" }),
    );
    expect(parsed.ok && parsed.value.fields.description_md).toBe(
      "linha 1\nlinha 2",
    );
    const empty = parseTaskFieldsForm(
      form({ code: "HUB-3", description_md: "   " }),
    );
    expect(empty.ok && empty.value.fields.description_md).toBeNull();
  });

  it("compara com a tarefa atual e devolve só o que mudou", () => {
    const current = {
      title: "Mapear",
      description_md: "texto",
      priority: "normal",
      assignee: { type: "agent", id: ID },
      due_date: "2026-10-20",
      workstream: { id: WS },
    };
    expect(
      changedTaskFields(current, {
        title: "Mapear",
        description_md: "texto",
        priority: "normal",
        assignee: { type: "agent", id: ID },
        due_date: "2026-10-20",
        workstream_id: WS,
      }),
    ).toEqual({});
    expect(
      changedTaskFields(current, {
        title: "Mapear o caso",
        priority: "urgent",
        assignee: null,
        due_date: null,
        workstream_id: null,
      }),
    ).toEqual({
      title: "Mapear o caso",
      priority: "urgent",
      assignee: null,
      due_date: null,
      workstream_id: null,
    });
  });
});

describe("comentário", () => {
  it("exige texto e respeita o limite", () => {
    expect(parseCommentForm(form({ code: "HUB-3", body: " oi \r\n" }))).toEqual(
      {
        ok: true,
        value: { code: "HUB-3", body_md: "oi", mentions: [] },
      },
    );
    expect(parseCommentForm(form({ code: "HUB-3", body: "  " })).ok).toBe(
      false,
    );
    expect(
      parseCommentForm(form({ code: "HUB-3", body: "a".repeat(10001) })).ok,
    ).toBe(false);
  });
});

describe("nova tarefa", () => {
  it("monta a entrada só com o que foi preenchido", () => {
    expect(
      parseNewTaskForm(
        form({
          project: "EXE",
          title: " Mapear o caso ",
          priority: "",
          assignee: "",
          due_date: "",
          workstream_id: "",
          description_md: "",
        }),
      ),
    ).toEqual({
      ok: true,
      value: { project: "EXE", title: "Mapear o caso", priority: "normal" },
    });
    expect(
      parseNewTaskForm(
        form({
          project: "EXE",
          title: "Mapear",
          priority: "high",
          assignee: `agent:${ID}`,
          due_date: "2026-10-20",
          workstream_id: WS,
          description_md: "Contexto",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        project: "EXE",
        title: "Mapear",
        priority: "high",
        assignee: { type: "agent", id: ID },
        due_date: "2026-10-20",
        workstream_id: WS,
        description_md: "Contexto",
      },
    });
  });

  it("recusa projeto inválido e título vazio", () => {
    expect(parseNewTaskForm(form({ project: "exe", title: "x" })).ok).toBe(
      false,
    );
    const semTitulo = parseNewTaskForm(form({ project: "EXE", title: " " }));
    expect(semTitulo).toEqual({ ok: false, message: "Dê um título à tarefa." });
  });
});

describe("checklist e dependências", () => {
  const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
  const fd = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.append(k, v);
    return data;
  };

  it("lê as quatro operações do checklist", () => {
    expect(
      parseChecklistForm(fd({ op: "add", code: "HUB-3", text: " Saudação " })),
    ).toEqual({
      ok: true,
      value: { op: "add", code: "HUB-3", text: "Saudação" },
    });
    expect(
      parseChecklistForm(fd({ op: "toggle", id: ID, done: "true" })),
    ).toEqual({ ok: true, value: { op: "toggle", id: ID, done: true } });
    expect(
      parseChecklistForm(fd({ op: "rename", id: ID, text: "Despedida" })),
    ).toEqual({ ok: true, value: { op: "rename", id: ID, text: "Despedida" } });
    expect(parseChecklistForm(fd({ op: "remove", id: ID }))).toEqual({
      ok: true,
      value: { op: "remove", id: ID },
    });
  });

  it("recusa item vazio, id torto e operação desconhecida", () => {
    expect(
      parseChecklistForm(fd({ op: "add", code: "HUB-3", text: "  " })).ok,
    ).toBe(false);
    expect(
      parseChecklistForm(fd({ op: "toggle", id: "x", done: "true" })).ok,
    ).toBe(false);
    expect(
      parseChecklistForm(fd({ op: "toggle", id: ID, done: "sim" })).ok,
    ).toBe(false);
    expect(parseChecklistForm(fd({ op: "apagar", id: ID })).ok).toBe(false);
  });

  it("dependência pelo código, em maiúsculas, nunca a própria tarefa", () => {
    expect(
      parseDependencyForm(fd({ op: "add", code: "HUB-3", other: " hub-7 " })),
    ).toEqual({
      ok: true,
      value: { op: "add", code: "HUB-3", other: "HUB-7" },
    });
    expect(
      parseDependencyForm(fd({ op: "add", code: "HUB-3", other: "HUB-3" })).ok,
    ).toBe(false);
    expect(
      parseDependencyForm(fd({ op: "add", code: "HUB-3", other: "sete" })).ok,
    ).toBe(false);
  });
});

describe("comentário com menções", () => {
  const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
  const fd = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.append(k, v);
    return data;
  };
  it("lê as menções do campo escondido e recusa o que não for pessoa ou agente", () => {
    expect(
      parseCommentForm(
        fd({
          code: "HUB-3",
          body: "Oi @Ana",
          mentions: JSON.stringify([{ type: "user", id: ID }]),
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        code: "HUB-3",
        body_md: "Oi @Ana",
        mentions: [{ type: "user", id: ID }],
      },
    });
    expect(parseCommentForm(fd({ code: "HUB-3", body: "Oi" }))).toMatchObject({
      ok: true,
      value: { mentions: [] },
    });
    expect(
      parseCommentForm(
        fd({
          code: "HUB-3",
          body: "Oi",
          mentions: JSON.stringify([{ type: "client", id: ID }]),
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseCommentForm(fd({ code: "HUB-3", body: "Oi", mentions: "{" })).ok,
    ).toBe(false);
  });
});

describe("edição na linha e visões salvas", () => {
  const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
  const fd = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.append(k, v);
    return data;
  };
  it("lê cada campo editável e exige a versão", () => {
    const base = { code: "HUB-3", version: "4" };
    expect(
      parseInlineEdit(fd({ ...base, field: "priority", value: "high" })),
    ).toEqual({
      ok: true,
      value: {
        code: "HUB-3",
        version: 4,
        change: { field: "priority", value: "high" },
      },
    });
    expect(
      parseInlineEdit(fd({ ...base, field: "assignee", value: `agent:${ID}` })),
    ).toMatchObject({
      ok: true,
      value: { change: { value: { type: "agent", id: ID } } },
    });
    expect(
      parseInlineEdit(fd({ ...base, field: "assignee", value: "" })),
    ).toMatchObject({
      ok: true,
      value: { change: { field: "assignee", value: null } },
    });
    expect(
      parseInlineEdit(fd({ ...base, field: "due_date", value: "" })),
    ).toMatchObject({
      ok: true,
      value: { change: { field: "due_date", value: null } },
    });
    expect(
      parseInlineEdit(fd({ ...base, field: "status", value: ID })).ok,
    ).toBe(true);
    expect(
      parseInlineEdit(fd({ code: "HUB-3", field: "priority", value: "high" }))
        .ok,
    ).toBe(false);
    expect(
      parseInlineEdit(fd({ ...base, field: "titulo", value: "x" })).ok,
    ).toBe(false);
    expect(
      parseInlineEdit(fd({ ...base, field: "priority", value: "max" })).ok,
    ).toBe(false);
  });
  it("visão salva com nome e filtros", () => {
    expect(
      parseViewForm(
        fd({
          project: "EXE",
          type: "list",
          name: " Urgentes ",
          query: "prio=urgent",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        project: "EXE",
        type: "list",
        name: "Urgentes",
        query: "prio=urgent",
      },
    });
    expect(
      parseViewForm(fd({ project: "EXE", type: "list", name: " " })).ok,
    ).toBe(false);
    expect(
      parseViewForm(fd({ project: "EXE", type: "mapa", name: "x" })).ok,
    ).toBe(false);
  });
});

describe("ordem no quadro", () => {
  const fd = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(values)) data.append(k, v);
    return data;
  };
  it("lê os códigos na ordem e recusa formato torto", () => {
    expect(
      parseReorderForm(fd({ project: "EXE", codes: "HUB-9,HUB-12" })),
    ).toEqual({
      ok: true,
      value: { project: "EXE", codes: ["HUB-9", "HUB-12"] },
    });
    expect(parseReorderForm(fd({ project: "EXE", codes: "" })).ok).toBe(false);
    expect(parseReorderForm(fd({ project: "EXE", codes: "HUB-9,x" })).ok).toBe(
      false,
    );
  });
});
