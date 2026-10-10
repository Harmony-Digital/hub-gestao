import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { createTask, getTask } from "@/modules/tasks/service";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  closingCodes,
  handleGithubEvent,
  mentionedCodes,
  validSignature,
} from "./webhook";

const S = "proj_hub_gestao";

describe("assinatura e códigos", () => {
  const secret = "segredo-de-teste-com-mais-de-32-caracteres!!";
  const body = '{"zen":"Keep it logically awesome."}';
  const sign = (text: string, key = secret) =>
    `sha256=${createHmac("sha256", key).update(text).digest("hex")}`;

  it("aceita só a assinatura certa do corpo exato", () => {
    expect(validSignature(secret, body, sign(body))).toBe(true);
    expect(validSignature(secret, `${body} `, sign(body))).toBe(false);
    expect(validSignature(secret, body, sign(body, "outro-segredo"))).toBe(
      false,
    );
    expect(validSignature(secret, body, null)).toBe(false);
    expect(validSignature(secret, body, "sha1=abc")).toBe(false);
  });

  it("acha os códigos citados e os que o texto manda fechar", () => {
    expect(
      mentionedCodes("Ajusta HUB-12 e HUB-3; de novo HUB-12. XHUB-9"),
    ).toEqual(["HUB-12", "HUB-3"]);
    expect(
      closingCodes(
        "fecha HUB-12\nCloses: HUB-13, fixes HUB-14, resolve HUB-15, cita HUB-16",
      ),
    ).toEqual(["HUB-12", "HUB-13", "HUB-14", "HUB-15"]);
    expect(closingCodes("fecha ABC-1", "ABC")).toEqual(["ABC-1"]);
  });
});

describe("eventos", () => {
  let h: TestHub;
  beforeAll(async () => {
    h = await openTestHub();
  });
  afterAll(async () => {
    await h.db.close();
  });

  const newTask = (title: string) =>
    inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      createTask(t, { project: "VIT", title, workstream_id: h.vitWorkstream }),
    );
  const commentsOn = (code: string) =>
    count(
      h,
      `select count(*)::int as n from ${S}.comments c join ${S}.tasks k on k.id = c.entity_id
        where k.code = $1 and c.author_type = 'system'`,
      [code],
    );
  const status = async (code: string) =>
    (await inTx(ctxFor(h, h.owner_actor, "ui"), (t) => getTask(t, code))).status
      .category;

  it("push: comenta o commit; no ramo principal, fecha HUB-n vira proposta", async () => {
    const citada = await newTask("Citada no commit");
    const fechada = await newTask("Fechada no commit");
    const lateral = await newTask("Fechada noutro ramo");
    const payload = (
      ref: string,
      commits: { id: string; message: string }[],
    ) => ({
      ref,
      repository: {
        full_name: "Harmony-Digital/exemplo",
        default_branch: "main",
      },
      commits: commits.map((c) => ({
        ...c,
        url: `https://github.com/Harmony-Digital/exemplo/commit/${c.id}`,
      })),
    });
    const main = payload("refs/heads/main", [
      {
        id: "a1b2c3d4e5f6",
        message: `Ajusta o fluxo (${citada.code})\n\nDetalhes.`,
      },
      { id: "b2c3d4e5f6a1", message: `Termina a tela, fecha ${fechada.code}` },
    ]);
    const first = await handleGithubEvent(h.db, h.ws, "push", main, "t1");
    expect(first).toMatchObject({ comments: 2, proposals: 1, ignored: false });
    expect(await commentsOn(citada.code)).toBe(1);
    // A tarefa fechada recebe o comentário do commit e o da proposta, e vai para revisão.
    expect(await commentsOn(fechada.code)).toBe(2);
    expect(await status(fechada.code)).toBe("review");

    // Reentrega do mesmo evento: nada se repete.
    const again = await handleGithubEvent(h.db, h.ws, "push", main, "t2");
    expect(again).toMatchObject({ comments: 0, proposals: 0 });
    expect(await commentsOn(fechada.code)).toBe(2);

    // Noutro ramo, "fecha" só comenta.
    const side = payload("refs/heads/feat/x", [
      { id: "c3d4e5f6a1b2", message: `fecha ${lateral.code}` },
    ]);
    const lateralResult = await handleGithubEvent(
      h.db,
      h.ws,
      "push",
      side,
      "t3",
    );
    expect(lateralResult).toMatchObject({ comments: 1, proposals: 0 });
    expect(await status(lateral.code)).toBe("todo");

    // Código que não existe é ignorado sem erro.
    const ghost = payload("refs/heads/main", [
      { id: "d4e5f6a1b2c3", message: "fecha HUB-999999" },
    ]);
    expect(
      await handleGithubEvent(h.db, h.ws, "push", ghost, "t4"),
    ).toMatchObject({ comments: 0, proposals: 0 });
  });

  it("pull_request: aberto comenta; mesclado com fecha HUB-n propõe a conclusão", async () => {
    const task = await newTask("Pelo PR");
    const pr = (action: string, merged = false) => ({
      action,
      repository: { full_name: "Harmony-Digital/exemplo" },
      pull_request: {
        number: 7,
        title: `Nova tela (${task.code})`,
        body: `Resumo.\n\nfecha ${task.code}`,
        html_url: "https://github.com/Harmony-Digital/exemplo/pull/7",
        merged,
        merge_commit_sha: merged ? "e5f6a1b2c3d4" : null,
      },
    });
    expect(
      await handleGithubEvent(h.db, h.ws, "pull_request", pr("opened"), "p1"),
    ).toMatchObject({ comments: 1, proposals: 0 });
    expect(await status(task.code)).toBe("todo");
    expect(
      await handleGithubEvent(
        h.db,
        h.ws,
        "pull_request",
        pr("closed", true),
        "p2",
      ),
    ).toMatchObject({ comments: 1, proposals: 1 });
    expect(await status(task.code)).toBe("review");
    expect(
      await handleGithubEvent(h.db, h.ws, "pull_request", pr("labeled"), "p3"),
    ).toMatchObject({ ignored: true });
    expect(
      await handleGithubEvent(h.db, h.ws, "issues", {}, "p4"),
    ).toMatchObject({ ignored: true });
    // Tudo com a origem webhook no histórico.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where source = 'webhook' and action = 'task.updated'`,
      ),
    ).toBeGreaterThan(0);
  });
});
