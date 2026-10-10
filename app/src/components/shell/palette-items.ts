/**
 * Itens da janela ⌘K: telas, ações e o resultado da busca, já na ordem em que aparecem.
 * Puro (sem React nem servidor), para valer na tela e nos testes.
 */

export type PaletteAction = "nova-tarefa";

export type PaletteItem = {
  id: string;
  group: "Ações" | "Telas" | "Projetos" | "Tarefas" | "Marcos" | "Frentes";
  label: string;
  /** Texto curto ao lado (código, projeto, situação). */
  hint?: string;
  href?: string;
  action?: PaletteAction;
};

export type SearchResult = {
  projects: { code: string; name: string }[];
  tasks: {
    code: string;
    project_code: string;
    title: string;
    status_category: string;
  }[];
  milestones: {
    id: string;
    project_code: string;
    code: string;
    title: string;
  }[];
  workstreams: { id: string; project_code: string; title: string }[];
};

export const SCREENS: { href: string; label: string; keywords?: string }[] = [
  { href: "/", label: "Hoje", keywords: "inicio painel decisoes" },
  {
    href: "/minhas-tarefas",
    label: "Minhas tarefas",
    keywords: "comigo atribuidas prazo",
  },
  { href: "/projetos", label: "Projetos" },
  { href: "/aprovacoes", label: "Aprovações", keywords: "pedidos decidir" },
  {
    href: "/caixa-de-entrada",
    label: "Caixa de entrada",
    keywords: "avisos notificacoes",
  },
  {
    href: "/agentes",
    label: "Sala de Controle",
    keywords: "agentes chaves recusas",
  },
  { href: "/clientes", label: "Clientes" },
  { href: "/conta", label: "Minha conta", keywords: "senha perfil" },
];

const DONE_HINT: Record<string, string> = {
  done: "concluída",
  blocked: "bloqueada",
};

/** Minúsculas e sem acento, para "aprovacoes" achar "Aprovações". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matches(query: string, ...texts: (string | undefined)[]): boolean {
  if (!query) return true;
  return texts.some((t) => t !== undefined && normalize(t).includes(query));
}

export function paletteItems({
  query,
  results,
  canCreateProject,
}: {
  query: string;
  results: SearchResult | null;
  canCreateProject: boolean;
}): PaletteItem[] {
  const q = normalize(query);
  const items: PaletteItem[] = [];

  const actions: PaletteItem[] = [
    {
      id: "acao-nova-tarefa",
      group: "Ações",
      label: "Nova tarefa",
      hint: "em qualquer projeto",
      action: "nova-tarefa",
    },
  ];
  if (canCreateProject) {
    actions.push({
      id: "acao-novo-projeto",
      group: "Ações",
      label: "Novo projeto",
      href: "/projetos/novo",
    });
  }
  items.push(...actions.filter((a) => matches(q, a.label, "criar")));

  items.push(
    ...SCREENS.filter((s) => matches(q, s.label, s.keywords)).map((s) => ({
      id: `tela-${s.href}`,
      group: "Telas" as const,
      label: s.label,
      href: s.href,
    })),
  );

  if (results) {
    items.push(
      ...results.projects.map((p) => ({
        id: `projeto-${p.code}`,
        group: "Projetos" as const,
        label: p.name,
        hint: p.code,
        href: `/projetos/${p.code}`,
      })),
      ...results.tasks.map((t) => ({
        id: `tarefa-${t.code}`,
        group: "Tarefas" as const,
        label: t.title,
        hint: [t.code, DONE_HINT[t.status_category]]
          .filter(Boolean)
          .join(" · "),
        href: `/projetos/${t.project_code}/lista?tarefa=${t.code}`,
      })),
      ...results.milestones.map((m) => ({
        id: `marco-${m.id}`,
        group: "Marcos" as const,
        label: m.title,
        hint: `${m.project_code} · ${m.code}`,
        href: `/projetos/${m.project_code}`,
      })),
      ...results.workstreams.map((w) => ({
        id: `frente-${w.id}`,
        group: "Frentes" as const,
        label: w.title,
        hint: w.project_code,
        href: `/projetos/${w.project_code}`,
      })),
    );
  }
  return items;
}

/** Próximo item ativo com as setas (dá a volta nas pontas). */
export function step(active: number, total: number, delta: 1 | -1): number {
  if (total === 0) return -1;
  if (active < 0) return delta === 1 ? 0 : total - 1;
  return (active + delta + total) % total;
}
