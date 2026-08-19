/**
 * Trinus Audit v2 — app.js
 * Frontend principal. Comunicação com servidor Node.js local.
 */

'use strict';

// ─── ESTADO ──────────────────────────────────────────────────────────────────
let ticketsData  = [];
let filteredData = [];
let agentsMap    = {};
let sortCol      = 'id';
let sortAsc      = false;
let currentPage  = 1;
const PAGE_SIZE  = 250;

// ─── DOM ─────────────────────────────────────────────────────────────────────
const tbody             = document.getElementById('audit-tbody');
const loadingIndicator  = document.getElementById('loading-indicator');
const recordCount       = document.getElementById('record-count');
const syncTime          = document.getElementById('sync-time');
const globalSearch      = document.getElementById('global-search');
const filterStatus      = document.getElementById('filter-status');
const filterForma       = document.getElementById('filter-forma-pagamento');
const filterTicketId    = document.getElementById('filter-ticket-id');
const filterPrioridade  = document.getElementById('filter-prioridade');
const filterDocumento   = document.getElementById('filter-documento');
const filterEmpresa     = document.getElementById('filter-empreendimento');
const filterDateStart   = document.getElementById('filter-date-start');
const filterDateEnd     = document.getElementById('filter-date-end');
const btnClearFilters   = document.getElementById('btn-clear-filters');
const modal             = document.getElementById('details-modal');
const modalDetails      = document.getElementById('modal-details');
const modalTitle        = document.getElementById('modal-title');
const btnCloseModal     = document.getElementById('btn-close-modal');
const modalTicketLink   = document.getElementById('modal-ticket-link');
const conversationsList = document.getElementById('conversations-list');
const convCount         = document.getElementById('conv-count');

// ─── INICIALIZAÇÃO (chamada pelo login.js após unlock) ────────────────────────
function initApp() {
    setupEventListeners();
    checkServerStatus();
    setInterval(checkServerStatus, 5000);

    // Esconder "Gerenciar Usuários" para não-admins
    const role = sessionStorage.getItem('trinus_role');
    const btnUsers = document.getElementById('btn-manage-users');
    if (btnUsers) {
        if (role !== 'admin') {
            btnUsers.style.display = 'none';
        } else {
            btnUsers.addEventListener('click', (e) => { e.preventDefault(); openUsersModal(); });
        }
    }
}

// ─── EVENTOS ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
    globalSearch.addEventListener('input', applyFilters);
    if (filterTicketId) filterTicketId.addEventListener('input', applyFilters);
    filterStatus.addEventListener('change', applyFilters);
    filterForma.addEventListener('change', applyFilters);
    filterPrioridade.addEventListener('change', applyFilters);
    filterDocumento.addEventListener('change', applyFilters);
    filterEmpresa.addEventListener('input', applyFilters);
    filterDateStart.addEventListener('change', applyFilters);
    filterDateEnd.addEventListener('change', applyFilters);

    btnClearFilters.addEventListener('click', () => {
        globalSearch.value = filterStatus.value = filterForma.value = '';
        if (filterTicketId) filterTicketId.value = '';
        filterPrioridade.value = filterDocumento.value = filterEmpresa.value = '';
        filterDateStart.value = filterDateEnd.value = '';
        applyFilters();
    });

    document.querySelectorAll('#audit-table th[data-col]').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => handleSort(parseInt(th.dataset.col), th));
    });

    document.getElementById('btn-refresh').addEventListener('click', (e) => { e.preventDefault(); loadData(); });
    document.getElementById('btn-export-csv').addEventListener('click', (e) => { e.preventDefault(); exportToCSV(); });
    document.getElementById('btn-export-excel').addEventListener('click', (e) => { e.preventDefault(); exportToExcel(); });
    const btnExportArchived = document.getElementById('btn-export-archived');
    if (btnExportArchived) btnExportArchived.addEventListener('click', (e) => { e.preventDefault(); exportArchivedToExcel(); });

    btnCloseModal.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    document.getElementById('btn-sync-now').addEventListener('click', (e) => { e.preventDefault(); triggerSync(); });

    document.getElementById('btn-logout').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.clear();
        location.reload();
    });

    // Modal usuários
    const btnCloseUsers = document.getElementById('btn-close-users-modal');
    if (btnCloseUsers) btnCloseUsers.addEventListener('click', closeUsersModal);
    const usersModal = document.getElementById('users-modal');
    if (usersModal) usersModal.addEventListener('click', (e) => { if (e.target === usersModal) closeUsersModal(); });

    const formAddUser = document.getElementById('form-add-user');
    if (formAddUser) formAddUser.addEventListener('submit', handleAddUser);
}

