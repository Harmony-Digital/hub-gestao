import { audit } from "@/lib/audit";
import { json, many, S, type TxCtx } from "@/modules/context";
import { emitEvent, recomputeRollup } from "@/modules/events";
import { computeHealth, type Health } from "@/modules/health/rule";
import { dependencyAlertsOf } from "@/modules/workstreams/dependencies";

/**
 * Recalcula progresso e saúde de todos os projetos em andamento. Grava só quando a
 * saúde muda, com registro de atividade e evento project.health_changed.
 */
export async function refreshAllHealth(
  t: TxCtx,
  now: Date,
): Promise<{ projects: number; changed: string[] }> {
  const projects = await many<{ id: string; code: string }>(
    t,
    `select id, code from ${S}.projects
      where archived_at is null and status not in ('archived', 'delivered')
      order by code`,
  );
  const changed: string[] = [];
  for (const project of projects) {
    await recomputeRollup(t, project.id);
    const row = (
      await many<{
        open_task_count: number;
        blocked_task_count: number;
        late_milestones: number;
        oldest_pending_approval_at: Date | string | null;
        health: Health;
        health_reason: Record<string, unknown>;
      }>(
        t,
        `select v.open_task_count, v.blocked_task_count, v.late_milestones,
                v.oldest_pending_approval_at, p.health, p.health_reason
           from ${S}.v_project_health_inputs v
           join ${S}.projects p on p.id = v.project_id
          where v.project_id = $1`,
        [project.id],
      )
    )[0];
    if (!row) continue;
    const broken = (await dependencyAlertsOf(t, project.id)).length;
    const result = computeHealth({ ...row, broken_dependencies: broken }, now);
    // Os sinais com o tipo vão junto das frases: o Hoje mostra a ação de cada um (RF-24).
    const reasons = { reasons: result.reasons, signals: result.signals };
    if (
      result.health === row.health &&
      JSON.stringify(reasons) === JSON.stringify(row.health_reason ?? {})
    ) {
      continue;
    }
    await t.tx.query(
      `update ${S}.projects set health = $2, health_reason = $3::jsonb where id = $1`,
      [project.id, result.health, json(reasons)],
    );
    if (result.health !== row.health) {
      changed.push(project.code);
      await audit(t, {
        action: "project.health_changed",
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        before: { health: row.health },
        after: { health: result.health, reasons: result.reasons },
      });
      await emitEvent(t, "project.health_changed", {
        project_code: project.code,
        health: result.health,
        reasons: result.reasons,
      });
    }
  }
  return { projects: projects.length, changed };
}
