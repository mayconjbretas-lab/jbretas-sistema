# JBRETAS Sistema

SPA única, multi-módulo, autenticação centralizada via JWT (Supabase Auth + API Railway).

## Estrutura
- `/` — login único, redireciona por perfil
- `/shared/` — config, auth, fetch wrapper e CSS base compartilhados entre módulos
- `/modulos/fechamento/` — gerentes (mobile-first) ✅ em construção
- `/modulos/logistica/` — matriz de suprimentos (desktop) — pendente
- `/modulos/coleta-precos/` — coleta de preços — pendente
- `/modulos/copasa/` — consumo de água — pendente
- `/modulos/admin/` — dashboard, cadastros — pendente
- `/modulos/motorista/` — lançamentos de descarga — pendente

## Pendências conhecidas
1. Adicionar rota `GET /tanques/:posto` ao server.js (ver `server-patch-tanques.js`)
2. Popular tabela `tanques` no Supabase (hoje vazia) com os 37 postos
3. Portar tabelas de arqueação (cm→litros) — hoje todo tanque é tratado como leitura direta em litros
4. Configurar GitHub Pages + domínio customizado
