import { describe, expect, it } from "vitest";
import {
  approvalChecks,
  approvalDetails,
  approvalRewrite,
  approvalEffect,
  decisionMessage,
  decisionView,
  historyView,
  parseBatchForm,
  parseDecisionForm,
  type ApprovalLike,
} from "./view";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function approval(over: Partial<ApprovalLike> = {}): ApprovalLike {
  return {
    id: ID,
    type: "client_visibility",
    status: "pending",
    project_code: "EXE",
    title: "Mostrar a frente ao cliente",
    summary: "Pronta para o portal.",
    payload: { title_client: "Mensagens do atendimento" },
    requested_by: { type: "agent", name: "Kratos" },
    acting_role: "GP-01",
    due_at: null,
    decision_note: null,
    decided_by: null,
    decided_at: null,
    effect: {},
    created_at: "2026-10-10T12:30:00Z",
    ...over,
  };
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("pedido na tela", () => {
  it("mostra tipo, papel, idade, prazo e o efeito de aprovar", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    const item = decisionView(
      approval({ due_at: "2026-10-10T14:00:00Z" }),
      now,
    );
    expect(item).toMatchObject({
      typeLabel: "Mostrar ao cliente",
      tone: "info",
      projectCode: "EXE",
      requestedBy: "Kratos",
      requestedByAgent: true,
      roleLabel: "Gestor de Projetos",
      age: "há 2 h",
      due: "até 10/10",
      late: true,
      effect:
        "a frente passa a aparecer para o cliente, com o título “Mensagens do atendimento”.",
    });
    expect(item.details).toEqual([
      { label: "Título para o cliente", value: "Mensagens do atendimento" },
    ]);
  });

  it("descreve o efeito de cada tipo; os sem efeito automático dizem isso", () => {
    expect(approvalEffect("milestone_acceptance", {})).toMatch(/Aceito/);
    expect(approvalEffect("status_report", {})).toBe(
      "o relatório é publicado no portal do cliente.",
    );
    expect(approvalEffect("status_report", { audience: "internal" })).toBe(
      "o relatório interno é publicado para a equipe.",
    );
    expect(approvalEffect("import_review", {})).toBe(
      "o projeto sai de Em revisão e fica como Ativo.",
    );
    expect(approvalEffect("import_review", { next_status: "paused" })).toBe(
      "o projeto sai de Em revisão e fica como Pausado.",
    );
    expect(approvalEffect("replan", {})).toMatch(/^nada muda sozinho/);
  });

  it("pedidos que mudam o plano dizem o que muda ao aprovar (RF-25)", () => {
    expect(
      approvalEffect("milestone_proposal", {
        title: "Relatórios mensais",
        due_date: "2026-12-15",
        title_client: null,
      }),
    ).toBe(
      "o marco “Relatórios mensais” é criado, com data 15/12/2026, como Planejado, só para a equipe.",
    );
    expect(
      approvalEffect("milestone_proposal", {
        title: "Relatórios mensais",
        title_client: "Relatórios do mês",
      }),
    ).toBe(
      "o marco “Relatórios mensais” é criado, sem data, como Planejado, visível para o cliente como “Relatórios do mês”.",
    );
    const replan = {
      milestones: [
        { code: "M2", due_date: "2026-11-30" },
        { code: "M3", due_date: "2026-12-15" },
      ],
      reason: "A integração atrasou.",
    };
    expect(approvalEffect("replan", replan)).toBe(
      "as datas mudam: M2 para 30/11/2026, M3 para 15/12/2026; o motivo fica no histórico de datas.",
    );
    expect(approvalDetails(replan)).toEqual([
      {
        label: "Marcos",
        value: "M2, data 30/11/2026 · M3, data 15/12/2026",
      },
      { label: "Motivo", value: "A integração atrasou." },
    ]);
    const scope = {
      milestones: [
        {
          code: "M1",
          title: "Atendente no WhatsApp",
          acceptance_criteria: ["Responde", "Transfere"],
        },
      ],
    };
    expect(approvalEffect("scope_change", scope)).toBe(
      "o título ou os critérios de aceite mudam em M1, como nos detalhes.",
    );
    expect(approvalDetails(scope)).toEqual([
      {
        label: "Marcos",
        value:
          "M1, título “Atendente no WhatsApp”, critérios: Responde; Transfere",
      },
    ]);
    expect(approvalEffect("scope_change", { milestones: "M1" })).toMatch(
      /^nada muda sozinho/,
    );
    // Pedido de antes do formato (sem o título do marco ou sem o texto): nada muda sozinho.
    expect(approvalEffect("milestone_proposal", {})).toMatch(
      /^nada muda sozinho/,
    );
    expect(approvalEffect("external_message", { body: " " })).toMatch(
      /^nada muda sozinho/,
    );
  });

  it("mensagem para o cliente aparece inteira, à parte, e sai em nome de quem aprova", () => {
    const payload = {
      body: "Olá! A entrega passa para **30/11**.",
      checks: [{ kind: "task_code", term: "HUB-9" }],
    };
    const item = decisionView(
      approval({ type: "external_message", payload }),
      new Date("2026-10-10T15:00:00Z"),
    );
    expect(item).toMatchObject({
      effect: "a mensagem abaixo é publicada no canal do cliente, em seu nome.",
      messageBody: "Olá! A entrega passa para **30/11**.",
      reportBody: null,
      checks: ["código de tarefa HUB-9"],
      details: [],
    });
    // Só o pedido de mensagem externa mostra o corpo como mensagem ao cliente.
    expect(
      decisionView(
        approval({ type: "custom", payload: { body: "x" } }),
        new Date("2026-10-10T15:00:00Z"),
      ).messageBody,
    ).toBeNull();
  });

  it("revogar chave de agente (agent_key): o efeito, os detalhes e o resultado", () => {
    const payload = {
      key_id: "4dc6721e-2ac8-463d-84cb-3b25ab170bbd",
      action: "revoke",
      key_prefix: "hub_ak_ab12",
      agent_name: "Executor",
    };
    expect(approvalEffect("agent_key", payload)).toBe(
      "a chave hub_ak_ab12 de Executor é revogada: o agente perde o acesso na hora.",
    );
    expect(approvalDetails(payload)).toEqual([
      { label: "Agente", value: "Executor" },
      { label: "Chave", value: "hub_ak_ab12" },
    ]);
    expect(approvalEffect("agent_key", {})).toMatch(/^nada muda sozinho/);
    expect(
      decisionMessage({
        title: "Revogar",
        status: "approved",
        effect: { applied: true, key_revoked: "hub_ak_ab12" },
      }),
    ).toBe("Aprovado: “Revogar”. A chave foi revogada.");
  });

  it("detalhes na ordem fixa, venha o pedido como vier (o jsonb não guarda a ordem)", () => {
    expect(
      approvalDetails({
        title_client: "Relatórios do mês",
        reason: "Atrasou.",
        extra: "x",
        milestones: [{ code: "M2", due_date: "2026-11-30" }],
        title: "Relatórios",
      }).map((d) => d.label),
    ).toEqual(["Título", "Marcos", "Motivo", "Título para o cliente", "extra"]);
  });

  it("detalhes: nomes em PT-BR, listas juntas, vazios fora", () => {
    expect(
      approvalDetails({
        title: "Relatórios mensais",
        due_date: "2026-11-30",
        acceptance_criteria: ["Volume", { text: "Agendamentos" }],
        vazio: " ",
        objeto: { a: 1 },
        prioridade_extra: 2,
      }),
    ).toEqual([
      { label: "Título", value: "Relatórios mensais" },
      { label: "Data", value: "30/11/2026" },
      { label: "Critérios de aceite", value: "Volume; Agendamentos" },
      { label: "prioridade_extra", value: "2" },
    ]);
  });

  it("verificação do RC-12 e o texto do relatório aparecem à parte, não nos detalhes", () => {
    const payload = {
      audience: "client",
      report_body: "Nesta semana, a **HUB-57** ficou pronta.",
      checks: [
        { kind: "task_code", term: "HUB-57" },
        { kind: "inventado", term: "x" },
        "texto solto",
      ],
    };
    expect(approvalChecks(payload)).toEqual(["código de tarefa HUB-57"]);
    expect(approvalDetails(payload)).toEqual([]);
    const item = decisionView(
      approval({ type: "status_report", payload }),
      new Date("2026-10-10T15:00:00Z"),
    );
    expect(item).toMatchObject({
      checks: ["código de tarefa HUB-57"],
      reportBody: "Nesta semana, a **HUB-57** ficou pronta.",
    });
  });

  it("texto reescrito pelo RC-12 mostra a nota e o original, fora dos detalhes", () => {
    const report = {
      report_body: "Você ganhou o atendimento automático.",
      original_body: "A HUB-57 ficou pronta.",
      rewritten_by: "RC-12",
      rewrite_notes: "Tirei o código da tarefa.",
    };
    expect(approvalRewrite(report)).toEqual({
      notes: "Tirei o código da tarefa.",
      original: "A HUB-57 ficou pronta.",
    });
    expect(approvalDetails(report)).toEqual([]);
    const front = {
      title_client: "Atendimento pelo WhatsApp",
      original_title_client: "Fluxo do bot",
      original_description_client: "Feito pelo Kratos.",
      rewritten_by: "RC-12",
      rewrite_notes: null,
    };
    expect(approvalRewrite(front)).toEqual({
      notes: null,
      original: "Fluxo do bot\n\nFeito pelo Kratos.",
    });
    expect(approvalDetails(front)).toEqual([
      { label: "Título para o cliente", value: "Atendimento pelo WhatsApp" },
    ]);
    expect(approvalRewrite({ rewritten_by: "outro" })).toBeNull();
  });

  it("sem nome de quem pediu e com papel desconhecido, não quebra", () => {
    const item = decisionView(
      approval({
        requested_by: { type: "agent", name: null },
        acting_role: "ZZ-99",
        type: "custom",
      }),
      new Date("2026-10-10T15:00:00Z"),
    );
    expect(item.requestedBy).toBe("Agente");
    expect(item.roleLabel).toBe("ZZ-99");
    expect(item.typeLabel).toBe("Pedido");
  });
});

