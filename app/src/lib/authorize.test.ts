import { describe, expect, it } from "vitest";
import type { Actor, AgentActor } from "@/lib/db/actor";
import { authorize, can, type Action } from "./authorize";

const ws = "00000000-0000-4000-8000-000000000001";
const projectA = "00000000-0000-4000-8000-0000000000aa";
const projectB = "00000000-0000-4000-8000-0000000000bb";

const user = (role: "owner" | "admin" | "member"): Actor => ({
  type: "user",
  id: "00000000-0000-4000-8000-000000000010",
  scope: "internal",
  role,
  workspaceId: ws,
  name: "Pessoa",
});
const agent = (
  scopes: string[],
  projectIds: string[] | null = [projectA],
): AgentActor => ({
  type: "agent",
  id: "00000000-0000-4000-8000-000000000020",
  scope: "internal",
  keyId: "00000000-0000-4000-8000-000000000021",
  kind: "hermes",
  scopes,
  projectIds,
  roles: ["GP-01"],
  workspaceId: ws,
  name: "Kratos",
});
const client: Actor = {
  type: "user",
  id: "00000000-0000-4000-8000-000000000030",
  scope: "client",
  clientId: "00000000-0000-4000-8000-000000000031",
  contactRole: "client_approver",
  workspaceId: ws,
  name: "Contato",
};
const system: Actor = {
  type: "system",
  id: null,
  scope: "internal",
  workspaceId: ws,
  name: "Hub",
};

const DECISIONS: Action[] = [
  "approval.decide",
  "milestone.accept",
  "agent.keys",
];

describe("authorize: pessoas", () => {
  it("owner pode tudo, inclusive decidir gates", () => {
    for (const action of [
      ...DECISIONS,
      "task.write",
      "workspace.admin",
    ] as Action[]) {
      expect(can(user("owner"), action, { projectId: projectA })).toBe(true);
    }
  });

  it("admin não decide gate nem gera chave de agente (D9)", () => {
    for (const action of DECISIONS)
      expect(can(user("admin"), action)).toBe(false);
    expect(can(user("admin"), "milestone.write")).toBe(true);
    expect(can(user("admin"), "agent.manage")).toBe(true);
    // Mandar algo ao cliente (mensagem ou arquivo) é de quem decide: dono e administração.
    expect(can(user("admin"), "attachment.write_client")).toBe(true);
    expect(
      can(user("member"), "attachment.write_client", {
        projectId: projectA,
        projectRole: "lead",
      }),
    ).toBe(false);
  });

  it("member atua só nos projetos de que participa", () => {
    const m = user("member");
    expect(
      can(m, "task.write", { projectId: projectA, projectRole: "member" }),
    ).toBe(true);
    expect(
      can(m, "task.write", { projectId: projectA, projectRole: null }),
    ).toBe(false);
    expect(
      can(m, "milestone.write", { projectId: projectA, projectRole: "lead" }),
    ).toBe(false);
    expect(
      can(m, "approval.decide", { projectId: projectA, projectRole: "lead" }),
    ).toBe(false);
  });

  it("convidado do projeto só lê (PRD §4.1)", () => {
    const m = user("member");
    const guest = { projectId: projectA, projectRole: "guest" as const };
    for (const read of [
      "project.read",
      "task.read",
      "milestone.read",
      "comment.read",
      "report.read",
    ] as const) {
      expect(can(m, read, guest)).toBe(true);
    }
    for (const write of [
      "task.write",
      "task.transition",
      "comment.write",
      "workstream.write",
      "time.write",
      "approval.request",
    ] as const) {
      expect(can(m, write, guest)).toBe(false);
    }
  });

  it("contato de cliente não usa a API interna", () => {
    expect(can(client, "project.read", { projectId: projectA })).toBe(false);
    expect(() => authorize(client, "task.read")).toThrow(/portal/);
  });
});

describe("authorize: agentes", () => {
  it("exige o escopo da ação e explica qual falta", () => {
    const a = agent(["tasks:read"]);
    expect(can(a, "task.read", { projectId: projectA })).toBe(true);
    try {
      authorize(a, "task.transition", { projectId: projectA });
      expect.unreachable();
    } catch (err) {
      expect((err as { status: number }).status).toBe(403);
      expect(
        (err as { extra: Record<string, unknown> }).extra.missing_scope,
      ).toBe("tasks:complete");
    }
  });

  it("fica nos projetos da chave", () => {
    const a = agent(["tasks:read"]);
    expect(can(a, "task.read", { projectId: projectB })).toBe(false);
    expect(
      can(agent(["workspace:*"], null), "task.write", { projectId: projectB }),
    ).toBe(true);
  });

  it("nunca decide, nem com workspace:*", () => {
    const all = agent(["workspace:*"], null);
    for (const action of [
      ...DECISIONS,
      "milestone.write",
      "workstream.visibility",
      "comment.write_client",
      "attachment.write_client",
      "report.publish",
    ] as Action[]) {
      expect(can(all, action, { projectId: projectA })).toBe(false);
    }
    expect(() => authorize(all, "approval.decide")).toThrow(
      /hub_request_approval/,
    );
  });

  it("whoami não exige escopo", () => {
    expect(can(agent([]), "agent.read")).toBe(true);
  });
});

describe("authorize: sistema", () => {
  it("roda rotinas, mas não toma decisões", () => {
    expect(can(system, "project.read")).toBe(true);
    expect(can(system, "task.write")).toBe(true);
    for (const action of DECISIONS) expect(can(system, action)).toBe(false);
  });
});
