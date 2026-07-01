const ORDEM_COMB = [
  'GASOLINA COMUM', 'GASOLINA ADITIVADA', 'Gasolina Grid', 'Gasolina Octapro',
  'Gasolina Premium Podium', 'ETANOL', 'ETANOL ADITIVADO',
  'DIESEL S-10', 'DIESEL S-500', 'GNV',
];
app.get('/tanques/:posto', autenticar, async (req, res) => {
  const nomePosto = decodeURIComponent(req.params.posto);
  try {
    const { data: posto, error: errPosto } = await supabase
      .from('postos')
      .select('id, nome, codigo')
      .ilike('nome', nomePosto)
      .single();
    if (errPosto || !posto) {
      return res.status(404).json({ erro: `Posto não encontrado: ${nomePosto}` });
    }
    const perfil = req.usuario.perfil;
    if (perfil.perfil === 'GERENTE' && perfil.posto_id !== posto.id) {
      return res.status(403).json({ erro: 'Acesso negado a este posto' });
    }
    const { data: tanques, error: errTanques } = await supabase
      .from('tanques')
      .select('id, codigo, combustivel, capacidade, ativo, tipo_medicao')
      .eq('posto_id', posto.id)
      .eq('ativo', true);
    if (errTanques) throw errTanques;
    // Ordena pela ordem padronizada de combustível, não pela ordem física
    const tanquesOrdenados = (tanques || []).slice().sort((a, b) => {
      const ia = ORDEM_COMB.indexOf(a.combustivel);
      const ib = ORDEM_COMB.indexOf(b.combustivel);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    res.json({ success: true, posto: posto.nome, tanques: tanquesOrdenados });
  } catch (err) {
    console.error('Erro em /tanques:', err);
    res.status(500).json({ erro: err.message });
  }
});
