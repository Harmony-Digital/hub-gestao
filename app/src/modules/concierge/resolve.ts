import type {
  ConciergeContext,
  ContextMember,
  ContextProject,
} from "./context";
import type { ConciergeScreen } from "./intent";

/**
 * Conferência determinística do que a IA apontou: projeto, pessoa, código de tarefa,
 * data e tela. A IA pode errar (ou o ditado trocar letras); aqui só passa o que existe
 * no alcance de quem pede. O que não bate vira campo vazio na prévia, com um aviso. Puro.
 */

/** Minúsculas, sem acento e sem pontuação, para comparar nomes ditos. */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Um resultado só; dois ou mais é ambíguo (null). */
function only<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null;
}

/** Projeto pelo código (o normal) ou, se a IA mandou o nome, pelo nome ou pelo cliente. */
export function matchProject(
  value: string | null,
  ctx: ConciergeContext,
): ContextProject | null {
  if (!value?.trim()) return null;
  const code = value.trim().toUpperCase();
  const byCode = ctx.projects.find((p) => p.code === code);
  if (byCode) return byCode;
  const wanted = plain(value);
  if (!wanted) return null;
  return (
    only(ctx.projects.filter((p) => plain(p.name) === wanted)) ??
    only(
      ctx.projects.filter(
        (p) =>
          plain(p.name).includes(wanted) || plain(p.client).includes(wanted),
      ),
    )
  );
}

const ME = new Set(["eu", "me", "mim", "comigo", "para mim", "pra mim"]);

/** Pessoa ou agente da equipe pelo nome; "eu" é quem pede. */
export function matchMember(
  value: string | null,
  ctx: ConciergeContext,
): ContextMember | null {
  if (!value?.trim()) return null;
  const wanted = plain(value);
  if (!wanted) return null;
  if (ME.has(wanted)) {
    return { type: "user", id: ctx.me.id, name: ctx.me.name };
  }
  return (
    only(ctx.team.filter((m) => plain(m.name) === wanted)) ??
    only(ctx.team.filter((m) => plain(m.name).split(" ")[0] === wanted)) ??
    only(ctx.team.filter((m) => plain(m.name).includes(wanted)))
  );
}

/** "hub 12", "HUB12" ou "hub-12" → "HUB-12"; outra coisa → null. */
export function taskCode(value: string | null): string | null {
  const m = /^\s*([A-Za-z]{2,6})[\s-]*(\d{1,9})\s*$/.exec(value ?? "");
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

/** Data real no formato AAAA-MM-DD; outra coisa → null. */
export function isoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** Texto livre da IA: uma linha, aparado e no tamanho máximo do campo. */
export function clip(value: string | null, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const SCREEN_HREF: Record<
  Exclude<ConciergeScreen, "projeto" | "lista" | "quadro">,
  { href: string; label: string }
> = {
  hoje: { href: "/", label: "Hoje" },
  minhas_tarefas: { href: "/minhas-tarefas", label: "Minhas tarefas" },
  projetos: { href: "/projetos", label: "Projetos" },
  aprovacoes: { href: "/aprovacoes", label: "Aprovações" },
  caixa_de_entrada: { href: "/caixa-de-entrada", label: "Caixa de entrada" },
  sala_de_controle: { href: "/agentes", label: "Sala de Controle" },
  clientes: { href: "/clientes", label: "Clientes" },
  conta: { href: "/conta", label: "Minha conta" },
};

const PROJECT_VIEW: Record<"projeto" | "lista" | "quadro", string> = {
  projeto: "Visão geral",
  lista: "Lista",
  quadro: "Quadro",
};

/** Endereço e nome da tela pedida; tela de projeto sem projeto conhecido → null. */
export function screenTarget(
  screen: ConciergeScreen | null,
  project: ContextProject | null,
): { href: string; label: string } | null {
  if (!screen) return project ? screenTarget("projeto", project) : null;
  if (screen === "projeto" || screen === "lista" || screen === "quadro") {
    if (!project) return null;
    const suffix = screen === "projeto" ? "" : `/${screen}`;
    return {
      href: `/projetos/${project.code}${suffix}`,
      label: `${PROJECT_VIEW[screen]} de ${project.code} · ${project.name}`,
    };
  }
  return SCREEN_HREF[screen];
}

/** Valor do campo de responsável na prévia: "", "me", "user:<id>" ou "agent:<id>". */
export function memberValue(
  member: ContextMember | null,
  ctx: ConciergeContext,
): string {
  if (!member) return "";
  return member.type === "user" && member.id === ctx.me.id
    ? "me"
    : `${member.type}:${member.id}`;
}