describe("formulário de decisão", () => {
  it("aceita aprovar sem nota e exige nota para ajustar", () => {
    expect(parseDecisionForm(form({ id: ID, decision: "approved" }))).toEqual({
      ok: true,
      value: { id: ID, decision: "approved" },
    });
    expect(
      parseDecisionForm(
        form({ id: ID, decision: "adjust_requested", note: " " }),
      ).ok,
    ).toBe(false);
    expect(
      parseDecisionForm(
        form({
          id: ID,
          decision: "adjust_requested",
          note: " Mude\r\na data ",
        }),
      ),
    ).toEqual({
      ok: true,
      value: { id: ID, decision: "adjust_requested", note: "Mude\na data" },
    });
  });

  it("recusa id, decisão ou nota inválidos", () => {
    expect(parseDecisionForm(form({ id: "x", decision: "approved" })).ok).toBe(
      false,
    );
    expect(parseDecisionForm(form({ id: ID, decision: "talvez" })).ok).toBe(
      false,
    );
    expect(
      parseDecisionForm(
        form({ id: ID, decision: "rejected", note: "a".repeat(4001) }),
      ).ok,
    ).toBe(false);
  });

  it("a mensagem diz o que de fato aconteceu", () => {
    const base = { title: "Aceite do M2" };
    expect(
      decisionMessage({
        ...base,
        status: "approved",
        effect: { applied: true, milestone_status: "accepted" },
      }),
    ).toBe("Aprovado: “Aceite do M2”. O marco foi aceito.");
    expect(
      decisionMessage({
        ...base,
        status: "approved",
        effect: { applied: true, project_status: "active" },
      }),
    ).toBe("Aprovado: “Aceite do M2”. O projeto ficou como Ativo.");
    const approved = (effect: Record<string, unknown>) =>
      decisionMessage({ ...base, status: "approved", effect });
    expect(approved({ applied: true, milestone: "M4" })).toBe(
      "Aprovado: “Aceite do M2”. O marco M4 foi criado.",
    );
    expect(
      approved({
        applied: true,
        replanned: [
          { code: "M2", from: "2026-11-15", to: "2026-11-30" },
          { code: "M3", from: null, to: "2026-12-15" },
        ],
      }),
    ).toBe("Aprovado: “Aceite do M2”. As datas mudaram em M2, M3.");
    expect(approved({ applied: true, scope_changed: ["M1"] })).toBe(
      "Aprovado: “Aceite do M2”. O escopo mudou em M1.",
    );
    expect(approved({ applied: true, client_message: ID })).toBe(
      "Aprovado: “Aceite do M2”. A mensagem foi publicada no canal do cliente.",
    );
    expect(
      decisionMessage({
        ...base,
        status: "approved",
        effect: { applied: false },
      }),
    ).toBe(
      "Aprovado: “Aceite do M2”. A decisão ficou registrada para quem pediu.",
    );
    expect(
      decisionMessage({ ...base, status: "rejected", effect: {} }),
    ).toMatch(/^Pedido recusado/);
    expect(
      decisionMessage({ ...base, status: "adjust_requested", effect: {} }),
    ).toMatch(/^Orientação registrada/);
  });
});

