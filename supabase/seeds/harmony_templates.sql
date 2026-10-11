-- Hub de Gestão · seed · os seis modelos de projeto iniciais da Harmony (PRD RF-36)
-- Esqueletos no formato do plan.md: marcos, frentes com o departamento, tarefas e os
-- critérios de aceite no GATE. São um ponto de partida: o dono e a administração ajustam
-- em Modelos de projeto. Idempotente: modelo que já existe (pelo nome) fica como está.

do $$
declare
  v_ws uuid;
begin
  select id into v_ws from proj_hub_gestao.workspaces where slug = 'harmony';
  if v_ws is null then
    return;
  end if;

  insert into proj_hub_gestao.project_templates (workspace_id, name, description, structure)
  values
  (v_ws, 'Site institucional',
   'Site de apresentação da empresa: descoberta e textos, design, construção e publicação no domínio do cliente.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'marketing-e-vendas', 'design', 'sistemas', 'sucesso-do-cliente'),
     'markdown', $tpl$# Modelo · Site institucional

## M1 — Descoberta e conteúdo

### Briefing e arquitetura

Departamento: Estratégia.

- [ ] Fazer a reunião de briefing com o cliente
- [ ] Registrar os objetivos do site e o público
- [ ] Definir o mapa do site (páginas e seções)

### Textos

Departamento: Marketing e Vendas.

- [ ] Escrever os textos das páginas
  - [ ] Página inicial
  - [ ] Sobre
  - [ ] Serviços
  - [ ] Contato
- [ ] Revisar os textos com o cliente

### GATE M1 (critérios de aceite)

- [ ] Mapa do site aprovado pelo cliente
- [ ] Textos principais aprovados

## M2 — Design

### Layout

Departamento: Design.

- [ ] Reunir as referências visuais e a identidade do cliente
- [ ] Desenhar a página inicial
- [ ] Desenhar as páginas internas
- [ ] Ajustar o layout para o celular

### GATE M2 (critérios de aceite)

- [ ] Layout aprovado pelo cliente, no computador e no celular

## M3 — Construção

### Desenvolvimento

Departamento: Sistemas.

- [ ] Montar as páginas no ambiente de teste
- [ ] Ligar o formulário de contato
- [ ] Configurar títulos, descrições e o mapa do site para buscadores
- [ ] Conferir velocidade e acessibilidade

### Conteúdo final

Departamento: Marketing e Vendas.

- [ ] Inserir os textos e as imagens finais
- [ ] Fazer a revisão final com o cliente

### GATE M3 (critérios de aceite)

- [ ] Site completo revisado pelo cliente no ambiente de teste

## M4 — Publicação

### Lançamento

Departamento: Sistemas.

- [ ] Apontar o domínio e ligar o certificado
- [ ] Ligar a medição de visitas
- [ ] Publicar e conferir todas as páginas no ar

### Entrega ao cliente

Departamento: Sucesso do Cliente.

- [ ] Entregar os acessos ao cliente
- [ ] Explicar como pedir ajustes

### GATE M4 (critérios de aceite)

- [ ] Site no ar no domínio do cliente
- [ ] Cliente com os acessos e o canal de ajustes
$tpl$)),

  (v_ws, 'Agente de atendimento WhatsApp',
   'Agente de IA que atende, tira dúvidas e agenda pelo WhatsApp, com passagem para a equipe quando precisa de uma pessoa.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'agentes-e-automacoes', 'sistemas', 'sucesso-do-cliente'),
     'markdown', $tpl$# Modelo · Agente de atendimento WhatsApp

## M1 — Diagnóstico do atendimento

### Mapeamento

Departamento: Estratégia.

- [ ] Levantar as perguntas mais frequentes dos clientes
- [ ] Mapear como o atendimento funciona hoje
- [ ] Definir o que o agente resolve e o que passa para a equipe

### GATE M1 (critérios de aceite)

- [ ] Escopo do agente aprovado pelo cliente

## M2 — Agente em teste

### Fluxo de conversa

Departamento: Agentes e Automações.

- [ ] Escrever o roteiro e o tom das respostas
- [ ] Montar a base de conhecimento
- [ ] Definir as regras de passagem para uma pessoa

### Integrações

Departamento: Sistemas.

- [ ] Ligar o número do WhatsApp
- [ ] Ligar a agenda ou o sistema de cadastro
- [ ] Guardar o registro das conversas

### GATE M2 (critérios de aceite)

- [ ] Agente responde certo as perguntas do teste
- [ ] Passagem para uma pessoa funciona

## M3 — Piloto com clientes reais

### Piloto

Departamento: Agentes e Automações.

- [ ] Ligar o agente em parte do atendimento
- [ ] Revisar as conversas e ajustar as respostas
- [ ] Medir quantos atendimentos o agente resolveu

### GATE M3 (critérios de aceite)

- [ ] Taxa de acerto combinada com o cliente
- [ ] Equipe do cliente validou a passagem

## M4 — Operação

### Rotina

Departamento: Sucesso do Cliente.

- [ ] Treinar a equipe do cliente
- [ ] Enviar o relatório do primeiro mês
- [ ] Combinar o canal de ajustes

### GATE M4 (critérios de aceite)

- [ ] Agente atendendo todo o volume combinado
- [ ] Relatório do primeiro mês entregue
$tpl$)),

  (v_ws, 'Sistema sob medida com IA',
   'Sistema web feito para o processo do cliente, com IA onde ela ajuda: descoberta, protótipo, construção e implantação.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'design', 'sistemas', 'agentes-e-automacoes', 'dados', 'sucesso-do-cliente'),
     'markdown', $tpl$# Modelo · Sistema sob medida com IA

## M1 — Descoberta

### Processo atual

Departamento: Estratégia.

- [ ] Entrevistar as pessoas que usam o processo
- [ ] Desenhar o mapa do processo atual
- [ ] Escrever os requisitos e as prioridades (PRD)

### GATE M1 (critérios de aceite)

- [ ] PRD aprovado pelo cliente

## M2 — Protótipo

### Telas

Departamento: Design.

- [ ] Desenhar o fluxo principal
- [ ] Montar o protótipo navegável
- [ ] Validar o protótipo com quem vai usar

### GATE M2 (critérios de aceite)

- [ ] Protótipo aprovado pelo cliente

## M3 — Construção

### Sistema

Departamento: Sistemas.

- [ ] Montar a base, o login e as permissões
- [ ] Construir as telas do fluxo principal
- [ ] Escrever os testes automatizados

### Inteligência artificial

Departamento: Agentes e Automações.

- [ ] Construir as funções de IA, com o sistema funcionando sem elas
- [ ] Definir o custo e os limites de uso da IA

### Dados

Departamento: Dados.

- [ ] Trazer os dados que o cliente já tem
- [ ] Montar os relatórios principais

### GATE M3 (critérios de aceite)

- [ ] Fluxo principal funcionando no ambiente de teste
- [ ] Testes automatizados passando

## M4 — Implantação

### Produção

Departamento: Sistemas.

- [ ] Publicar em produção, com cópia de segurança e monitoramento
- [ ] Conferir o sistema no ar com o cliente

### Treinamento e suporte

Departamento: Sucesso do Cliente.

- [ ] Treinar a equipe do cliente
- [ ] Acompanhar o primeiro mês de uso

### GATE M4 (critérios de aceite)

- [ ] Sistema em produção
- [ ] Equipe do cliente treinada
$tpl$)),

  (v_ws, 'Posicionamento de marca',
   'Diagnóstico, estratégia e manual de posicionamento da marca, com exemplos de aplicação.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'marketing-e-vendas', 'design'),
     'markdown', $tpl$# Modelo · Posicionamento de marca

## M1 — Diagnóstico

### Pesquisa

Departamento: Estratégia.

- [ ] Entrevistar os sócios
- [ ] Ouvir clientes da marca
- [ ] Analisar os concorrentes
- [ ] Escrever o diagnóstico da marca atual

### GATE M1 (critérios de aceite)

- [ ] Diagnóstico apresentado ao cliente

## M2 — Estratégia

### Proposta de posicionamento

Departamento: Estratégia.

- [ ] Definir o público e a proposta de valor
- [ ] Definir os diferenciais e as provas
- [ ] Escrever a mensagem central e o tom de voz

### GATE M2 (critérios de aceite)

- [ ] Posicionamento aprovado pelo cliente

## M3 — Manual e aplicação

### Manual de posicionamento

Departamento: Marketing e Vendas.

- [ ] Escrever o manual de posicionamento
- [ ] Preparar exemplos de aplicação (site, redes sociais e proposta comercial)

### Identidade

Departamento: Design.

- [ ] Ajustar a identidade visual ao posicionamento

### GATE M3 (critérios de aceite)

- [ ] Manual entregue ao cliente
- [ ] Apresentação feita para a equipe do cliente
$tpl$)),

  (v_ws, 'Funil de aquisição',
   'Funil de marketing e vendas: oferta, captação, nutrição e conversão, com métricas de cada etapa.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'marketing-e-vendas', 'design', 'agentes-e-automacoes', 'dados'),
     'markdown', $tpl$# Modelo · Funil de aquisição

## M1 — Estratégia do funil

### Oferta e público

Departamento: Estratégia.

- [ ] Definir a oferta, o público e as etapas do funil
- [ ] Combinar as metas e o orçamento

### GATE M1 (critérios de aceite)

- [ ] Plano do funil aprovado pelo cliente

## M2 — Estrutura do funil

### Páginas e criativos

Departamento: Design.

- [ ] Desenhar a página de captura
- [ ] Criar os criativos dos anúncios

### Automação

Departamento: Agentes e Automações.

- [ ] Montar a nutrição por e-mail ou WhatsApp
- [ ] Ligar o funil ao sistema de vendas do cliente

### Medição

Departamento: Dados.

- [ ] Ligar o rastreamento das conversões
- [ ] Montar o painel de métricas

### GATE M2 (critérios de aceite)

- [ ] Funil completo testado de ponta a ponta

## M3 — Lançamento e otimização

### Campanhas

Departamento: Marketing e Vendas.

- [ ] Lançar as campanhas
- [ ] Testar variações de página e de anúncio
- [ ] Enviar o relatório semanal

### GATE M3 (critérios de aceite)

- [ ] Metas do primeiro ciclo medidas e apresentadas
$tpl$)),

  (v_ws, 'Monitoramento e inteligência',
   'Monitoramento de mercado, concorrentes e menções, com relatórios periódicos e alertas.',
   jsonb_build_object('format', 'plan_md', 'departments',
     jsonb_build_array('estrategia', 'dados', 'agentes-e-automacoes'),
     'markdown', $tpl$# Modelo · Monitoramento e inteligência

## M1 — Escopo

### Definição

Departamento: Estratégia.

- [ ] Definir os temas, as fontes e os concorrentes
- [ ] Definir as perguntas que o relatório responde

### GATE M1 (critérios de aceite)

- [ ] Escopo aprovado pelo cliente

## M2 — Coleta e análise

### Coleta

Departamento: Agentes e Automações.

- [ ] Ligar as fontes de dados
- [ ] Classificar as menções automaticamente

### Análise

Departamento: Dados.

- [ ] Montar o painel do monitoramento
- [ ] Escrever a primeira análise com recomendações

### GATE M2 (critérios de aceite)

- [ ] Primeiro relatório entregue ao cliente

## M3 — Rotina

### Relatórios e alertas

Departamento: Dados.

- [ ] Enviar o relatório periódico
- [ ] Ligar os alertas do que é urgente
- [ ] Revisar o escopo a cada trimestre

### GATE M3 (critérios de aceite)

- [ ] Rotina de relatórios funcionando
$tpl$))
  on conflict (workspace_id, name) do nothing;
end
$$;
