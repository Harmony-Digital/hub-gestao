import { z } from "zod";
import { apiRoute, created, ok, parseQuery } from "@/lib/http/api";
import { ProjectCode } from "@/modules/common";
import {
  draftReport,
  DraftReportInput,
  listReports,
} from "@/modules/reports/service";

/** Relatórios de status do projeto (?project=CODE), rascunhos e publicados. */
export const GET = apiRoute({
  handler: async ({ t, url }) => {
    const { project } = parseQuery(
      url,
      z.strictObject({ project: ProjectCode }),
    );
    return ok(await listReports(t, project));
  },
});

/** Rascunho de status; vira aprovação pendente e só é publicado com o "sim" do Fábio. */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) =>
    created(await draftReport(t, DraftReportInput.parse(body))),
});
