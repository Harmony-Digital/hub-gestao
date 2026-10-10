import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { createComment, excerpt } from "@/modules/comments/service";
import { inTx } from "@/modules/context";
import { blockTask, createTask, updateTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  describeNotification,
  inbox,
  markRead,
  notificationPrefs,
  setNotificationPref,
  unreadCount,
} from "./notifications";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asMember = () => ctxFor(h, member, "ui");

beforeAll(async () => {
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('ana@exemplo.com', 'Ana Souza') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  await h.raw.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role) values ($1, $2, $3, 'member')`,
    [h.ws, h.vit, profile.id],
  );
  // O Fábio é o responsável pelo VIT: recebe os bloqueios.
  await h.raw.query(
    `update ${S}.projects set owner_profile_id = $2 where id = $1`,
    [h.vit, h.owner],
  );
  member = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Ana Souza",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("caixa de entrada", () => {
  it("menção avisa a pessoa citada, nunca o autor", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Revisar o roteiro" }),
    );
    await inTx(asOwner(), (t) =>
      createComment(
        t,
        { task: task.code },
        {
          body_md: "**@Ana Souza**, confere o roteiro antes de sexta?",
          mentions: [
            { type: "user", id: member.id },
            { type: "user", id: h.owner },
          ],
        },
      ),
    );
    const mine = await inTx(asMember(), (t) => inbox(t));
    expect(mine.items[0]).toMatchObject({
      type: "mention",
      group: "mention",
      read: false,
      text: `Fábio Almeida mencionou você em ${task.code}`,
      detail: "@Ana Souza, confere o roteiro antes de sexta?",
      href: `/projetos/VIT?tarefa=${task.code}`,
    });
    const owner = await inTx(asOwner(), (t) => inbox(t));
    expect(owner.items.some((i) => i.type === "mention")).toBe(false);
  });

  it("citar quem não é do workspace é recusado", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Outra" }),
    );
    const err = await inTx(asOwner(), (t) =>
      createComment(
        t,
        { task: task.code },
        {
          body_md: "@Fulano",
          mentions: [
            { type: "user", id: "00000000-0000-4000-8000-000000000999" },
          ],
        },
      ),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).status).toBe(422);
  });

  it("tarefa passada para alguém avisa essa pessoa; bloqueio avisa o responsável", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Ligar para a clínica",
        assignee: { type: "user", id: member.id },
      }),
    );
    const assigned = await inTx(asMember(), (t) => inbox(t));
    expect(assigned.items[0]).toMatchObject({
      type: "task.assigned",
      text: `Fábio Almeida passou ${task.code} para você`,
    });
    // Quem pega a própria tarefa não recebe aviso.
    const before = await inTx(asOwner(), (t) => unreadCount(t));
    await inTx(asOwner(), (t) =>
      updateTask(t, task.code, { assignee: { type: "user", id: h.owner } }),
    );
    expect(await inTx(asOwner(), (t) => unreadCount(t))).toBe(before);

    await inTx(asOwner(), (t) =>
      updateTask(t, task.code, { assignee: { type: "user", id: member.id } }),
    );
    await inTx(asMember(), (t) =>
      blockTask(t, task.code, { reason: "A clínica não atende hoje." }),
    );
    const owner = await inTx(asOwner(), (t) => inbox(t));
    expect(owner.items[0]).toMatchObject({
      type: "task.blocked",
      group: "blocked",
      text: `Ana Souza bloqueou ${task.code} em VIT`,
      detail: "A clínica não atende hoje.",
    });
  });

  it("preferência desligada não entrega; marcar como lido zera o contador", async () => {
    await inTx(asMember(), (t) => setNotificationPref(t, "mention", false));
    expect(await inTx(asMember(), (t) => notificationPrefs(t))).toMatchObject({
      mention: false,
      assignment: true,
    });
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Sem aviso" }),
    );
    const count = async () =>
      (
        await h.raw.query<{ n: number }>(
          `select count(*)::int as n from ${S}.notifications where profile_id = $1 and type = 'mention'`,
          [member.id],
        )
      ).rows[0].n;
    const mentionsBefore = await count();
    await inTx(asOwner(), (t) =>
      createComment(
        t,
        { task: task.code },
        { body_md: "@Ana Souza", mentions: [{ type: "user", id: member.id }] },
      ),
    );
    expect(await count()).toBe(mentionsBefore);
    await inTx(asMember(), (t) => setNotificationPref(t, "mention", true));

    const unread = await inTx(asMember(), (t) => unreadCount(t));
    expect(unread).toBeGreaterThan(0);
    const first = (await inTx(asMember(), (t) => inbox(t))).items[0];
    expect(await inTx(asMember(), (t) => markRead(t, [first.id]))).toBe(1);
    expect(await inTx(asMember(), (t) => unreadCount(t))).toBe(unread - 1);
    await inTx(asMember(), (t) => markRead(t, "all"));
    expect(await inTx(asMember(), (t) => unreadCount(t))).toBe(0);
  });
});

describe("textos dos avisos", () => {
  it("tarefa reaberta pela verificação de evidência", () => {
    expect(
      describeNotification("task.reopened", {
        task_code: "HUB-7",
        project_code: "VIT",
        title: "Publicar o fluxo",
      }),
    ).toEqual({
      text: "HUB-7 foi reaberta: concluída sem evidência em VIT",
      detail: "Publicar o fluxo",
      href: "/projetos/VIT?tarefa=HUB-7",
    });
  });

  it("aprovações e trecho do comentário", () => {
    expect(
      describeNotification("approval.decided", {
        title: "Aceite do M2",
        decision: "adjust_requested",
      }),
    ).toEqual({
      text: "Seu pedido foi devolvido para ajuste",
      detail: "Aceite do M2",
      href: "/aprovacoes?status=todas",
    });
    expect(excerpt("**Olha** o [link](https://x.y)\n\nfim", 20)).toBe(
      "Olha o link(https:/…",
    );
  });
});
