import type { SyncConflict, SyncSummary } from "@/modules/sync/service";

/** Resultado da importação (ou da prévia) que volta para a tela. */
export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      /** O texto enviado: "Importar" só vale para o mesmo texto da prévia. */
      sent: string;
      result: {
        dryRun: boolean;
        markdown: string;
        changed: boolean;
        summary: SyncSummary;
        milestones: { code: string; title: string; status: string }[];
        conflicts: SyncConflict[];
        /** Textos para o cliente do modelo que entraram (RF-36). */
        clientTexts: number;
      };
    };

export const IMPORT_IDLE: ImportState = { status: "idle" };