describe("histórico de decisões", () => {
  const now = new Date("2026-10-10T15:00:00Z");

  it("aprovado mostra quem decidiu, quando e o que mudou", () => {
    const item = historyView(
      approval({
        status: "approved",
        decided_by: { name: "Fábio Almeida" },
        decided_at: "2026-10-10T14:00:00Z",
        effect: { applied: true, workstream_visibility: "client" },
      }),
      now,
    );
    expect(item).toMatchObject({
      outcome: "Aprovado",
      outcomeTone: "ok",
      decidedBy: "Fábio Almeida",
      decidedOn: "10/10",
      note: null,
      result: "A frente agora aparece para o cliente.",
    });
  });

  it("ajuste e recusa trazem a orientação e não um resultado", () => {
    const adjusted = historyView(
      approval({
        status: "adjust_requested",
        decision_note: "  Mude o prazo.  ",
        decided_by: { name: "Fábio Almeida" },
        decided_at: "2026-10-10T14:00:00Z",
      }),
      now,
    );
    expect(adjusted).toMatchObject({
      outcome: "Ajuste pedido",
      note: "Mude o prazo.",
      result: null,
    });
    expect(historyView(approval({ status: "cancelled" }), now)).toMatchObject({
      outcome: "Cancelado",
      decidedBy: null,
      decidedOn: null,
    });
  });

  it("valor estranho vindo do pedido não vira texto quebrado", () => {
    expect(
      historyView(
        approval({
          type: "import_review",
          payload: { next_status: "constructor" },
        }),
        now,
      ).effect,
    ).toBe("o projeto sai de Em revisão e fica como Ativo.");
  });
});

