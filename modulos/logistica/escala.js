// ================================================================
// JBRETAS SISTEMA — modulos/logistica/escala.js
// Aba ESCALA (desktop). Padrão do custo-margem.js: IIFE + window.renderEscala
// (container). Um card por MOTORISTA (opção B), viagens empilhadas. Modal
// simples pra criar/editar viagem. CSS em logistica.css (prefixo esc-, tokens
// longos). Depende de: api.js (apiFetch) carregado antes.
// ================================================================
(function () {
  let _sec     = null;    // container recebido em renderEscala
  let _dataISO = null;    // dia selecionado
  let _opcoes  = null;    // {motoristas, caminhoes, postos, distribuidoras} — cache
  let _dados   = null;    // última resposta GET /escalas
  let _editId  = null;    // id da viagem em edição (null = nova)
  let _modal   = null;    // overlay do form (em document.body)
  let _shellPronto = false;

  // ── Helpers ──────────────────────────────────────────────────────
  function hojeISO() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
  function fmtNum(v) { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function hhmm(t) { if (!t) return ''; const m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : String(t); }

  // ── Shell (montado UMA vez dentro do container) ──────────────────
  function montarShell(sec) {
    _dataISO = _dataISO || hojeISO();
    sec.innerHTML =
      '<div class="esc-wrap">' +
        '<div class="esc-head">' +
          '<div class="esc-title">🗓️ Escala do dia</div>' +
          '<div class="esc-head-right">' +
            '<input type="date" class="esc-data" value="' + esc(_dataISO) + '">' +
            '<button class="esc-btn esc-nova">+ Nova viagem</button>' +
          '</div>' +
        '</div>' +
        '<div class="esc-body"></div>' +
      '</div>';
    sec.querySelector('.esc-data').addEventListener('change', function (e) {
      _dataISO = e.target.value || hojeISO(); carregar();
    });
    sec.querySelector('.esc-nova').addEventListener('click', function () { abrirForm(null); });
    _shellPronto = true;
  }

  // ── Dados ────────────────────────────────────────────────────────
  async function carregarOpcoes() {
    if (_opcoes) return _opcoes;   // só na primeira vez
    try {
      const r = await apiFetch('/escalas/opcoes');
      _opcoes = {
        motoristas:     r.motoristas     || [],
        caminhoes:      r.caminhoes      || [],
        postos:         r.postos         || [],
        distribuidoras: r.distribuidoras || [],
      };
    } catch (e) {
      _opcoes = { motoristas: [], caminhoes: [], postos: [], distribuidoras: [] };
    }
    return _opcoes;
  }

  async function carregar() {
    const body = _sec && _sec.querySelector('.esc-body');
    if (!body) return;
    body.innerHTML = '<div class="esc-msg">Carregando…</div>';
    try {
      const r = await apiFetch('/escalas?data=' + encodeURIComponent(_dataISO));
      _dados = r;
      renderCards();
    } catch (err) {
      body.innerHTML = '<div class="esc-erro">Erro ao carregar: ' + esc(err.message) + '</div>';
    }
  }

  // ── Cards (um por motorista) ─────────────────────────────────────
  function renderCards() {
    const body = _sec.querySelector('.esc-body');
    const motoristas = (_dados && _dados.motoristas) || [];
    if (!motoristas.length) {
      body.innerHTML = '<div class="esc-vazio">Nenhuma viagem escalada para este dia</div>';
      return;
    }
    body.innerHTML = motoristas.map(cardMotorista).join('');
  }

  // Turno "HH:MM–HH:MM"; sem turno_fim → "—" (conforme pedido).
  function fmtTurno(ini, fim) {
    if (!fim) return '—';
    return (hhmm(ini) || '—') + '–' + hhmm(fim);
  }

  function cardMotorista(m) {
    return '<div class="esc-card">' +
      '<div class="esc-card-hd">' +
        '<span class="esc-mot">' + esc(m.motorista_nome || '—') + '</span>' +
        '<span class="esc-placa">' + esc(m.placa || '—') + '</span>' +
        '<span class="esc-turno">' + esc(fmtTurno(m.turno_inicio, m.turno_fim)) + '</span>' +
      '</div>' +
      '<div class="esc-viagens">' + (m.viagens || []).map(viagemLinha).join('') + '</div>' +
    '</div>';
  }

  function viagemLinha(v) {
    const itens = (v.itens || [])
      .map(function (it) { return fmtNum(it.litros) + ' ' + esc(it.combustivel); })
      .join(' · ');
    return '<div class="esc-viagem">' +
      '<span class="esc-vg-n">viagem ' + esc(v.viagem_ordem) + '</span>' +
      '<span class="esc-chip">' + esc(v.distribuidora || '—') + '</span>' +
      '<span class="esc-posto">' + esc(v.posto_nome || '—') + '</span>' +
      '<span class="esc-itens">' + (itens || '—') + '</span>' +
      '<span class="esc-acoes">' +
        '<button class="esc-ico" title="Editar" onclick="window.__escEditar(\'' + esc(v.id) + '\')">✏️</button>' +
        '<button class="esc-ico" title="Excluir" onclick="window.__escExcluir(\'' + esc(v.id) + '\')">🗑️</button>' +
      '</span>' +
    '</div>';
  }

  // Localiza a viagem (e o motorista pai) no snapshot atual, p/ pré-preencher o form.
  function acharViagem(id) {
    for (const m of ((_dados && _dados.motoristas) || [])) {
      for (const v of (m.viagens || [])) {
        if (String(v.id) === String(id)) return { m: m, v: v };
      }
    }
    return null;
  }

  // ── Modal (form de nova/edição) ──────────────────────────────────
  function optSelect(arr, valKey, txtFn, selected) {
    return '<option value="">—</option>' + arr.map(function (o) {
      const val = o[valKey];
      const sel = String(val) === String(selected) ? ' selected' : '';
      return '<option value="' + esc(val) + '"' + sel + '>' + esc(txtFn(o)) + '</option>';
    }).join('');
  }
  function optStrings(arr, selected) {
    return '<option value="">—</option>' + arr.map(function (d) {
      const sel = String(d) === String(selected) ? ' selected' : '';
      return '<option value="' + esc(d) + '"' + sel + '>' + esc(d) + '</option>';
    }).join('');
  }
  function itemRow(it) {
    return '<div class="esc-item">' +
      '<input class="esc-it-comb" placeholder="combustível (ex.: GC)" value="' + esc(it.combustivel || '') + '">' +
      '<input class="esc-it-litros" type="number" inputmode="numeric" placeholder="litros" value="' + esc(it.litros == null ? '' : it.litros) + '">' +
      '<button class="esc-ico esc-it-rem" title="Remover" onclick="window.__escRemItem(this)">✕</button>' +
    '</div>';
  }
  function field(label, control) {
    return '<label class="esc-field"><span>' + esc(label) + '</span>' + control + '</label>';
  }

  async function abrirForm(viagemId) {
    await carregarOpcoes();
    _editId = viagemId || null;
    let pre = {
      motorista_id: '', caminhao_id: '', placa: '', turno_inicio: '', turno_fim: '',
      distribuidora: '', posto_id: '', hora_carregamento: '', itens: [{ combustivel: '', litros: '' }],
    };
    if (viagemId) {
      const f = acharViagem(viagemId);
      if (f) {
        // Tudo vem da PRÓPRIA viagem (o GET /escalas devolve caminhao_id/placa/
        // turno por viagem) — motorista_id do card. Sem match de placa.
        pre = {
          motorista_id:      f.m.motorista_id || '',
          caminhao_id:       f.v.caminhao_id || '',
          placa:             f.v.placa || '',
          turno_inicio:      hhmm(f.v.turno_inicio),
          turno_fim:         hhmm(f.v.turno_fim),
          distribuidora:     f.v.distribuidora || '',
          posto_id:          f.v.posto_id || '',
          hora_carregamento: hhmm(f.v.hora_carregamento),
          itens: (f.v.itens && f.v.itens.length)
            ? f.v.itens.map(function (it) { return { combustivel: it.combustivel, litros: it.litros }; })
            : [{ combustivel: '', litros: '' }],
        };
      }
    }
    construirModal(pre);
  }

  function construirModal(pre) {
    fecharModal();
    const ov = document.createElement('div');
    ov.className = 'esc-modal';
    ov.addEventListener('click', function (e) { if (e.target === ov) fecharModal(); });
    ov.innerHTML =
      '<div class="esc-form">' +
        '<div class="esc-form-hd">' + (_editId ? 'Editar viagem' : 'Nova viagem') +
          '<button class="esc-ico" onclick="window.__escFechar()">✕</button></div>' +
        '<div class="esc-form-grid">' +
          field('Motorista', '<select class="esc-f-mot">' + optSelect(_opcoes.motoristas, 'id', function (o) { return o.nome; }, pre.motorista_id) + '</select>') +
          field('Caminhão', '<select class="esc-f-cam" onchange="window.__escCaminhao(this)">' + optSelect(_opcoes.caminhoes, 'id', function (o) { return o.placa; }, pre.caminhao_id) + '</select>') +
          field('Placa', '<input class="esc-f-placa" value="' + esc(pre.placa) + '" readonly>') +
          field('Turno início', '<input class="esc-f-ti" type="time" value="' + esc(pre.turno_inicio) + '">') +
          field('Turno fim', '<input class="esc-f-tf" type="time" value="' + esc(pre.turno_fim) + '">') +
          field('Distribuidora', '<select class="esc-f-dist">' + optStrings(_opcoes.distribuidoras, pre.distribuidora) + '</select>') +
          field('Posto', '<select class="esc-f-posto">' + optSelect(_opcoes.postos, 'id', function (o) { return o.nome; }, pre.posto_id) + '</select>') +
          field('Hora carregamento', '<input class="esc-f-hora" type="time" value="' + esc(pre.hora_carregamento) + '">') +
        '</div>' +
        '<div class="esc-itens-lbl">Itens</div>' +
        '<div class="esc-itens-edit">' + pre.itens.map(itemRow).join('') + '</div>' +
        '<button class="esc-btn ghost esc-add" onclick="window.__escAddItem()">+ Adicionar item</button>' +
        '<div class="esc-form-erro" style="display:none"></div>' +
        '<div class="esc-form-acoes">' +
          '<button class="esc-btn ghost" onclick="window.__escFechar()">Cancelar</button>' +
          '<button class="esc-btn" onclick="window.__escSalvar()">Salvar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    _modal = ov;
  }

  function fecharModal() {
    if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
    _modal = null;
  }

  function validar(b) {
    if (!b.motorista_id)  return 'Selecione o motorista.';
    if (!b.posto_id)      return 'Selecione o posto.';
    if (!b.distribuidora) return 'Selecione a distribuidora.';
    if (!b.itens.length)  return 'Adicione ao menos um item.';
    for (const it of b.itens) {
      if (!it.combustivel)          return 'Combustível não pode ficar vazio.';
      if (!(Number(it.litros) > 0)) return 'Litros deve ser maior que zero.';
    }
    return null;
  }

  // ── Handlers globais (usados nos onclick inline) ─────────────────
  window.__escEditar = function (id) { abrirForm(id); };
  window.__escFechar = function () { fecharModal(); };

  // Ao trocar o caminhão, preenche a placa automaticamente.
  window.__escCaminhao = function (sel) {
    const cam = (_opcoes.caminhoes || []).find(function (c) { return String(c.id) === String(sel.value); });
    const placa = _modal && _modal.querySelector('.esc-f-placa');
    if (placa) placa.value = cam ? cam.placa : '';
  };

  window.__escAddItem = function () {
    const box = _modal && _modal.querySelector('.esc-itens-edit');
    if (box) box.insertAdjacentHTML('beforeend', itemRow({ combustivel: '', litros: '' }));
  };
  window.__escRemItem = function (btn) {
    const row = btn.closest('.esc-item');
    if (row && row.parentNode) row.parentNode.removeChild(row);
  };

  window.__escExcluir = async function (id) {
    if (!confirm('Excluir esta viagem?')) return;
    try {
      await apiFetch('/escalas/' + encodeURIComponent(id), { method: 'DELETE' });
      carregar();
    } catch (err) {
      alert('Erro ao excluir: ' + (err && err.message || err));
    }
  };

  window.__escSalvar = async function () {
    if (!_modal) return;
    const q = function (s) { return _modal.querySelector(s); };
    const errBox = q('.esc-form-erro');
    // Coleta os itens (ignora linhas totalmente vazias).
    const itens = [];
    _modal.querySelectorAll('.esc-item').forEach(function (row) {
      const comb = row.querySelector('.esc-it-comb').value.trim();
      const litrosRaw = row.querySelector('.esc-it-litros').value;
      if (comb || litrosRaw) itens.push({ combustivel: comb, litros: Number(litrosRaw) });
    });
    const body = {
      data:              _dataISO,
      motorista_id:      q('.esc-f-mot').value || null,
      caminhao_id:       q('.esc-f-cam').value || null,
      placa:             q('.esc-f-placa').value || null,
      turno_inicio:      q('.esc-f-ti').value || null,
      turno_fim:         q('.esc-f-tf').value || null,
      distribuidora:     q('.esc-f-dist').value || null,
      posto_id:          q('.esc-f-posto').value || null,
      hora_carregamento: q('.esc-f-hora').value || null,
      itens:             itens,
      // viagem_ordem NÃO vai — o backend calcula.
    };
    const erro = validar(body);
    if (erro) { errBox.textContent = erro; errBox.style.display = 'block'; return; }
    errBox.style.display = 'none';
    try {
      if (_editId) {
        await apiFetch('/escalas/' + encodeURIComponent(_editId), { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/escalas', { method: 'POST', body: JSON.stringify(body) });
      }
      fecharModal();
      carregar();   // recarrega o dia
    } catch (err) {
      errBox.textContent = 'Erro ao salvar: ' + (err && err.message || err);
      errBox.style.display = 'block';
    }
  };

  // ── Entrada pública (chamada pelo switchMainTab) ─────────────────
  window.renderEscala = function (sec) {
    if (!sec) return;
    _sec = sec;
    if (!_shellPronto || !sec.querySelector('.esc-wrap')) montarShell(sec);
    carregarOpcoes();   // 1ª vez busca; depois cacheado
    carregar();
  };
})();
