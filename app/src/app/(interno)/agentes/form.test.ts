import { describe, expect, it } from "vitest";
import { AGENT_SCOPES, FORBIDDEN_AGENT_SCOPES } from "@/lib/agent-keys";
import {
  DEFAULT_KEY_SCOPES,
  KEY_SCOPES,
  parseAgentEditForm,
  parseAgentStatusForm,
  parseBudget,
  parseNewAgentForm,
  parseNewKeyForm,
  parseRevokeForm,
  SCOPE_LABELS,
} from "./form";

const AGENT_ID = "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90";

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("permissões oferecidas na tela", () => {
  it("são as do núcleo, menos o acesso amplo, que entra por opção própria", () => {
    expect([...KEY_SCOPES].sort()).toEqual(
      AGENT_SCOPES.filter((s) => s !== "workspace:*").sort(),
    );
  });

  it("todas têm rótulo em português e nenhuma é proibida", () => {
    for (const scope of KEY_SCOPES) {
      expect(SCOPE_LABELS[scope].length).toBeGreaterThan(3);
      expect(FORBIDDEN_AGENT_SCOPES as readonly string[]).not.toContain(scope);
    }
    expect(DEFAULT_KEY_SCOPES.every((s) => KEY_SCOPES.includes(s))).toBe(true);
  });
});

