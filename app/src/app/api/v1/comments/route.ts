import { z } from "zod";
import { apiRoute, created, ok, parseQuery } from "@/lib/http/api";
import {
  CommentTarget,
  createComment,
  CreateCommentInput,
  listComments,
} from "@/modules/comments/service";

/** Comentários de tarefa, projeto, marco ou frente: ?task= | ?project= | ?milestone_id= | ?workstream_id= */
export const GET = apiRoute({
  handler: async ({ t, url }) =>
    ok(await listComments(t, parseQuery(url, CommentTarget))),
});

/** Comentário interno. Corpo: { target: { task | project | milestone_id | workstream_id }, body_md }. */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) => {
    const input = z
      .strictObject({
        target: CommentTarget,
        body_md: CreateCommentInput.shape.body_md,
        mentions: CreateCommentInput.shape.mentions,
      })
      .parse(body);
    return created(
      await createComment(t, input.target, {
        body_md: input.body_md,
        mentions: input.mentions,
      }),
    );
  },
});
