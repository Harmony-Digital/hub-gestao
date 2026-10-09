# Hub de Gestão · app

Aplicação Next.js 16 do Hub de Gestão da Harmony Digital: interface, API para agentes e, a partir do M1, servidor MCP.

```bash
npm ci
npm run dev      # http://localhost:3000
npm run check    # formato, lint, tipos, testes e build
```

- Instruções para IAs e pessoas: `AGENTS.md` (este app) e `../AGENTS.md` (projeto).
- Saúde do serviço: `GET /api/health`.
- Variáveis de ambiente: `.env.example` e `../docs/credenciais.md`.
