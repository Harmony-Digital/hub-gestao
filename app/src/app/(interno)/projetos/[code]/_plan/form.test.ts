import { describe, expect, it } from "vitest";
import {
  parseAcceptanceForm,
  parseMilestoneForm,
  parseWorkstreamForm,
  workstreamChanges,
} from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("formulário de marco", () => {
  const base = {
    project: "EXE",
    title: " Painel da recepção ",
    title_client: " Painel para a sua recepção ",
    description_client: "",
    due_date: "2026-11-30",
    status: "planned",
    client_visible: "on",
  };

  it("lê os critérios na ordem, sem os vazios, com o marcado como feito", () => {
    const parsed = parseMilestoneForm(
      form({
        ...base,
        "criteria.2.text": "Aviso de chegada",
        "criteria.0.text": " Fila do dia ",
        "criteria.0.done": "on",
        "criteria.1.text": "  ",
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        project: "EXE",
        id: null,
        input: {
          title: "Painel da recepção",
          title_client: "Painel para a sua recepção",
          description_client: null,
          due_date: "2026-11-30",
          status: "planned",
          visibility: "client",
          acceptance_criteria: [
            { text: "Fila do dia", done: true },
            { text: "Aviso de chegada", done: false },
          ],
        },
      },
    });
  });

  it("na edição traz o motivo da data; sem a caixa marcada, fica interno", () => {
    const parsed = parseMilestoneForm(
      form({
        ...base,
        id: ID,
        client_visible: "",
        date_reason: " A clínica pediu. ",
      }),
    );
    expect(parsed.ok && parsed.value.input.visibility).toBe("internal");
    expect(parsed.ok && parsed.value.input.date_reason).toBe(
      "A clínica pediu.",
    );
  });

  it("o cliente só vê o marco com o título escrito para ele", () => {
    expect(parseMilestoneForm(form({ ...base, title_client: " " }))).toEqual({
      ok: false,
      message: "Para o cliente ver o marco, escreva o título que ele vai ver.",
    });
    const internal = parseMilestoneForm(
      form({ ...base, title_client: "", client_visible: "" }),
    );
    expect(internal.ok && internal.value.input).toMatchObject({
      title_client: null,
      visibility: "internal",
    });
  });

  it("recusa título vazio, status de aceite, data e critério longo", () => {
    expect(parseMilestoneForm(form({ ...base, title: " " })).ok).toBe(false);
    expect(parseMilestoneForm(form({ ...base, status: "accepted" })).ok).toBe(
      false,
    );
    expect(parseMilestoneForm(form({ ...base, due_date: "30/11" })).ok).toBe(
      false,
    );
    expect(
      parseMilestoneForm(form({ ...base, "criteria.0.text": "a".repeat(301) }))
        .ok,
    ).toBe(false);
    expect(parseMilestoneForm(form({ ...base, project: "exe" })).ok).toBe(
      false,
    );
  });
});

describe("formulário de frente", () => {
  const base = {
    project: "EXE",
    title: "Integração com a agenda",
    milestone: "M2",
    department: "sistemas",
    status: "in_progress",
    description_internal: "",
    assignee: `agent:${ID}`,
  };

  it("lê os campos; sem a parte do cliente, não mexe na visibilidade", () => {
    expect(parseWorkstreamForm(form(base))).toEqual({
      ok: true,
      value: {
        project: "EXE",
        id: null,
        fields: {
          title: "Integração com a agenda",
          milestone: "M2",
          department: "sistemas",
          status: "in_progress",
          description_internal: null,
          assignee: { type: "agent", id: ID },
        },
        visibility: null,
      },
    });
  });

  it("com a parte do cliente: mostrar exige o título para o cliente", () => {
    const shown = parseWorkstreamForm(
      form({
        ...base,
        visibility_section: "1",
        client_visible: "on",
        title_client: "Agenda conectada",
      }),
    );
    expect(shown.ok && shown.value.visibility).toEqual({
      visibility: "client",
      title_client: "Agenda conectada",
      description_client: null,
    });
    expect(
      parseWorkstreamForm(
        form({ ...base, visibility_section: "1", client_visible: "on" }),
      ),
    ).toEqual({
      ok: false,
      message:
        "Para mostrar a frente ao cliente, escreva o título que ele vai ver.",
    });
  });

  it("recusa marco, departamento, status e responsável inválidos", () => {
    const bad = (over: Record<string, string>) =>
      parseWorkstreamForm(form({ ...base, ...over })).ok;
    expect(bad({ milestone: "2" })).toBe(false);
    expect(bad({ department: "Sistemas" })).toBe(false);
    expect(bad({ status: "accepted" })).toBe(false);
    expect(bad({ assignee: "system:x" })).toBe(false);
    expect(bad({ title: "" })).toBe(false);
  });
});

describe("o que mudou na frente", () => {
  const current = {
    title: "Integração com a agenda",
    milestone: { code: "M2" },
    department: { slug: "sistemas" },
    status: "in_progress",
    description_internal: "",
    assignee: { type: "agent", id: ID },
    visibility: "internal",
    title_client: null,
    description_client: null,
  };
  const fields = {
    title: "Integração com a agenda",
    milestone: "M2",
    department: "sistemas",
    status: "in_progress" as const,
    description_internal: null,
    assignee: { type: "agent" as const, id: ID },
  };

  it("salvar sem mexer em nada não muda nada", () => {
    expect(workstreamChanges(current, { fields, visibility: null })).toEqual({
      fields: {},
      visibility: false,
    });
    expect(
      workstreamChanges(current, {
        fields,
        visibility: {
          visibility: "internal",
          title_client: null,
          description_client: null,
        },
      }).visibility,
    ).toBe(false);
  });

  it("devolve só os campos alterados e avisa quando a parte do cliente mudou", () => {
    expect(
      workstreamChanges(current, {
        fields: { ...fields, milestone: null, assignee: null, status: "done" },
        visibility: {
          visibility: "client",
          title_client: "Agenda conectada",
          description_client: null,
        },
      }),
    ).toEqual({
      fields: { milestone: null, assignee: null, status: "done" },
      visibility: true,
    });
  });
});

describe("pedido de aceite", () => {
  it("aceita só o id do marco", () => {
    expect(parseAcceptanceForm(form({ id: ID }))).toEqual({
      ok: true,
      value: { id: ID },
    });
    expect(parseAcceptanceForm(form({ id: "M2" })).ok).toBe(false);
  });
});
