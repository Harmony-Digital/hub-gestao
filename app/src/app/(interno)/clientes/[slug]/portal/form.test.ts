import { describe, expect, it } from "vitest";
import { parseContactForm, parseContactIdForm } from "./form";

const CLIENT = "6f1c2a1e-1111-4a2b-8c3d-123456789abc";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("formulário de novo contato", () => {
  it("lê o contato, com o e-mail em minúsculas e o nome sem espaços sobrando", () => {
    expect(
      parseContactForm(
        form({
          client_id: CLIENT,
          name: "  Ana   Souza ",
          email: " Ana@Clinica.COM.br ",
          role: "client_approver",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        clientId: CLIENT,
        name: "Ana Souza",
        email: "ana@clinica.com.br",
        role: "client_approver",
      },
    });
  });

  it("recusa cliente, nome, e-mail e papel inválidos", () => {
    const base = {
      client_id: CLIENT,
      name: "Ana",
      email: "ana@clinica.com.br",
      role: "client_viewer",
    };
    expect(parseContactForm(form({ ...base, client_id: "x" }))).toMatchObject({
      ok: false,
    });
    expect(parseContactForm(form({ ...base, name: "  " }))).toEqual({
      ok: false,
      message: "Diga o nome do contato.",
    });
    expect(
      parseContactForm(form({ ...base, name: "a".repeat(121) })),
    ).toMatchObject({ ok: false });
    expect(parseContactForm(form({ ...base, email: "ana@clinica" }))).toEqual({
      ok: false,
      message: "Confira o e-mail do contato.",
    });
    expect(parseContactForm(form({ ...base, role: "owner" }))).toEqual({
      ok: false,
      message: "Escolha o que o contato pode fazer.",
    });
  });
});

describe("formulário de acesso de um contato", () => {
  it("aceita só o id do contato", () => {
    expect(parseContactIdForm(form({ contact_id: CLIENT }))).toEqual({
      ok: true,
      value: CLIENT,
    });
    expect(parseContactIdForm(form({ contact_id: "1; drop" }))).toMatchObject({
      ok: false,
    });
  });
});
