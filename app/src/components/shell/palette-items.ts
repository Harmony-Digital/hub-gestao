/**
 * Itens da janela ⌘K: telas, ações e o resultado da busca, já na ordem em que aparecem.
 * Puro (sem React nem servidor), para valer na tela e nos testes.
 */
import { ROLE_LABEL } from "@/lib/labels";

export type PaletteAction = "nova-tarefa" | "tema" | "concierge" | "atalhos";

export type PaletteItem = {
  id: string;
  group:
    | "Concierge"
    | "Ações"
    | "Telas"
    | "Projetos"
    | "Tarefas"
    | "Marcos"
    | "Frentes"
    | "Pessoas"
    | "Agentes";
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
  people: { id: string; name: string; role: string }[];
  agents: {
    id: string;
    name: string;
    status: string;
    department: string | null;
  }[];
};

export const SCREENS: { href: string; label: string; keywords?: string }[] = [
  { href: "/", label: "Hoje", keywords: "inicio painel decisoes" },
  {
    href: "/minhas-tarefas",
    label: "Minhas tarefas",
    keywords: "comigo atribuidas prazo",
  },
  { href: "/projetos", label: "Projetos" },
  {
    href: "/departamentos",
    label: "Departamentos",
    keywords: "carga equipe quadro areas",
  },
  { href: "/aprovacoes", label: "Aprovações", keywords: "pedidos decidir" },
  {
    href: "/relatorios",
    label: "Relatórios",
    keywords: "status semanal versoes cliente",
  },
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
  {
    href: "/modelos",
    label: "Modelos de projeto",
    keywords: "templates esqueleto novo projeto",
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    keywords:
      "equipe pessoas papel suspender workspace departamentos responsavel",
  },
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

/** Frase de três palavras ou mais: parece um pedido, não uma busca. */
export function looksLikeRequest(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length >= 3;
}

/** Texto mínimo para oferecer o Concierge. */
export const CONCIERGE_MIN = 3;

export function paletteItems({
  query,
  results,
  canCreateProject,
  dark = false,
  concierge = null,
}: {
  query: string;
  results: SearchResult | null;
  canCreateProject: boolean;
  /** O tema escuro está valendo (a ação oferece o outro). */
  dark?: boolean;
  /** Concierge: pronto, sem IA configurada ou (null) ainda não sabido. */
  concierge?: "ready" | "off" | null;
}): PaletteItem[] {
  const q = normalize(query);
  const items: PaletteItem[] = [];
  const text = query.trim();
  const ask: PaletteItem | null =
    concierge && text.length >= CONCIERGE_MIN
      ? {
          id: "concierge",
          group: "Concierge",
          label: `Pedir ao Concierge: “${text}”`,
          hint:
            concierge === "ready"
              ? "prévia antes de executar"
              : "sem IA configurada",
          action: "concierge",
        }
      : null;
  // Frase com cara de pedido: o Concierge vem primeiro (Enter pede); senão, por último.
  if (ask && looksLikeRequest(text)) items.push(ask);

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
  const theme: PaletteItem = {
    id: "acao-tema",
    group: "Ações",
    label: dark ? "Usar o tema claro" : "Usar o tema escuro",
    action: "tema",
  };
  if (matches(q, theme.label, "tema aparencia escuro claro modo noturno")) {
    items.push(theme);
  }
  const shortcuts: PaletteItem = {
    id: "acao-atalhos",
    group: "Ações",
    label: "Atalhos de teclado",
    hint: "?",
    action: "atalhos",
  };
  if (matches(q, shortcuts.label, "teclas teclado atalho desligar")) {
    items.push(shortcuts);
  }

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
      // Pessoa ou agente: a tela com as tarefas dele em todos os projetos (RF-38).
      ...(results.people ?? []).map((p) => ({
        id: `pessoa-${p.id}`,
        group: "Pessoas" as const,
        label: p.name,
        hint: Object.hasOwn(ROLE_LABEL, p.role)
          ? ROLE_LABEL[p.role as keyof typeof ROLE_LABEL]
          : p.role,
        href: `/responsaveis/${p.id}`,
      })),
      ...(results.agents ?? []).map((a) => ({
        id: `agente-${a.id}`,
        group: "Agentes" as const,
        label: a.name,
        hint: [
          a.department ?? "agente",
          a.status === "paused" ? "pausado" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/responsaveis/${a.id}`,
      })),
    );
  }
  if (ask && !looksLikeRequest(text)) items.push(ask);
  return items;
}

/** Próximo item ativo com as setas (dá a volta nas pontas). */
export function step(active: number, total: number, delta: 1 | -1): number {
  if (total === 0) return -1;
  if (active < 0) return delta === 1 ? 0 : total - 1;
  return (active + delta + total) % total;
}
