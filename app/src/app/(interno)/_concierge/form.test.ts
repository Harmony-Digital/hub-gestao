import { describe, expect, it } from "vitest";
import { parseConciergeForm } from "./form";

const USER = "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90";
const STATUS = "5d0c2f7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const NOW = 1_800_000_000_000;

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("formulário da prévia do Concierge", () => {
  it("criar tarefa: o que a pessoa confirmou, com as métricas", () => {
    expect(
      parseConciergeForm(
        form([
          ["kind", "create_task"],
          ["edited", "1"],
          ["voice", "1"],
          ["started", String(NOW - 9_400)],
          ["project", "CER"],
          ["title", "  Ajustar o hero do site  "],
          ["due_date", "2026-10-16"],
          ["priority", "high"],
          ["assignee", `user:${USER}`],
          ["description", "Linha 1\r\nLinha 2"],
        ]),
        NOW,
      ),
    ).toEqual({
      ok: true,
      command: {
        kind: "create_task",
        project: "CER",
        title: "Ajustar o hero do site",
        description_md: "Linha 1\nLinha 2",
        priority: "high",
        due_date: "2026-10-16",
        assignee: { type: "user", id: USER },
      },
      meta: { edited: true, voice: true, seconds: 9 },
    });
  });

  it("campos vazios ficam de fora; responsável eu; tempo fora do razoável não conta", () => {
    expect(
      parseConciergeForm(
        form([
          ["kind", "create_task"],
          ["started", "abc"],
          ["project", "CER"],
          ["title", "Revisar"],
          ["due_date", ""],
          ["assignee", "me"],
        ]),
        NOW,
      ),
    ).toEqual({
      ok: true,
      command: {
        kind: "create_task",
        project: "CER",
        title: "Revisar",
        priority: "normal",
        assignee: "me",
      },
      meta: { edited: false, voice: false, seconds: null },
    });
  });

  it("mudar tarefa e comentar", () => {
    expect(
      parseConciergeForm(
        form([
          ["kind", "update_task"],
          ["task", "HUB-12"],
          ["version", "3"],
          ["status_id", STATUS],
          ["evidence", "https://exemplo.com/pr/1"],
          ["assignee", `agent:${USER}`],
        ]),
        NOW,
      ),
    ).toMatchObject({
      ok: true,
      command: {
        kind: "update_task",
        task: "HUB-12",
        version: 3,
        status_id: STATUS,
        evidence: "https://exemplo.com/pr/1",
        assignee: { type: "agent", id: USER },
      },
    });
    expect(
      parseConciergeForm(
        form([
          ["kind", "comment"],
          ["task", "HUB-12"],
          ["body", "Falei com o cliente."],
        ]),
        NOW,
      ),
    ).toMatchObject({
      ok: true,
      command: {
        kind: "comment",
        task: "HUB-12",
        body_md: "Falei com o cliente.",
      },
    });
  });

  it.each([
    ["sem tipo", [["title", "x"]], "Pedido inválido. Recarregue a página."],
    [
      "sem projeto",
      [
        ["kind", "create_task"],
        ["title", "x"],
      ],
      "Escolha o projeto.",
    ],
    [
      "sem título",
      [
        ["kind", "create_task"],
        ["project", "CER"],
      ],
      "Diga o título da tarefa.",
    ],
    [
      "comentário vazio",
      [
        ["kind", "comment"],
        ["task", "HUB-1"],
      ],
      "Escreva o comentário.",
    ],
  ] as [string, [string, string][], string][])(
    "recusa %s",
    (_name, entries, message) => {
      expect(parseConciergeForm(form(entries), NOW)).toEqual({
        ok: false,
        message,
      });
    },
  );

  it("recusa valor adulterado (tarefa, versão, responsável)", () => {
    for (const entries of [
      [
        ["kind", "update_task"],
        ["task", "HUB12; drop"],
        ["version", "1"],
      ],
      [
        ["kind", "update_task"],
        ["task", "HUB-1"],
        ["version", "x"],
      ],
      [
        ["kind", "create_task"],
        ["project", "CER"],
        ["title", "x"],
        ["assignee", "admin"],
      ],
    ] as [string, string][][]) {
      expect(parseConciergeForm(form(entries), NOW).ok).toBe(false);
    }
  });
});
