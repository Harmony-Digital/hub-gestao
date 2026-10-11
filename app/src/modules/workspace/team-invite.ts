/**
 * Convite da equipe por e-mail (RF-03): o texto, puro. Quem recebe já está na equipe (o
 * dono pôs em Configurações → Equipe); o e-mail diz por onde entrar. O Hub não cria conta
 * de acesso: quem ainda não tem login entra pelo link de acesso por e-mail, quando ligado,
 * ou espera o convite da Harmony com a senha.
 */
export function teamInviteEmail(input: {
  name: string;
  orgName: string;
  role: "admin" | "member";
  loginUrl: string;
  magicLink: boolean;
}): { subject: string; text: string } {
  const first = input.name.trim().split(/\s+/)[0] || input.name;
  return {
    subject: `Você está na equipe da ${input.orgName} no Hub de Gestão`,
    text: [
      `Olá, ${first}!`,
      "",
      `Você entrou na equipe da ${input.orgName} no Hub de Gestão, onde acompanhamos os projetos, as tarefas e as decisões${input.role === "admin" ? " (com o papel de administração)" : ""}.`,
      "",
      `Para entrar, use este endereço com este e-mail: ${input.loginUrl}`,
      input.magicLink
        ? "No primeiro acesso, peça o link de acesso por e-mail na própria tela de entrada; depois, se quiser, defina a sua senha em Minha conta."
        : "Se ainda não tem senha, aguarde o convite de acesso da equipe; a senha, você mesmo define.",
      "",
      "Qualquer dúvida, é só responder esta mensagem.",
    ].join("\n"),
  };
}
