import { apiRoute, created, ok } from "@/lib/http/api";
import {
  createComment,
  CreateCommentInput,
  listComments,
} from "@/modules/comments/service";

/** Comentários da tarefa (sempre internos). */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) =>
    ok(await listComments(t, { task: params.code })),
});

export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    created(
      await createComment(
        t,
        { task: params.code },
        CreateCommentInput.parse(body),
      ),
    ),
});
