# Dashboard Prêmio Sebrae

Dashboard analítico interativo das participações da base consolidada de 2010 a 2025.

## Executar

```bash
npm run import
npm start
```

Abra `http://localhost:3000`.

`npm run import` lê `PREMIO SEBRAE - CONSOLIDADO OFICIAL.csv`, valida os campos, normaliza chaves de comparação e gera `data/normalized.json`. Os períodos disponíveis e categorias são derivados da fonte; períodos sem registros não são inventados. Rótulos como `2009 / 2010` e `2011 / 2012` são mantidos como um único período, sem expansão para dois registros. A importação é idempotente pela chave `empresa + período + tipo`; linhas duplicadas ou inválidas ficam registradas em `data/import.log`.

Durante `npm start`, o servidor verifica a versão do CSV a cada requisição. Depois de salvar alterações na planilha, basta recarregar o dashboard; a fonte será reimportada automaticamente, sem reiniciar o servidor.

## Estrutura

- `src/normalizer.js`: parser CSV, validação, canonicalização e deduplicação.
- `src/analytics.js`: única camada de regras para KPIs, séries, recorrência, sequências, retenção e comparação.
- `server.js`: serviço HTTP sem dependências externas, API e exportação filtrada.
- `public/`: interface responsiva com SVG interativo, tabela analítica, perfil e cross-filtering.
- `test/analytics.test.js`: testes das regras centrais.

Endpoints principais: `GET /api/dashboard`, `GET /api/compare` e `GET /api/export.csv`. Todos aceitam os filtros globais; os gráficos e a tabela consultam a mesma API.