describe("pedido parado", () => {
  it("marca o pedido que espera há mais de 3 dias úteis", () => {
    // Sexta, 2 de outubro de 2026; sexta seguinte, 9 de outubro: 5 dias úteis.
    const friday = "2026-10-02T12:00:00Z";
    expect(
      decisionView(
        approval({ created_at: friday }),
        new Date("2026-10-09T12:00:00Z"),
      ).stalledDays,
    ).toBe(5);
    // Terça seguinte: 2 dias úteis, ainda não.
    expect(
      decisionView(
        approval({ created_at: friday }),
        new Date("2026-10-06T12:00:00Z"),
      ).stalledDays,
    ).toBeNull();
    // Já decidido: nunca.
    expect(
      decisionView(
        approval({ created_at: friday, status: "approved" }),
        new Date("2026-10-30T12:00:00Z"),
      ).stalledDays,
    ).toBeNull();
  });
});

describe("aprovação em lote das importações", () => {
  it("lê os pedidos marcados: só ids válidos, sem repetir", () => {
    const A = "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90";
    const B = "5d0c2f7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const f = new FormData();
    for (const v of [A, B, A, "x", ""]) f.append("id", v);
    expect(parseBatchForm(f)).toEqual({ ok: true, ids: [A, B] });
    expect(parseBatchForm(new FormData())).toEqual({
      ok: false,
      message: "Marque pelo menos um pedido.",
    });
  });
});
