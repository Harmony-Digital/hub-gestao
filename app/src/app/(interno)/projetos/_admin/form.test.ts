import { describe, expect, it } from "vitest";
import { parseClientForm, parseProjectForm } from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

const base = {
  mode: "create",
  code: "cli2",
  name: " Atendimento da clínica ",
  client: ID,
  phase: "validar",
  status: "active",
  objective_internal: "Agendar\r\nsem humano",
  objective_client: "",
  start_date: "2026-10-12",
  target_date: "2026-12-18",
  owner_profile_id: ID,
  pm_agent_id: "",
  repo_url: "https://github.com/Harmony-Digital/x",
  plan_path: "PLAN.md",
  require_evidence: "on",
  department: ["sistemas", "design", "sistemas", "Mau Slug"],
};

describe("formulário de projeto", () => {
  it("lê tudo, com código em maiúsculas e departamentos válidos sem repetir", () => {
    const parsed = parseProjectForm(form(base));
    expect(parsed).toEqual({
      ok: true,
      value: {
        mode: "create",
        code: "CLI2",
        clientId: ID,
        newClientName: null,
        expectedUpdatedAt: null,
        template: null,
        fields: {
          name: "Atendimento da clínica",
          phase: "validar",
          status: "active",
          objective_internal: "Agendar\nsem humano",
          objective_client: null,
          start_date: "2026-10-12",
          target_date: "2026-12-18",
          owner_profile_id: ID,
          pm_agent_id: null,
          repo_url: "https://github.com/Harmony-Digital/x",
          plan_path: "PLAN.md",
          require_evidence: true,
          client_can_confirm_receipt: false,
          email_client_reports: false,
          departments: ["sistemas", "design"],
        },
      },
    });
  });

  it("cliente novo pede o nome; edição traz a versão lida", () => {
    const novo = parseProjectForm(
      form({ ...base, client: "novo", new_client_name: "Ótica Central" }),
    );
    expect(novo.ok && novo.value.newClientName).toBe("Ótica Central");
    expect(novo.ok && novo.value.clientId).toBeNull();
    expect(parseProjectForm(form({ ...base, client: "novo" })).ok).toBe(false);

    const edit = parseProjectForm(
      form({ ...base, mode: "edit", updated_at: "2026-10-10T11:00:00.000Z" }),
    );
    expect(edit.ok && edit.value.expectedUpdatedAt).toBe(
      "2026-10-10T11:00:00.000Z",
    );
  });

  it("o modelo vale só na criação; id estranho pede para recarregar", () => {
    const withTemplate = parseProjectForm(form({ ...base, template: ID }));
    expect(withTemplate.ok && withTemplate.value.template).toBe(ID);
    const edit = parseProjectForm(
      form({ ...base, mode: "edit", template: ID }),
    );
    expect(edit.ok && edit.value.template).toBeNull();
    expect(parseProjectForm(form({ ...base, template: "x" })).ok).toBe(false);
  });

  it("recusa código, cliente, fase, status, datas e repositório inválidos", () => {
    const bad = (over: Record<string, string>) =>
      parseProjectForm(form({ ...base, ...over }));
    expect(bad({ code: "C" }).ok).toBe(false);
    expect(bad({ code: "TOO-LONG1" }).ok).toBe(false);
    expect(bad({ client: "" }).ok).toBe(false);
    expect(bad({ phase: "concluir" }).ok).toBe(false);
    expect(bad({ status: "archived" }).ok).toBe(false);
    expect(bad({ status: "in_review" }).ok).toBe(false);
    expect(bad({ start_date: "2026-12-30" })).toEqual({
      ok: false,
      message: "A previsão de entrega não pode ser antes do início.",
    });
    expect(bad({ repo_url: "http://inseguro.com" }).ok).toBe(false);
    expect(bad({ name: "Linha\nquebrada" }).ok).toBe(false);
    expect(bad({ owner_profile_id: "x" }).ok).toBe(false);
  });
});

describe("formulário de cliente", () => {
  it("cadastra sem id e edita com id", () => {
    expect(
      parseClientForm(
        form({ name: " Clínica ", segment: " Saúde ", notes_internal: "" }),
      ),
    ).toEqual({
      ok: true,
      value: {
        id: null,
        name: "Clínica",
        segment: "Saúde",
        notes_internal: null,
        accent_color: null,
      },
    });
    const edit = parseClientForm(form({ id: ID, name: "Clínica" }));
    expect(edit.ok && edit.value.id).toBe(ID);
    expect(parseClientForm(form({ id: "x", name: "Clínica" })).ok).toBe(false);
    expect(parseClientForm(form({ name: "  " })).ok).toBe(false);
  });

  it("cor de destaque do portal: código com # e seis caracteres, ou vazia", () => {
    const accent = (accent_color: string) =>
      parseClientForm(form({ name: "Clínica", accent_color }));
    expect(accent(" #2e7d6b ")).toMatchObject({
      ok: true,
      value: { accent_color: "#2E7D6B" },
    });
    expect(accent("")).toMatchObject({
      ok: true,
      value: { accent_color: null },
    });
    expect(accent("verde").ok).toBe(false);
    expect(accent("#2E7D6").ok).toBe(false);
    expect(accent("#2E7D6B;}").ok).toBe(false);
  });
});
