/**
 * Textos do Onboarding de Cliente (OB-13), prontos para a pessoa revisar e mandar: a
 * mensagem de convite que acompanha o link de acesso e o rascunho de boas-vindas do canal
 * do projeto. Regra em código, sem IA. O Hub nunca manda nada sozinho (D9): o dono copia
 * o convite e manda por onde preferir, ou manda pelo Hub, por e-mail, com o clique dele
 * (`docs/email.md`); a boas-vindas só entra no canal quando alguém da equipe envia. Puro:
 * vale na tela e nos testes.
 */

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** "o projeto X", "os projetos X e Y", "os projetos X, Y e Z" (até três, depois "e outros"). */
export function projectsPhrase(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return "os seus projetos com a gente";
  if (list.length === 1) return `o projeto ${list[0]}`;
  const shown = list.slice(0, 3);
  const rest = list.length > 3 ? " e outros" : "";
  const joined =
    shown.length === 2 && !rest
      ? `${shown[0]} e ${shown[1]}`
      : rest
        ? `${shown.join(", ")}${rest}`
        : `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}`;
  return `os projetos ${joined}`;
}

export function inviteMessage(input: {
  contactName: string;
  orgName: string;
  projects: string[];
  url: string;
  /** Até quando o link vale, já no formato da tela ("17/10"). */
  until: string;
}): string {
  return [
    `Olá, ${firstName(input.contactName)}! Tudo bem?`,
    "",
    `Liberamos para você o portal da ${input.orgName}. Por lá, você acompanha ${projectsPhrase(input.projects)}: as entregas, o andamento e a conversa com a nossa equipe.`,
    "",
    `Para entrar, use este link. Ele vale uma vez, até ${input.until}:`,
    input.url,
    "",
    "No primeiro acesso, você confirma o uso dos seus dados (LGPD). Qualquer dúvida, é só responder esta mensagem.",
  ].join("\n");
}

export function welcomeMessage(input: {
  projectName: string;
  orgName: string;
}): string {
  return `Olá! Este é o canal do projeto ${input.projectName} com a equipe da ${input.orgName}. Por aqui, você acompanha as novidades, tira dúvidas e recebe os nossos retornos. Pode escrever sempre que precisar.`;
}

/**
 * O convite por e-mail só sai com o link de uso único do próprio Hub dentro da mensagem
 * (a pessoa pode ter editado o texto e apagado o link sem querer).
 */
export function inviteHasLink(
  text: string,
  link: string,
  appUrl: string,
): boolean {
  const base = `${appUrl.replace(/\/+$/, "")}/portal/entrar/`;
  return (
    link.startsWith(base) && link.length > base.length && text.includes(link)
  );
}