// ─── CARREGAMENTO ─────────────────────────────────────────────────────────────
async function loadData() {
    loadingIndicator.style.display = 'flex';
    try {
        let data;
        try {
            // Tenta puxar do servidor Node (ambiente local com iniciar.bat)
            const resp = await fetch(`${window.API_BASE}/api/tickets`);
            if (!resp.ok) throw new Error(`Servidor retornou ${resp.status}`);
            data = await resp.json();
        } catch (serverErr) {
            console.warn('Servidor Node.js não encontrado. Tentando carregar fallback estático (GitHub Pages)...');
            // Fallback: Lê direto o arquivo JSON estático (funciona no GitHub Pages)
            const fallbackResp = await fetch('data/tickets.json');
            if (!fallbackResp.ok) throw new Error('Não foi possível carregar o arquivo estático data/tickets.json');
            data = await fallbackResp.json();
        }

        ticketsData = data.tickets || [];
        agentsMap   = data.metadata?.agents || {};

        if (data.metadata?.lastSync) {
            syncTime.textContent = new Date(data.metadata.lastSync).toLocaleString('pt-BR');
        }

        applyFilters();
    } catch (err) {
        console.error('Erro ao carregar:', err);
        tbody.innerHTML = `
            <tr><td colspan="20" style="text-align:center;padding:3rem;color:var(--status-pending-text);">
                <i class="ph ph-warning-circle" style="font-size:2rem;display:block;margin-bottom:1rem;"></i>
                <strong>${escapeHtml(err.message)}</strong><br><br>
                <span style="font-size:0.82rem;color:var(--text-muted);">
                    Não foi possível conectar ao servidor Node.js e nem encontrar o arquivo local.<br>
                    Se estiver rodando localmente, execute o <code>iniciar.bat</code>.
                </span>
            </td></tr>`;
        recordCount.textContent = '0 registros';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// ─── RENDERIZAÇÃO ─────────────────────────────────────────────────────────────
function renderTable(data) {
    tbody.innerHTML = '';
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;padding:3rem;color:var(--text-muted);">
            <i class="ph ph-funnel-x" style="font-size:2rem;display:block;margin-bottom:.5rem;color:var(--trinus-blue);opacity:0.5;"></i>
            Nenhum registro encontrado com os filtros aplicados.
        </td></tr>`;
        recordCount.textContent = '0 registros encontrados';
        renderPagination(0);
        return;
    }

    // Recortar apenas os 100 da página atual
    const totalPages = Math.ceil(data.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    pageData.forEach(ticket => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space:normal;vertical-align:top;min-width:100px;">
                <span class="tk-num" id="num-${ticket.id}" onclick="toggleTicketDesc(${ticket.id})">#${ticket.id}</span>
                <div class="tk-desc" id="desc-${ticket.id}">
                    ${escapeHtml(ticket.subject)}
                    <br><a class="tk-link" href="https://trinus.freshservice.com/a/tickets/${ticket.id}" target="_blank" rel="noopener noreferrer">Abrir no Freshservice ↗</a>
                </div>
            </td>
            <td>${formatDate(ticket.created_at)}</td>
            <td><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></td>
            <td>${renderPriority(ticket.priority)}</td>
            <td>${getSourceName(ticket.source)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_email)}">${escapeHtml(ticket.requester_email)}</div></td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_name)}">${escapeHtml(ticket.requester_name)}</div></td>
            <td style="white-space:normal;word-break:break-word;min-width:150px;">${escapeHtml(ticket.empreendimento)}</td>
            <td style="font-weight:600;">${formatCurrency(ticket.valor)}</td>
            <td>${ticket.tempo_gasto || '0h'}</td>
            <td>${renderDocBadge(ticket.tem_documento)}</td>
            <td>${formatAttachments(ticket.attachments, true)}</td>
            <td>${escapeHtml(ticket.banco)}</td>
            <td>${escapeHtml(ticket.agencia)}</td>
            <td>${escapeHtml(ticket.conta)}</td>
            <td>${escapeHtml(ticket.forma_pagamento)}</td>
            <td>${renderTipoPagamento(ticket.tipo_pagamento)}</td>
            <td>${escapeHtml(ticket.contrato_medicao)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.agente)}">${escapeHtml(ticket.agente)}</div></td>
            <td class="actions-col">
                <button class="btn-icon" onclick="openModal(${ticket.id})" title="Ver Detalhes e Conversas">
                    <i class="ph ph-eye"></i>
                </button>
            </td>`;
        tbody.appendChild(tr);
    });

    const total = data.length;
    const from = (currentPage - 1) * PAGE_SIZE + 1;
    const to   = Math.min(currentPage * PAGE_SIZE, total);
    recordCount.textContent = `Exibindo ${from}–${to} de ${total} registro${total !== 1 ? 's' : ''}`;
    renderPagination(total);
}

