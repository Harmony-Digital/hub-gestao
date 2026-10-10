export type PlannerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      /** A proposta no formato do plan.md, para revisar e importar. */
      markdown: string;
      counts: {
        milestones: number;
        workstreams: number;
        tasks: number;
        subtasks: number;
      };
      assumptions: string[];
      costUsd: number;
    };

export const PLANNER_IDLE: PlannerState = { status: "idle" };