describe("cadastro de agente", () => {
  it("aceita nome e tipo válidos", () => {
    expect(
      parseNewAgentForm(
        form([
          ["name", "  Claude Code do Fábio "],
          ["kind", "session"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: { name: "Claude Code do Fábio", kind: "session" },
    });
  });

  it.each([
    ["sem nome", [["kind", "session"]]],
    [
      "nome com quebra de linha",
      [
        ["name", "linha 1\nlinha 2"],
        ["kind", "session"],
      ],
    ],
    [
      "tipo desconhecido",
      [
        ["name", "X"],
        ["kind", "root"],
      ],
    ],
  ] as [string, [string, string][]][])("recusa %s", (_label, entries) => {
    expect(parseNewAgentForm(form(entries)).ok).toBe(false);
  });
});

describe("detalhes do agente", () => {
  it("cadastro leva departamento, missão e orçamento quando preenchidos", () => {
    expect(
      parseNewAgentForm(
        form([
          ["name", "Kratos"],
          ["kind", "hermes"],
          ["department", "gestao"],
          ["mission", "  Gerir os projetos.  "],
          ["budget", "12,50"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Kratos",
        kind: "hermes",
        department: "gestao",
        mission: "Gerir os projetos.",
        budget_usd_month: 12.5,
      },
    });
  });

  it("orçamento: vazio é zero; vírgula ou ponto; até 10.000 e 2 casas", () => {
    expect(parseBudget("")).toEqual({ ok: true, value: 0 });
    expect(parseBudget(" 20 ")).toEqual({ ok: true, value: 20 });
    expect(parseBudget("7.25")).toEqual({ ok: true, value: 7.25 });
    expect(parseBudget("10000")).toEqual({ ok: true, value: 10_000 });
    for (const bad of ["10001", "-5", "1,234", "abc", "1e3", "20 dólares"]) {
      expect(parseBudget(bad).ok).toBe(false);
    }
  });

  it("papéis do catálogo: só os marcados e válidos; sem o campo, ficam como estão", () => {
    const novo = parseNewAgentForm(
      form([
        ["name", "Concierge"],
        ["kind", "internal"],
        ["roles_presentes", "1"],
        ["roles", "CO-10"],
        ["roles", "CO-10"],
        ["roles", "xx-1"],
      ]),
    );
    expect(novo).toEqual({
      ok: true,
      value: { name: "Concierge", kind: "internal", roles: ["CO-10"] },
    });
    const base: [string, string][] = [
      ["id", AGENT_ID],
      ["name", "Concierge"],
    ];
    const edit = (entries: [string, string][]) => {
      const parsed = parseAgentEditForm(form([...base, ...entries]));
      return parsed.ok ? parsed.value.input.roles : "erro";
    };
    expect(edit([["roles_presentes", "1"]])).toEqual([]);
    expect(
      edit([
        ["roles_presentes", "1"],
        ["roles", "PL-11"],
        ["roles", "CO-10"],
      ]),
    ).toEqual(["PL-11", "CO-10"]);
    // Página aberta antes do campo existir: não apaga os papéis.
    expect(edit([["roles", "CO-10"]])).toBeUndefined();
  });

  it("edição traz tudo, com vazio virando nulo", () => {
    expect(
      parseAgentEditForm(
        form([
          ["id", AGENT_ID],
          ["name", "Executor"],
          ["department", ""],
          ["mission", ""],
          ["budget", ""],
          ["owner", ""],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: {
        id: AGENT_ID,
        input: {
          name: "Executor",
          department: null,
          mission: null,
          budget_usd_month: 0,
          owner: null,
        },
      },
    });
    for (const bad of [
      [
        ["id", "x"],
        ["name", "A"],
      ],
      [
        ["id", AGENT_ID],
        ["name", ""],
      ],
      [
        ["id", AGENT_ID],
        ["name", "A"],
        ["department", "Gestão!"],
      ],
      [
        ["id", AGENT_ID],
        ["name", "A"],
        ["owner", "fulano"],
      ],
      [
        ["id", AGENT_ID],
        ["name", "A"],
        ["budget", "muito"],
      ],
    ] as [string, string][][]) {
      expect(parseAgentEditForm(form(bad)).ok).toBe(false);
    }
  });

  it("pausar e reativar só com agente e status conhecidos", () => {
    expect(
      parseAgentStatusForm(
        form([
          ["id", AGENT_ID],
          ["status", "paused"],
        ]),
      ),
    ).toEqual({ ok: true, value: { id: AGENT_ID, status: "paused" } });
    expect(
      parseAgentStatusForm(
        form([
          ["id", AGENT_ID],
          ["status", "revoked"],
        ]),
      ).ok,
    ).toBe(false);
  });
});

describe("criação de chave", () => {
  it("monta o pedido com permissões, projetos e validade", () => {
    expect(
      parseNewKeyForm(
        form([
          ["agent_id", AGENT_ID],
          ["scope", "tasks:read"],
          ["scope", "tasks:complete"],
          ["scope", "tasks:read"],
          ["project", "HUB"],
          ["validade", "30"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: {
        agent_id: AGENT_ID,
        scopes: ["tasks:read", "tasks:complete"],
        projects: ["HUB"],
        expires_in_days: 30,
      },
    });
  });

  it("todos os projetos acrescenta o acesso amplo", () => {
    const parsed = parseNewKeyForm(
      form([
        ["agent_id", AGENT_ID],
        ["scope", "projects:read"],
        ["todos", "on"],
      ]),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { scopes: ["projects:read", "workspace:*"], projects: "all" },
    });
  });

  it("ignora permissões fora da lista, inclusive as proibidas", () => {
    const parsed = parseNewKeyForm(
      form([
        ["agent_id", AGENT_ID],
        ["scope", "approvals:decide"],
        ["scope", "agents:keys"],
        ["scope", "workspace:*"],
        ["scope", "tasks:read"],
        ["project", "HUB"],
      ]),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { scopes: ["tasks:read"], expires_in_days: 90 },
    });
  });

  it.each([
    ["agente inválido", [["agent_id", "x"]]],
    [
      "sem permissão marcada",
      [
        ["agent_id", AGENT_ID],
        ["project", "HUB"],
      ],
    ],
    [
      "sem projeto",
      [
        ["agent_id", AGENT_ID],
        ["scope", "tasks:read"],
      ],
    ],
  ] as [string, [string, string][]][])("recusa %s", (_label, entries) => {
    expect(parseNewKeyForm(form(entries)).ok).toBe(false);
  });
});

describe("revogação", () => {
  it("só aceita o identificador da chave", () => {
    expect(parseRevokeForm(form([["key_id", AGENT_ID]]))).toEqual({
      ok: true,
      value: { keyId: AGENT_ID },
    });
    expect(parseRevokeForm(form([["key_id", "1 or 1=1"]])).ok).toBe(false);
  });
});
