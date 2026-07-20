// ================================================================
// JBRETAS SISTEMA — Configuração central
// Único lugar onde a URL da API é definida. Se o domínio do Railway
// mudar, só precisa atualizar aqui.
// ================================================================

window.JBRETAS_CONFIG = {
  API_URL: 'https://jbretas-api-service-production.up.railway.app',
  // Mapa de perfil → rota inicial após login.
  // Usado pelo shared/js/auth.js para redirecionar automaticamente.
  ROTAS_POR_PERFIL: {
    GERENTE:    '/modulos/fechamento/',
    ADM:        '/modulos/admin/',
    LOGISTICA:  '/modulos/logistica/',
    MOTORISTA:  '/modulos/motorista/',
    SUPERVISOR: '/modulos/supervisor/',
  },
};
