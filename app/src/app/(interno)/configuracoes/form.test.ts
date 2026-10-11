import { describe, expect, it } from "vitest";
import {
  parseDepartmentForm,
  parseLabelForm,
  parseRetentionForm,
  parseDepartmentLeadForm,
  parseDepartmentRemoveForm,
  parseMemberForm,
  parseMemberRoleForm,
  parseMemberStatusForm,
  parseWorkspaceNameForm,
} from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const OTHER = "0b7f3f0e-58a4-4d7c-9a51-0a0f5c2d2f6e";

function form(values: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of values) data.append(key, value);
  return data;
}

describe("formulários das Configurações", () => {
  it("lê o nome do workspace, numa linha só", () => {
    expect(parseWorkspaceNameForm(form([["name", "  Harmony  "]]))).toEqual({
      ok: true,
      value: "Harmony",
    });
    expect(parseWorkspaceNameForm(form([["name", " "]]))).toEqual({
      ok: false,
      message: "Dê um nome ao workspace.",
    });
    expect(parseWorkspaceNameForm(form([["name", "a\nb"]])).ok).toBe(false);
    expect(parseWorkspaceNameForm(form([["name", "x".repeat(121)]])).ok).toBe(
      false,
    );
  });

  it("lê a pessoa nova: nome, e-mail em minúsculas e o papel (nunca dono)", () => {
    expect(
      parseMemberForm(
        form([
          ["name", " Pessoa Nova "],
          ["email", " Nova@Harmony.TEST "],
          ["role", "admin"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: { name: "Pessoa Nova", email: "nova@harmony.test", role: "admin" },
    });
    expect(
      parseMemberForm(
        form([
          ["name", "Pessoa"],
          ["email", "sem-arroba"],
          ["role", "member"],
        ]),
      ),
    ).toEqual({ ok: false, message: "E-mail inválido." });
    expect(
      parseMemberForm(
        form([
          ["name", "Pessoa"],
          ["email", "p@harmony.test"],
          ["role", "owner"],
        ]),
      ),
    ).toEqual({ ok: false, message: "Escolha o papel da pessoa." });
    expect(
      parseMemberForm(
        form([
          ["email", "p@harmony.test"],
          ["role", "member"],
        ]),
      ),
    ).toEqual({ ok: false, message: "Escreva o nome da pessoa." });
  });

  it("lê a mudança de papel e de acesso só com id válido e valores conhecidos", () => {
    expect(
      parseMemberRoleForm(
        form([
          ["profile_id", ID],
          ["role", "member"],
        ]),
      ),
    ).toEqual({ ok: true, value: { profileId: ID, role: "member" } });
    expect(
      parseMemberRoleForm(
        form([
          ["profile_id", ID],
          ["role", "owner"],
        ]),
      ).ok,
    ).toBe(false);
    expect(
      parseMemberStatusForm(
        form([
          ["profile_id", ID],
          ["status", "suspended"],
        ]),
      ),
    ).toEqual({ ok: true, value: { profileId: ID, status: "suspended" } });
    expect(
      parseMemberStatusForm(
        form([
          ["profile_id", "1"],
          ["status", "active"],
        ]),
      ),
    ).toEqual({ ok: false, message: "Recarregue a página e tente de novo." });
  });

  it("lê o responsável do departamento, com ninguém como opção", () => {
    expect(
      parseDepartmentLeadForm(
        form([
          ["department_id", ID],
          ["profile_id", OTHER],
        ]),
      ),
    ).toEqual({ ok: true, value: { departmentId: ID, profileId: OTHER } });
    expect(
      parseDepartmentLeadForm(
        form([
          ["department_id", ID],
          ["profile_id", ""],
        ]),
      ),
    ).toEqual({ ok: true, value: { departmentId: ID, profileId: null } });
    expect(
      parseDepartmentLeadForm(
        form([
          ["department_id", ID],
          ["profile_id", "x"],
        ]),
      ).ok,
    ).toBe(false);
  });
});

describe("departamento (RF-27)", () => {
  const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
  const data = (values: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.append(k, v);
    return f;
  };
  it("lê o nome e a cor; com o id, é edição", () => {
    expect(
      parseDepartmentForm(data({ name: " Eventos ", color: "#aa5500" })),
    ).toEqual({
      ok: true,
      value: { id: null, name: "Eventos", color: "#AA5500" },
    });
    expect(
      parseDepartmentForm(
        data({ department_id: ID, name: "Eventos", color: "#AA5500" }),
      ),
    ).toEqual({
      ok: true,
      value: { id: ID, name: "Eventos", color: "#AA5500" },
    });
  });
  it("recusa nome vazio, cor fora do formato e id estranho", () => {
    expect(parseDepartmentForm(data({ name: "", color: "#000000" })).ok).toBe(
      false,
    );
    expect(parseDepartmentForm(data({ name: "X", color: "vermelho" })).ok).toBe(
      false,
    );
    expect(
      parseDepartmentForm(
        data({ department_id: "x", name: "X", color: "#000000" }),
      ).ok,
    ).toBe(false);
    expect(parseDepartmentRemoveForm(data({ department_id: ID }))).toEqual({
      ok: true,
      value: ID,
    });
    expect(parseDepartmentRemoveForm(data({})).ok).toBe(false);
  });
});

describe("prazos de retenção (PRD §12)", () => {
  const all = {
    agent_denials: "90",
    webhook_deliveries: "30",
    jobs_done: "30",
    jobs_failed: "90",
    notifications_read: "180",
    portal_sessions: "90",
    agent_runs: "365",
  };
  const fd = (values: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  };
  it("lê os dias de cada registro e recusa fora da faixa ou sem número", () => {
    expect(parseRetentionForm(fd({ ...all, agent_runs: "120" }))).toEqual({
      ok: true,
      value: {
        ...Object.fromEntries(
          Object.entries(all).map(([k, v]) => [k, Number(v)]),
        ),
        agent_runs: 120,
      },
    });
    expect(parseRetentionForm(fd({ ...all, jobs_done: "3" }))).toEqual({
      ok: false,
      message: "Jobs concluídos: de 7 a 365 dias.",
    });
    expect(
      parseRetentionForm(fd({ ...all, agent_denials: "noventa" })).ok,
    ).toBe(false);
  });
});

describe("etiqueta (RF-18)", () => {
  const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
  const fd = (values: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  };
  it("lê nome e cor; recusa vírgula, nome longo e cor fora do formato", () => {
    expect(
      parseLabelForm(fd({ label_id: ID, name: " Urgente ", color: "#aa5500" })),
    ).toEqual({
      ok: true,
      value: { id: ID, name: "Urgente", color: "#AA5500" },
    });
    expect(
      parseLabelForm(fd({ label_id: ID, name: "a,b", color: "#aa5500" })).ok,
    ).toBe(false);
    expect(
      parseLabelForm(
        fd({ label_id: ID, name: "x".repeat(41), color: "#aa5500" }),
      ).ok,
    ).toBe(false);
    expect(
      parseLabelForm(fd({ label_id: ID, name: "Ok", color: "laranja" })).ok,
    ).toBe(false);
    expect(
      parseLabelForm(fd({ label_id: "x", name: "Ok", color: "#aa5500" })).ok,
    ).toBe(false);
  });
});