// ─── PAGINAÇÃO ───────────────────────────────────────────────────────────────
function renderPagination(total) {
    const container = document.getElementById('pagination-container');
    if (!container) return;

    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<div class="pagination">`;

    // Botão Anterior
    html += `<button class="pg-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
        <i class="ph ph-caret-left"></i>
    </button>`;

    // Páginas numeradas (mostra até 7 botões com reticências)
    const delta = 2;
    const range = [];
    for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) range.push(i);
    if (currentPage - delta > 2) range.unshift('...');
    if (currentPage + delta < totalPages - 1) range.push('...');
    range.unshift(1);
    if (totalPages > 1) range.push(totalPages);

    range.forEach(p => {
        if (p === '...') {
            html += `<span class="pg-ellipsis">…</span>`;
        } else {
            html += `<button class="pg-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
        }
    });

    // Botão Próximo
    html += `<button class="pg-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
        <i class="ph ph-caret-right"></i>
    </button>`;

    html += `<span class="pg-info">Página ${currentPage} de ${totalPages}</span></div>`;
    container.innerHTML = html;
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTable(filteredData);
    // Scroll suave para o topo da tabela
    document.querySelector('.table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── TOGGLE DESCRIÇÃO ─────────────────────────────────────────────────────────
function toggleTicketDesc(id) {
    const desc = document.getElementById('desc-' + id);
    const num  = document.getElementById('num-' + id);
    if (!desc || !num) return;
    const open = desc.style.display === 'block';
    desc.style.display = open ? 'none' : 'block';
    num.classList.toggle('open', !open);
}

// ─── FILTROS ─────────────────────────────────────────────────────────────────
function normalize(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function applyFilters() {
    const term      = normalize(globalSearch.value);
    const idVal     = filterTicketId ? filterTicketId.value.trim() : '';
    const statusVal = filterStatus.value;
    const formaVal  = filterForma.value.toLowerCase();
    const priorVal  = filterPrioridade.value;
    const docVal    = filterDocumento.value;
    const empVal    = normalize(filterEmpresa.value);
    const dateStart = filterDateStart.value ? new Date(filterDateStart.value) : null;
    let   dateEnd   = filterDateEnd.value   ? new Date(filterDateEnd.value)   : null;
    if (dateEnd) dateEnd.setHours(23, 59, 59, 999);

    filteredData = ticketsData.filter(t => {
        if (idVal && String(t.id) !== idVal) return false;
        if (statusVal && String(t.status) !== statusVal) return false;
        if (formaVal && (!t.forma_pagamento || !t.forma_pagamento.toLowerCase().includes(formaVal))) return false;
        if (priorVal && String(t.priority) !== priorVal) return false;
        if (docVal && t.tem_documento !== docVal) return false;
        if (empVal && !normalize(t.empreendimento).includes(empVal)) return false;

        if (dateStart || dateEnd) {
            const d = new Date(t.created_at);
            if (dateStart && d < dateStart) return false;
            if (dateEnd   && d > dateEnd)   return false;
        }

        if (term) {
            const hay = normalize([t.id, t.subject, t.requester_name, t.requester_email,
                t.empreendimento, t.banco, t.agencia, t.conta, t.agente,
                t.contrato_medicao, t.tipo_pagamento].join(' '));
            if (!hay.includes(term)) return false;
        }

        return true;
    });

    currentPage = 1; // resetar para primeira página ao filtrar
    sortData();
    renderTable(filteredData);
}

// ─── ORDENAÇÃO ────────────────────────────────────────────────────────────────
const colKeys = ['id','created_at','status','priority','source','requester_email',
    'requester_name','empreendimento','valor','tempo_gasto','tem_documento',
    'attachments','banco','agencia','conta','tipo_pagamento','contrato_medicao','agente'];

function handleSort(colIndex, thEl) {
    if (colIndex >= colKeys.length) return;
    const key = colKeys[colIndex];
    if (sortCol === key) sortAsc = !sortAsc;
    else { sortCol = key; sortAsc = true; }

    document.querySelectorAll('th .sort-icon').forEach(ic => { ic.className = 'ph ph-caret-up sort-icon'; ic.style.opacity = '0.3'; });
    const icon = thEl?.querySelector('.sort-icon');
    if (icon) { icon.className = sortAsc ? 'ph ph-caret-up sort-icon' : 'ph ph-caret-down sort-icon'; icon.style.opacity = '1'; icon.style.color = 'var(--trinus-horizon)'; }

    currentPage = 1; // resetar para primeira página ao ordenar
    sortData();
    renderTable(filteredData);
}

function sortData() {
    filteredData.sort((a, b) => {
        let vA = a[sortCol] ?? '', vB = b[sortCol] ?? '';
        if (['id','valor','priority','status'].includes(sortCol)) return sortAsc ? Number(vA) - Number(vB) : Number(vB) - Number(vA);
        const sA = String(vA).toLowerCase(), sB = String(vB).toLowerCase();
        if (sA < sB) return sortAsc ? -1 : 1;
        if (sA > sB) return sortAsc ? 1 : -1;
        return 0;
    });
}

// ─── FORMATAÇÃO ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
    if (s == null) return '-';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatDate(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return d; }
}

function formatCurrency(v) {
    if (v == null || v === '') return '-';
    const n = parseFloat(v);
    if (isNaN(n)) return String(v);
    return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(n);
}

function getStatusName(s) { return {2:'Aberto',3:'Pendente',4:'Resolvido',5:'Fechado'}[s] || `Status ${s}`; }
function getSourceName(s)  { return {1:'Email',2:'Portal',3:'Telefone',4:'Chat',7:'Outbound Email'}[s] || 'Outro'; }
function getInitials(n)    { if (!n) return '?'; return n.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase(); }

function renderPriority(p) {
    const n = {1:'Baixa',2:'Média',3:'Alta',4:'Urgente'};
    return `<span class="priority-badge priority-${p}">${n[p] || p}</span>`;
}

function renderDocBadge(v) {
    if (v === 'Sim') return `<span style="color:var(--type-pix);font-weight:700;font-size:0.75rem;"><i class="ph ph-check-circle"></i> Sim</span>`;
    return `<span style="color:var(--status-pending-text);font-weight:700;font-size:0.75rem;"><i class="ph ph-x-circle"></i> Não</span>`;
}

function renderTipoPagamento(tipo) {
    if (!tipo || tipo === '-') return '-';
    const t = String(tipo).toUpperCase();
    let cls = 'dot';
    if (t.includes('PIX')) cls += ' dot-pix';
    else if (t.includes('TED')) cls += ' dot-ted';
    else if (t.includes('BOLETO')) cls += ' dot-boleto';
    return `<div class="type-indicator"><div class="${cls}"></div>${escapeHtml(t)}</div>`;
}

function formatAttachments(att, isTable = false) {
    if (!att || !att.length) return '-';
    if (isTable) return `<div class="truncate" title="${att.map(a=>a.name).join(', ')}"><i class="ph ph-paperclip" style="color:var(--trinus-blue);"></i> ${att.length} arquivo(s)</div>`;
    return att.map(a => `
        <div class="attachment-item">
            <span><i class="ph ph-file" style="color:var(--trinus-blue);"></i> ${escapeHtml(a.name)}</span>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                <i class="ph ph-download-simple"></i> Baixar
            </a>
        </div>`).join('');
}

// ─── MODAL DE DETALHES ────────────────────────────────────────────────────────
function openModal(id) {
    const ticket = ticketsData.find(t => t.id === id);
    if (!ticket) return;

    modalTitle.textContent = `Ticket #${ticket.id}`;
    modalTicketLink.href = `https://trinus.freshservice.com/a/tickets/${ticket.id}`;

    modalDetails.innerHTML = `
        <div class="detail-group"><span class="detail-label">Assunto</span><span class="detail-value" style="font-weight:700;">${escapeHtml(ticket.subject)}</span></div>
        <div class="detail-group"><span class="detail-label">Status</span><span class="detail-value"><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></span></div>
        <div class="detail-group"><span class="detail-label">Prioridade</span><span class="detail-value">${renderPriority(ticket.priority)}</span></div>
        <div class="detail-group"><span class="detail-label">Criado em</span><span class="detail-value">${formatDate(ticket.created_at)}</span></div>
        <div class="detail-group"><span class="detail-label">Última atualização</span><span class="detail-value">${formatDate(ticket.updated_at)}</span></div>
        <div class="detail-group"><span class="detail-label">Solicitante</span><span class="detail-value">${escapeHtml(ticket.requester_name)}</span></div>
        <div class="detail-group"><span class="detail-label">E-mail</span><span class="detail-value">${escapeHtml(ticket.requester_email)}</span></div>
        <div class="detail-group"><span class="detail-label">Agente Responsável</span><span class="detail-value">${escapeHtml(ticket.agente)}</span></div>
        <div class="detail-group"><span class="detail-label">Empresa / Empreendimento</span><span class="detail-value">${escapeHtml(ticket.empreendimento)}</span></div>
        <div class="detail-group"><span class="detail-label">Valor</span><span class="detail-value" style="font-size:1.1rem;font-weight:800;color:var(--trinus-horizon);">${formatCurrency(ticket.valor)}</span></div>
        <div class="detail-group"><span class="detail-label">Tipo de Pagamento</span><span class="detail-value">${renderTipoPagamento(ticket.tipo_pagamento)}</span></div>
        <div class="detail-group"><span class="detail-label">Banco / Agência / Conta</span><span class="detail-value">${escapeHtml(ticket.banco)} / ${escapeHtml(ticket.agencia)} / ${escapeHtml(ticket.conta)}</span></div>
        <div class="detail-group"><span class="detail-label">Contrato / Medição</span><span class="detail-value">${escapeHtml(ticket.contrato_medicao)}</span></div>
        <div class="detail-group"><span class="detail-label">Possui Documento</span><span class="detail-value">${renderDocBadge(ticket.tem_documento)}</span></div>
        <div class="attachments-section">
            <h3>Anexos (${ticket.attachments?.length || 0})</h3>
            <div class="attachment-list">${formatAttachments(ticket.attachments, false)}</div>
        </div>`;

    convCount.textContent = '—';
    conversationsList.innerHTML = `<div class="conv-loading"><i class="ph ph-spinner-gap ph-spin"></i> Carregando conversas...</div>`;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    loadConversations(ticket);
}

function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// ─── CONVERSAS ───────────────────────────────────────────────────────────────
function loadConversations(ticket) {
    const convs = (ticket.conversations || []).filter(c => !c.private);
    renderConversations(convs);
}

function renderConversations(convs) {
    if (!convs.length) {
        conversationsList.innerHTML = `<div class="conv-empty"><i class="ph ph-chat-slash" style="font-size:2rem;display:block;margin-bottom:.5rem;opacity:0.4;"></i> Nenhuma conversa ou nota pública encontrada.</div>`;
        convCount.textContent = '0';
        return;
    }

    convCount.textContent = String(convs.length);
    conversationsList.innerHTML = convs.map((conv, i) => {
        const isNote     = conv.incoming === false && conv.support_email == null;
        const isIncoming = conv.incoming === true;
        const agentName  = conv.user_id && agentsMap[conv.user_id] ? agentsMap[conv.user_id] : 'Agente';
        const displayName = conv.from_email ? conv.from_email.replace(/<.*>/, '').trim() || conv.from_email : (isIncoming ? 'Solicitante' : agentName);
        const avatarClass = isNote ? 'note' : (isIncoming ? 'customer' : 'agent');
        const typeLabel   = isNote
            ? `<span class="conv-type-tag note"><i class="ph ph-note"></i> Nota Pública</span>`
            : (isIncoming
                ? `<span class="conv-type-tag reply" style="background:rgba(100,116,139,.15);color:#94a3b8;"><i class="ph ph-user"></i> Solicitante</span>`
                : `<span class="conv-type-tag reply"><i class="ph ph-headset"></i> Resposta do Agente</span>`);

        const bodyContent = conv.body || conv.body_text || '(sem conteúdo)';
        const bubbleClass = isNote ? 'conv-body note-body' : 'conv-body';

        let attachmentsHtml = '';
        if (conv.attachments?.length) {
            attachmentsHtml = '<div class="conv-attachments" style="margin-top:10px;border-top:1px solid rgba(0,0,0,.05);padding-top:10px;display:flex;flex-direction:column;gap:8px;">';
            conv.attachments.forEach(att => {
                const url = att.attachment_url || att.url || '#';
                const name = att.name || 'Anexo';
                const ext = name.split('.').pop().toLowerCase();
                const isImg = ['png','jpg','jpeg','gif','webp'].includes(ext);
                attachmentsHtml += isImg
                    ? `<div class="conv-attachment-item"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:250px;border-radius:6px;border:1px solid rgba(0,0,0,.1);"></a></div>`
                    : `<div class="conv-attachment-item"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:5px;font-size:.8rem;font-weight:600;color:var(--trinus-blue);text-decoration:none;"><i class="ph ph-file-arrow-down" style="font-size:1.2rem;"></i> ${escapeHtml(name)}</a></div>`;
            });
            attachmentsHtml += '</div>';
        }

        return `
            <div class="conversation-item" style="animation-delay:${i * 0.05}s;">
                <div class="conv-avatar ${avatarClass}">${getInitials(displayName)}</div>
                <div class="conv-bubble">
                    <div class="conv-meta">
                        <span class="conv-author">${escapeHtml(displayName)}</span>
                        ${typeLabel}
                        <span class="conv-date">${formatDate(conv.created_at)}</span>
                    </div>
                    <div class="${bubbleClass}">${bodyContent}</div>
                    ${attachmentsHtml}
                </div>
            </div>`;
    }).join('');
}

// ─── STATUS & SYNC ────────────────────────────────────────────────────────────
async function checkServerStatus() {
    const dot   = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    try {
        const resp = await fetch(`${window.API_BASE}/api/status`);
        if (!resp.ok) throw new Error();
        const status = await resp.json();

        dot.className = 'status-dot online';
        label.textContent = status.sync_in_progress ? 'Sincronizando...' : 'Servidor Online';

        const progressBar   = document.getElementById('sync-progress-bar');
        const progressFill  = document.getElementById('sync-progress-fill');
        const progressLabel = document.getElementById('sync-progress-label');
        const btnSync       = document.getElementById('btn-sync-now');

        if (status.sync_in_progress) {
            progressBar.style.display = 'block';
            btnSync.disabled = true;
            const p = status.progress;
            const pct = p.total > 0 ? Math.round((p.checked / p.total) * 100) : 5;
            progressFill.style.width = pct + '%';
            progressLabel.textContent = p.phase || 'Processando...';
        } else {
            progressBar.style.display = 'none';
            btnSync.disabled = false;
            if (status.progress?.phase === 'concluido') {
                loadData();
            }
        }

        if (status.last_sync) {
            syncTime.textContent = new Date(status.last_sync).toLocaleString('pt-BR');
        }
    } catch {
        dot.className = 'status-dot offline';
        label.textContent = 'Servidor Offline';
    }
}

async function triggerSync() {
    const btn = document.getElementById('btn-sync-now');
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Iniciando...';
    try {
        const resp = await fetch(`${window.API_BASE}/api/sync`, { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'success') {
            btn.innerHTML = '<i class="ph ph-check"></i> Sincronizando...';
        } else {
            alert(data.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-cloud-arrow-down"></i> Sincronizar Dados';
        }
    } catch {
        alert('Não foi possível conectar ao servidor.');
        btn.disabled = false;
        btn.innerHTML = '<i class="ph ph-cloud-arrow-down"></i> Sincronizar Dados';
    }
}

// ─── GERENCIAR USUÁRIOS ───────────────────────────────────────────────────────
async function openUsersModal() {
    document.getElementById('users-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
    await loadUsersList();
}

function closeUsersModal() {
    document.getElementById('users-modal').classList.remove('active');
    document.body.style.overflow = '';
}

async function loadUsersList() {
    const tbody = document.getElementById('users-list-body');
    try {
        let users = [];
        let isStaticMode = false;
        
        try {
            const resp = await fetch(`${window.API_BASE}/api/users`);
            if (!resp.ok) throw new Error();
            const data = await resp.json();
            users = data.users || [];
        } catch {
            console.warn('Servidor offline. Carregando usuários no modo leitura (GitHub Pages).');
            isStaticMode = true;
            const fb = await fetch('data/users.json');
            const dataObj = await fb.json();
            users = Object.entries(dataObj).map(([k, v]) => ({ username: k, role: v.role }));
        }

        if (!users.length) {
            tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;">Nenhum usuário.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => `
            <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:10px 15px;">
                    <strong style="font-size:.85rem;">${escapeHtml(u.username)}</strong>
                    <span style="margin-left:8px;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700;background:${u.role==='admin'?'rgba(100,255,160,0.12)':'rgba(100,140,255,0.12)'};color:${u.role==='admin'?'#4ade80':'#93c5fd'};">
                        ${u.role === 'admin' ? 'Admin' : 'Comum'}
                    </span>
                </td>
                <td style="padding:10px 15px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
                    ${!isStaticMode ? `
                        <button onclick="changeRole('${u.username}','${u.role === 'admin' ? 'user' : 'admin'}')" class="btn btn-secondary" style="font-size:.75rem;padding:4px 10px;">
                            ${u.role === 'admin' ? '↓ Tornar Comum' : '↑ Tornar Admin'}
                        </button>
                        <button onclick="deleteUser('${u.username}')" class="btn-icon" style="color:rgba(255,100,100,.8);" title="Remover usuário">
                            <i class="ph ph-trash"></i>
                        </button>
                    ` : '<span style="color:var(--text-muted);font-size:0.8rem;">Somente leitura</span>'}
                </td>
            </tr>`).join('');

        if (isStaticMode) {
            const formContainer = document.getElementById('form-add-user');
            if (formContainer) {
                formContainer.innerHTML = '<div style="color:var(--trinus-horizon);padding:1rem;text-align:center;background:rgba(215,75,75,0.1);border-radius:8px;">⚠️ Você está visualizando pelo GitHub Pages.<br>Para adicionar ou remover usuários, você deve abrir o sistema rodando o <strong>iniciar.bat</strong> localmente.</div>';
            }
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="2" style="padding:10px;color:var(--status-pending-text);">Erro ao carregar usuários.</td></tr>`;
    }
}

async function handleAddUser(e) {
    e.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const role     = document.getElementById('new-role').value;
    try {
        const resp = await fetch(`${window.API_BASE}/api/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await resp.json();
        if (data.status === 'success') {
            document.getElementById('new-username').value = '';
            document.getElementById('new-password').value = '';
            await loadUsersList();
        } else {
            alert(data.message);
        }
    } catch { alert('Erro ao criar usuário.'); }
}

async function deleteUser(username) {
    if (!confirm(`Remover o usuário "${username}"?`)) return;
    try {
        const resp = await fetch(`${window.API_BASE}/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        const data = await resp.json();
        if (data.status === 'success') await loadUsersList();
        else alert(data.message);
    } catch { alert('Erro ao remover usuário.'); }
}

async function changeRole(username, newRole) {
    try {
        const resp = await fetch(`${window.API_BASE}/api/users/${encodeURIComponent(username)}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        const data = await resp.json();
        if (data.status === 'success') await loadUsersList();
        else alert(data.message);
    } catch { alert('Erro ao alterar papel.'); }
}

// ─── EXPORTAÇÃO ───────────────────────────────────────────────────────────────
function exportToCSV() {
    if (!filteredData.length) return alert('Nenhum dado para exportar.');
    const headers = ['ID','Criado em','Status','Prioridade','Origem','E-mail','Solicitante','Empresa','Valor','Doc','Banco','Agência','Conta','Tipo Pgto','Contrato','Agente'];
    const rows = filteredData.map(t => [
        t.id, formatDate(t.created_at), getStatusName(t.status), t.priority, getSourceName(t.source),
        t.requester_email, t.requester_name, t.empreendimento, t.valor,
        t.tem_documento, t.banco, t.agencia, t.conta, t.tipo_pagamento, t.contrato_medicao, t.agente
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    download('auditoria_v2.csv', 'text/csv;charset=utf-8;', '\uFEFF' + csv);
}

function exportToExcel() {
    if (!filteredData.length) return alert('Nenhum dado para exportar.');
    const ws = XLSX.utils.json_to_sheet(filteredData.map(t => ({
        ID: t.id, 'Criado em': formatDate(t.created_at), Status: getStatusName(t.status),
        Prioridade: t.priority, Origem: getSourceName(t.source), 'E-mail': t.requester_email,
        Solicitante: t.requester_name, Empresa: t.empreendimento, Valor: t.valor,
        Documento: t.tem_documento, Banco: t.banco, Agência: t.agencia, Conta: t.conta,
        'Forma Pgto': t.forma_pagamento, Contrato: t.contrato_medicao, Agente: t.agente,
        'Tempo Gasto': t.tempo_gasto || '0h'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    XLSX.writeFile(wb, 'auditoria_v2.xlsx');
}

function exportArchivedToExcel() {
    // Filtrar apenas Fechados (5) ou Resolvidos (4) entre 01/01/2025 e 01/04/2026
    const start = new Date('2025-01-01T00:00:00');
    const end = new Date('2026-04-01T23:59:59');

    const archivedData = ticketsData.filter(t => {
        if (t.status !== 4 && t.status !== 5) return false;
        const d = new Date(t.created_at);
        if (d < start || d > end) return false;
        return true;
    });

    if (!archivedData.length) return alert('Nenhum ticket arquivado encontrado no período de 01/01/2025 até 01/04/2026.');

    const ws = XLSX.utils.json_to_sheet(archivedData.map(t => ({
        ID: t.id, 'Criado em': formatDate(t.created_at), Status: getStatusName(t.status),
        Prioridade: t.priority, Origem: getSourceName(t.source), 'E-mail': t.requester_email,
        Solicitante: t.requester_name, Empresa: t.empreendimento, Valor: t.valor,
        Documento: t.tem_documento, Banco: t.banco, Agência: t.agencia, Conta: t.conta,
        'Forma Pgto': t.forma_pagamento, Contrato: t.contrato_medicao, Agente: t.agente,
        'Tempo Gasto': t.tempo_gasto || '0h'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Arquivados_2025_2026');
    XLSX.writeFile(wb, 'auditoria_arquivados_2025_2026.xlsx');
}

function download(filename, mime, content) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
}
