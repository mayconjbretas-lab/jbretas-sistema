// ================================================================
// JBRETAS SISTEMA — modulos/supervisor/calibrador.js
// Aba CALIBRADOR do supervisor. Expoe window.renderCalibrador(sec),
// chamado pelo setTab (mesmo padrao das outras abas do modulo).
//
// O FLUXO REAL: o supervisor vai ao posto, le o encerrante de cada
// equipamento, recolhe o dinheiro e assina um protocolo em papel. Cada
// uso custa R$ 1,00 (valor_uso, do cadastro), entao a diferenca entre
// final e inicial JA E o valor esperado em reais.
//
// PRE-PREENCHIMENTO: o Inicial vem do FINAL da coleta anterior daquele
// equipamento (a API resolve isso em ultimo_final). E como a planilha
// funcionava, e digitar de novo o que ja se sabe e a forma mais barata
// de introduzir erro. O campo continua editavel — equipamento trocado
// ou zerado precisa de correcao a mao.
//
// FOTOS OBRIGATORIAS, MAS NAO BLOQUEIAM. A tela exige as duas antes de
// deixar salvar. O que muda e o que acontece DEPOIS: os numeros sobem
// primeiro, sozinhos (~1 KB), e cada foto vai numa chamada propria. Num
// posto com sinal ruim o JSON passa e a foto nao — e o lancamento nao
// se perde. A coleta nasce PENDENTE_FOTO e ele completa pela lista.
// Foto guardada so no celular NAO e comprovante: se o aparelho quebrar,
// some. Por isso o incompleto vive no servidor, nao aqui.
// ================================================================
(function () {
  'use strict';

  let _pronto     = false;
  let _postos     = [];      // GET /calibrador/postos
  let _postoAtual = null;    // { id, nome, destinos: [] }
  let _equips     = [];      // do posto atual, com ultimo_final
  let _fotos      = { encerrante: null, protocolo: null };   // dataURL comprimido
  let _salvando   = false;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hojeISO = () => { const d = new Date(); return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const numDe = (v) => { const n = Number(String(v).replace(',', '.').trim()); return Number.isFinite(n) ? n : null; };

  // ── Shell ───────────────────────────────────────────────────────
  function montar(sec) {
    sec.innerHTML =
      '<div class="cal-wrap">' +
        '<div class="cal-topo">' +
          '<select class="cal-sel" id="cal-posto"><option value="">Carregando postos…</option></select>' +
          '<input type="date" class="cal-data" id="cal-data" value="' + hojeISO() + '">' +
        '</div>' +
        '<div class="cal-destino" id="cal-destino" hidden></div>' +
        '<div class="cal-equips" id="cal-equips">' +
          '<div class="cal-msg">Escolha o posto para ver os equipamentos.</div>' +
        '</div>' +
        '<div class="cal-caixa" id="cal-caixa" hidden>' +
          '<div class="cal-linha"><span>Esperado pelo encerrante</span>' +
            '<b class="cal-esperado" id="cal-esperado">R$ 0,00</b></div>' +
          '<label class="cal-linha cal-linha-in"><span>Valor recolhido</span>' +
            '<input type="text" inputmode="decimal" class="cal-in-dinheiro" id="cal-recolhido" placeholder="0,00"></label>' +
          '<div class="cal-dif" id="cal-dif" hidden></div>' +
        '</div>' +
        '<textarea class="cal-obs" id="cal-obs" rows="2" placeholder="Observação (opcional)" hidden></textarea>' +
        '<div class="cal-fotos" id="cal-fotos" hidden>' +
          botaoFoto('encerrante', '📷 Foto dos encerrantes') +
          botaoFoto('protocolo',  '📄 Foto do protocolo') +
        '</div>' +
        '<div class="cal-assin" id="cal-assin" hidden>' +
          '<div class="cal-resp">Responsável: <b id="cal-resp-nome">—</b></div>' +
          '<label class="cal-linha cal-linha-in"><span>Gerente presente</span>' +
            '<input type="text" class="cal-in-texto" id="cal-gerente" placeholder="nome de quem acompanhou"></label>' +
        '</div>' +
        '<button class="cal-salvar" id="cal-salvar" hidden disabled>Salvar coleta</button>' +
        '<div class="cal-aviso" id="cal-aviso" hidden></div>' +
      '</div>';

    sec.querySelector('#cal-posto').onchange = trocarPosto;
    sec.querySelector('#cal-recolhido').oninput = recalcular;
    sec.querySelector('#cal-salvar').onclick = salvar;
    ['encerrante', 'protocolo'].forEach(t => {
      sec.querySelector('#cal-file-' + t).onchange = (e) => pegarFoto(t, e.target);
    });
    const u = (typeof USUARIO !== 'undefined' && USUARIO) ? USUARIO : null;
    sec.querySelector('#cal-resp-nome').textContent = (u && (u.nome || u.email)) || '—';
    _pronto = true;
  }

  const botaoFoto = (tipo, rotulo) =>
    '<label class="cal-foto" id="cal-foto-' + tipo + '">' +
      '<input type="file" accept="image/*" capture="environment" id="cal-file-' + tipo + '" hidden>' +
      '<span class="cal-foto-lbl">' + rotulo + '</span>' +
      '<span class="cal-foto-ok" hidden>✓</span>' +
    '</label>';

  // ── Carga ───────────────────────────────────────────────────────
  async function carregarPostos() {
    const sel = document.getElementById('cal-posto');
    try {
      // A rota devolve so os postos da REGIONAL do supervisor logado (ADM e
      // TI continuam vendo a rede). O filtro de verdade e no backend — aqui
      // so se exibe o que veio.
      const r = await apiFetch('/calibrador/postos');
      _postos = r.postos || [];

      // Lista vazia tem TRES causas diferentes, e um seletor mudo nao
      // distingue nenhuma: o supervisor conclui que a tela quebrou. A API
      // manda `escopo` justamente para isto.
      if (!_postos.length) {
        sel.innerHTML = '<option value="">—</option>';
        if (r.escopo === 'SEM_REGIONAL') {
          mostrarAviso('Seu usuário não tem regional definida, então não há postos a mostrar. ' +
            'Peça ao TI para preencher o campo Regional no seu cadastro.', true);
        } else if (r.escopo === 'REGIONAL') {
          mostrarAviso('Nenhum posto da regional ' + (r.regional || '') +
            ' tem calibrador cadastrado.', false);
        } else {
          mostrarAviso('Nenhum posto com calibrador cadastrado.', false);
        }
        return;
      }

      sel.innerHTML = '<option value="">Selecione o posto…</option>' +
        _postos.map(p => '<option value="' + esc(p.nome) + '">' + esc(p.nome) + '</option>').join('');
    } catch (err) {
      sel.innerHTML = '<option value="">Erro ao carregar</option>';
      mostrarAviso('Erro ao carregar postos: ' + (err.message || err), true);
    }
  }

  async function trocarPosto() {
    const nome = document.getElementById('cal-posto').value;
    _postoAtual = _postos.find(p => p.nome === nome) || null;
    _fotos = { encerrante: null, protocolo: null };
    ['encerrante', 'protocolo'].forEach(marcarFoto);
    const host = document.getElementById('cal-equips');
    mostrarBlocos(!!_postoAtual);
    if (!_postoAtual) {
      host.innerHTML = '<div class="cal-msg">Escolha o posto para ver os equipamentos.</div>';
      document.getElementById('cal-destino').hidden = true;
      return;
    }
    // DESTINO no cabecalho: o supervisor precisa saber, na hora, se leva
    // o dinheiro para o Eduardo ou se deposita.
    const dest = document.getElementById('cal-destino');
    const ds = _postoAtual.destinos || [];
    dest.hidden = false;
    dest.className = 'cal-destino' + (ds.length > 1 ? ' cal-destino-erro' : '');
    dest.textContent = ds.length > 1
      ? '⚠ Equipamentos com destinos diferentes: ' + ds.join(' e ') + ' — confira o cadastro'
      : 'Destino: ' + (ds[0] || '—');

    host.innerHTML = '<div class="cal-msg">Carregando equipamentos…</div>';
    try {
      const r = await apiFetch('/calibrador/equipamentos/' + encodeURIComponent(nome));
      _equips = r.equipamentos || [];
      renderEquipamentos();
    } catch (err) {
      host.innerHTML = '<div class="cal-erro">Erro: ' + esc(err.message || err) + '</div>';
    }
  }

  function renderEquipamentos() {
    const host = document.getElementById('cal-equips');
    if (!_equips.length) {
      host.innerHTML = '<div class="cal-msg">Nenhum equipamento ativo neste posto.</div>';
      return;
    }
    host.innerHTML = _equips.map((e, i) =>
      '<div class="cal-eq" data-i="' + i + '">' +
        '<div class="cal-eq-nome">' + esc(e.nome) +
          (e.valor_uso !== 1 ? '<span class="cal-eq-uso">' + brl(e.valor_uso) + '/uso</span>' : '') +
        '</div>' +
        '<div class="cal-eq-campos">' +
          '<label><span>Inicial</span>' +
            '<input type="text" inputmode="numeric" class="cal-in cal-in-ini" ' +
            (e.ultimo_final != null ? 'value="' + e.ultimo_final + '"' : '') + '></label>' +
          '<label><span>Final</span>' +
            '<input type="text" inputmode="numeric" class="cal-in cal-in-fim"></label>' +
          '<div class="cal-eq-res"><span>Usos</span><b class="cal-eq-usos">—</b></div>' +
        '</div>' +
        (e.ultimo_final != null
          ? '<div class="cal-eq-dica">inicial veio da coleta de ' + esc(e.ultimo_final_data || '—') + '</div>'
          : '<div class="cal-eq-dica cal-eq-dica-alerta">sem coleta anterior — digite o inicial</div>') +
      '</div>').join('');
    host.querySelectorAll('.cal-in').forEach(i => { i.oninput = recalcular; });
    recalcular();
  }

  // ── Calculo ao vivo ─────────────────────────────────────────────
  // Espelha a conta que o backend refaz: usos = final - inicial, valor =
  // usos * valor_uso. O backend NAO confia neste numero — ele recalcula
  // com o valor_uso do cadastro. Aqui e so para o supervisor ver.
  function recalcular() {
    let esperado = 0, completo = _equips.length > 0;
    document.querySelectorAll('#cal-equips .cal-eq').forEach(div => {
      const e = _equips[Number(div.dataset.i)];
      const ini = numDe(div.querySelector('.cal-in-ini').value);
      const fim = numDe(div.querySelector('.cal-in-fim').value);
      const alvo = div.querySelector('.cal-eq-usos');
      div.classList.remove('cal-eq-invalido');
      if (ini == null || fim == null) { alvo.textContent = '—'; completo = false; return; }
      if (fim < ini) {
        alvo.textContent = '↓';
        div.classList.add('cal-eq-invalido');
        completo = false;
        return;
      }
      const usos = fim - ini;
      alvo.textContent = usos.toLocaleString('pt-BR');
      esperado += usos * Number(e.valor_uso);
    });
    document.getElementById('cal-esperado').textContent = brl(esperado);

    const recolhido = numDe(document.getElementById('cal-recolhido').value);
    const divDif = document.getElementById('cal-dif');
    if (recolhido == null) {
      divDif.hidden = true;
    } else {
      const d = recolhido - esperado;
      divDif.hidden = false;
      // VERDE quando sobra, vermelho quando falta — como voce pediu.
      divDif.className = 'cal-dif ' + (Math.abs(d) < 0.005 ? 'cal-dif-zero' : (d > 0 ? 'cal-dif-sobra' : 'cal-dif-falta'));
      divDif.textContent = Math.abs(d) < 0.005 ? 'Confere — ' + brl(0)
        : (d > 0 ? 'Sobra ' : 'Falta ') + brl(Math.abs(d));
    }

    const btn = document.getElementById('cal-salvar');
    const temFotos = !!(_fotos.encerrante && _fotos.protocolo);
    btn.disabled = _salvando || !completo || recolhido == null || !temFotos;
    btn.textContent = _salvando ? 'Salvando…'
      : !completo ? 'Preencha as leituras'
      : recolhido == null ? 'Informe o valor recolhido'
      : !temFotos ? 'Faltam as duas fotos'
      : 'Salvar coleta';
  }

  function mostrarBlocos(ligado) {
    ['cal-caixa', 'cal-obs', 'cal-fotos', 'cal-assin', 'cal-salvar'].forEach(id => {
      document.getElementById(id).hidden = !ligado;
    });
  }

  // ── Fotos ───────────────────────────────────────────────────────
  function pegarFoto(tipo, input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      window.jbComprimirFoto(reader.result, (comprimida) => {
        _fotos[tipo] = comprimida;
        marcarFoto(tipo);
        recalcular();
      });
    };
    reader.readAsDataURL(f);
  }

  function marcarFoto(tipo) {
    const lbl = document.getElementById('cal-foto-' + tipo);
    if (!lbl) return;
    const tem = !!_fotos[tipo];
    lbl.classList.toggle('cal-foto-ok-on', tem);
    lbl.querySelector('.cal-foto-ok').hidden = !tem;
  }

  // ── Salvar ──────────────────────────────────────────────────────
  // Ordem deliberada: NUMEROS primeiro (leves, e o que nao pode se
  // perder), depois cada foto numa chamada propria. Foto que falhar
  // deixa a coleta PENDENTE_FOTO — o lancamento existe e ele completa
  // pela lista depois.
  async function salvar() {
    if (_salvando) return;
    _salvando = true; recalcular();
    const aviso = document.getElementById('cal-aviso');
    aviso.hidden = true;
    try {
      const itens = [];
      document.querySelectorAll('#cal-equips .cal-eq').forEach(div => {
        const e = _equips[Number(div.dataset.i)];
        itens.push({
          equipamento_id: e.id,
          inicial: numDe(div.querySelector('.cal-in-ini').value),
          final:   numDe(div.querySelector('.cal-in-fim').value),
        });
      });
      const r = await apiFetch('/calibrador/coleta', {
        method: 'POST',
        body: JSON.stringify({
          posto: _postoAtual.nome,
          data: document.getElementById('cal-data').value,
          itens,
          valor_recolhido: numDe(document.getElementById('cal-recolhido').value),
          observacao: document.getElementById('cal-obs').value.trim() || null,
          gerente_nome: document.getElementById('cal-gerente').value.trim() || null,
        }),
      });

      const falhas = [];
      for (const tipo of ['encerrante', 'protocolo']) {
        try {
          await apiFetch('/calibrador/coleta/' + r.id + '/foto', {
            method: 'POST',
            body: JSON.stringify({ tipo, fotoBase64: _fotos[tipo] }),
          });
        } catch (e) { falhas.push(tipo); }
      }

      if (falhas.length) {
        mostrarAviso('Coleta salva (' + brl(r.valor_esperado) + ' esperado), mas ' +
          (falhas.length === 2 ? 'as duas fotos não subiram' : 'a foto do ' + falhas[0] + ' não subiu') +
          '. Fica como PENDENTE DE FOTO — anexe pela lista quando pegar sinal.', true);
      } else {
        mostrarAviso('Coleta salva. Esperado ' + brl(r.valor_esperado) + '.', false);
        limpar();
      }
    } catch (err) {
      mostrarAviso('Não foi possível salvar: ' + (err.message || err), true);
    } finally {
      _salvando = false;
      recalcular();
    }
  }

  function mostrarAviso(txt, erro) {
    const a = document.getElementById('cal-aviso');
    a.hidden = false;
    a.className = 'cal-aviso ' + (erro ? 'cal-aviso-erro' : 'cal-aviso-ok');
    a.textContent = txt;
  }

  function limpar() {
    _fotos = { encerrante: null, protocolo: null };
    ['encerrante', 'protocolo'].forEach(marcarFoto);
    document.getElementById('cal-recolhido').value = '';
    document.getElementById('cal-obs').value = '';
    document.getElementById('cal-gerente').value = '';
    // Recarrega os equipamentos: o ultimo_final mudou, e o proximo
    // lancamento tem de partir do que acabou de ser gravado.
    trocarPosto();
  }

  // ── Entrada ─────────────────────────────────────────────────────
  window.renderCalibrador = function (sec) {
    if (!sec) return;
    if (!_pronto || !sec.querySelector('#cal-posto')) { montar(sec); carregarPostos(); }
  };
})();
