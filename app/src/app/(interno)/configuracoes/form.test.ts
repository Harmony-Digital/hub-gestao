import { describe, expect, it } from "vitest";
import {
  parseDepartmentLeadForm,
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
