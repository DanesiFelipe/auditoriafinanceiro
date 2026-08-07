/**
 * Trinus Audit — app.js
 * Painel de Auditoria Financeira | Backoffice Trinus
 * Workspace: 24 | Service Items: 477, 476
 */

// =========================================
// CONFIGURAÇÃO
// =========================================
const FRESHSERVICE_WORKSPACE_ID = 24;
const SERVICE_ITEM_IDS = [477, 476];

// =========================================
// ESTADO GLOBAL
// =========================================
let ticketsData   = [];
let filteredData  = [];
let agentsMap     = {};
let sortCol       = 'id';
let sortAsc       = false;

// =========================================
// REFERÊNCIAS DOM
// =========================================
const tbody            = document.getElementById('audit-tbody');
const loadingIndicator = document.getElementById('loading-indicator');
const recordCount      = document.getElementById('record-count');
const syncTime         = document.getElementById('sync-time');

// Filtros
const globalSearch    = document.getElementById('global-search');
const filterStatus    = document.getElementById('filter-status');
const filterTipo      = document.getElementById('filter-tipo-pagamento');
const filterPrioridade = document.getElementById('filter-prioridade');
const filterDocumento  = document.getElementById('filter-documento');
const filterEmpresa   = document.getElementById('filter-empreendimento');
const filterDateStart = document.getElementById('filter-date-start');
const filterDateEnd   = document.getElementById('filter-date-end');
const btnClearFilters = document.getElementById('btn-clear-filters');

// Modal de Detalhes
const modal            = document.getElementById('details-modal');
const modalBody        = document.getElementById('modal-body');
const modalDetails     = document.getElementById('modal-details');
const modalTitle       = document.getElementById('modal-title');
const btnCloseModal    = document.getElementById('btn-close-modal');
const modalTicketLink  = document.getElementById('modal-ticket-link');
const conversationsList = document.getElementById('conversations-list');
const convCount        = document.getElementById('conv-count');

// Modal de Configuração
const configModal       = document.getElementById('config-modal');
const btnConfig         = document.getElementById('btn-config');
const btnConfigCancel   = document.getElementById('btn-config-cancel');
const btnConfigSave     = document.getElementById('btn-config-save');
const configDomain      = document.getElementById('config-domain');
const configApikey      = document.getElementById('config-apikey');

// =========================================
// INICIALIZAÇÃO
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
    loadConfigFromStorage();
});

// =========================================
// CONFIGURAÇÃO DE API (localStorage)
// =========================================
function loadConfigFromStorage() {
    const domain = localStorage.getItem('fs_domain');
    const apiKey = localStorage.getItem('fs_apikey');
    if (domain) configDomain.value = domain;
    if (apiKey) configApikey.value = apiKey;
}

function getApiConfig() {
    return {
        domain: localStorage.getItem('fs_domain') || '',
        apiKey: localStorage.getItem('fs_apikey')  || ''
    };
}

function isApiConfigured() {
    const { domain, apiKey } = getApiConfig();
    return domain.length > 0 && apiKey.length > 0;
}

// =========================================
// EVENT LISTENERS
// =========================================
function setupEventListeners() {
    // Filtros
    globalSearch.addEventListener('input', applyFilters);
    filterStatus.addEventListener('change', applyFilters);
    filterTipo.addEventListener('change', applyFilters);
    filterPrioridade.addEventListener('change', applyFilters);
    filterDocumento.addEventListener('change', applyFilters);
    filterEmpresa.addEventListener('input', applyFilters);
    filterDateStart.addEventListener('change', applyFilters);
    filterDateEnd.addEventListener('change', applyFilters);

    btnClearFilters.addEventListener('click', () => {
        globalSearch.value    = '';
        filterStatus.value    = '';
        filterTipo.value      = '';
        filterPrioridade.value = '';
        filterDocumento.value = '';
        filterEmpresa.value   = '';
        filterDateStart.value = '';
        filterDateEnd.value   = '';
        applyFilters();
    });

    // Ordenação
    document.querySelectorAll('th').forEach((th, index) => {
        th.addEventListener('click', () => handleSort(index, th));
    });

    // Sidebar
    document.getElementById('btn-refresh').addEventListener('click', (e) => {
        e.preventDefault();
        loadData();
    });
    document.getElementById('btn-export-csv').addEventListener('click', (e) => {
        e.preventDefault();
        exportToCSV();
    });
    document.getElementById('btn-export-excel').addEventListener('click', (e) => {
        e.preventDefault();
        exportToExcel();
    });

    // Modal de Detalhes
    btnCloseModal.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeConfigModal();
        }
    });

    // Modal de Configuração
    btnConfig.addEventListener('click', openConfigModal);
    btnConfigCancel.addEventListener('click', closeConfigModal);
    configModal.addEventListener('click', (e) => {
        if (e.target === configModal) closeConfigModal();
    });
    btnConfigSave.addEventListener('click', saveConfig);
}

// =========================================
// CARREGAMENTO DE DADOS
// =========================================
async function loadData() {
    loadingIndicator.style.display = 'flex';

    try {
        // Forçar re-fetch sem cache
        const response = await fetch(`data/tickets.json?t=${Date.now()}`);

        if (!response.ok) {
            throw new Error(`Falha ao carregar dados (${response.status}). Verifique se o GitHub Actions rodou e gerou o arquivo data/tickets.json.`);
        }

        const data = await response.json();
        ticketsData = data.tickets || [];
        
        if (data.metadata?.agents) {
            agentsMap = data.metadata.agents;
        }

        if (data.metadata?.lastSync) {
            const d = new Date(data.metadata.lastSync);
            syncTime.textContent = d.toLocaleString('pt-BR');
        } else {
            syncTime.textContent = new Date().toLocaleString('pt-BR');
        }

        applyFilters();
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="19" style="text-align:center; padding:3rem; color: var(--status-pending-text);">
                    <i class="ph ph-warning-circle" style="font-size:2rem; display:block; margin-bottom:1rem;"></i>
                    <strong>${escapeHtml(error.message)}</strong><br><br>
                    <span style="color: var(--text-muted); font-size:0.82rem;">
                        Se você acabou de configurar o projeto, certifique-se de que o GitHub Actions rodou<br>
                        pelo menos uma vez para gerar o arquivo <code>data/tickets.json</code>.
                    </span>
                </td>
            </tr>
        `;
        recordCount.textContent = '0 registros';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// =========================================
// RENDERIZAÇÃO DA TABELA
// =========================================
function renderTable(data) {
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="18" style="text-align:center; padding:3rem; color: var(--text-muted);">
                    <i class="ph ph-funnel-x" style="font-size:2rem; display:block; margin-bottom:.5rem; color: var(--trinus-blue); opacity: 0.5;"></i>
                    Nenhum registro encontrado com os filtros aplicados.
                </td>
            </tr>`;
        recordCount.textContent = '0 registros encontrados';
        return;
    }

    data.forEach(ticket => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="white-space:normal; vertical-align:top; min-width:100px;">
                <span class="tk-num" id="num-${ticket.id}" onclick="toggleTicketDesc(${ticket.id})">#${ticket.id}</span>
                <div class="tk-desc" id="desc-${ticket.id}">
                    ${escapeHtml(ticket.subject)}
                    <br><a class="tk-link" href="https://trinus.freshservice.com/a/tickets/${ticket.id}" target="_blank" rel="noopener noreferrer">Abrir no Freshservice ↗</a>
                </div>
            </td>
            <td><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></td>
            <td>${renderPriority(ticket.priority)}</td>
            <td>${getSourceName(ticket.source)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_email)}">${escapeHtml(ticket.requester_email)}</div></td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_name)}">${escapeHtml(ticket.requester_name)}</div></td>
            <td><div class="truncate" title="${escapeHtml(ticket.empreendimento)}">${escapeHtml(ticket.empreendimento)}</div></td>
            <td style="font-weight:600;">${formatCurrency(ticket.valor)}</td>
            <td>${ticket.tempo_gasto}h</td>
            <td>${renderDocBadge(ticket.tem_documento)}</td>
            <td>${formatAttachments(ticket.attachments, true)}</td>
            <td>${escapeHtml(ticket.banco)}</td>
            <td>${escapeHtml(ticket.agencia)}</td>
            <td>${escapeHtml(ticket.conta)}</td>
            <td>${renderTipoPagamento(ticket.tipo_pagamento)}</td>
            <td>${escapeHtml(ticket.contrato_medicao)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.agente)}">${escapeHtml(ticket.agente)}</div></td>
            <td class="actions-col">
                <button class="btn-icon" onclick="openModal(${ticket.id})" title="Ver Detalhes e Conversas">
                    <i class="ph ph-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    recordCount.textContent = `${data.length} registro${data.length !== 1 ? 's' : ''} encontrado${data.length !== 1 ? 's' : ''}`;
}

// =========================================
// TOGGLE TICKET DESCRIÇÃO (igual ao dash-descontos)
// =========================================
function toggleTicketDesc(id) {
    const desc = document.getElementById('desc-' + id);
    const num  = document.getElementById('num-'  + id);
    if (!desc || !num) return;
    const open = desc.style.display === 'block';
    desc.style.display = open ? 'none' : 'block';
    num.classList.toggle('open', !open);
}

// =========================================
// FILTROS
// =========================================
function normalize(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function applyFilters() {
    const term        = normalize(globalSearch.value);
    const statusVal   = filterStatus.value;
    const tipoVal     = filterTipo.value.toLowerCase();
    const priorVal    = filterPrioridade.value;
    const docVal      = filterDocumento.value;
    const empresaVal  = normalize(filterEmpresa.value);
    const dateStart   = filterDateStart.value ? new Date(filterDateStart.value) : null;
    const dateEnd     = filterDateEnd.value ? new Date(filterDateEnd.value) : null;

    if (dateEnd) dateEnd.setHours(23, 59, 59, 999);

    filteredData = ticketsData.filter(t => {
        if (statusVal && String(t.status) !== statusVal) return false;
        if (tipoVal && (!t.tipo_pagamento || t.tipo_pagamento.toLowerCase() !== tipoVal)) return false;
        if (priorVal && String(t.priority) !== priorVal) return false;
        if (docVal && t.tem_documento !== docVal) return false;

        if (empresaVal) {
            if (!normalize(t.empreendimento).includes(empresaVal)) return false;
        }

        if (dateStart || dateEnd) {
            const tDate = new Date(t.created_at);
            if (dateStart && tDate < dateStart) return false;
            if (dateEnd   && tDate > dateEnd)   return false;
        }

        if (term) {
            const haystack = normalize([
                t.id, t.subject, t.requester_name, t.requester_email,
                t.empreendimento, t.banco, t.agencia, t.conta, t.agente,
                t.contrato_medicao, t.tipo_pagamento
            ].join(' '));
            if (!haystack.includes(term)) return false;
        }

        return true;
    });

    sortData();
    renderTable(filteredData);
}

// =========================================
// ORDENAÇÃO
// =========================================
const colKeys = [
    'id', 'status', 'priority', 'source', 'requester_email',
    'requester_name', 'empreendimento', 'valor', 'tempo_gasto', 'tem_documento',
    'attachments', 'banco', 'agencia', 'conta', 'tipo_pagamento', 'contrato_medicao', 'agente'
];

function handleSort(colIndex, thElement) {
    if (colIndex >= colKeys.length) return;
    const key = colKeys[colIndex];

    if (sortCol === key) {
        sortAsc = !sortAsc;
    } else {
        sortCol = key;
        sortAsc = true;
    }

    document.querySelectorAll('th .sort-icon').forEach(icon => {
        icon.className = 'ph ph-caret-up sort-icon';
        icon.style.opacity = '0.3';
    });

    const currentIcon = thElement.querySelector('.sort-icon');
    if (currentIcon) {
        currentIcon.className = sortAsc ? 'ph ph-caret-up sort-icon' : 'ph ph-caret-down sort-icon';
        currentIcon.style.opacity = '1';
        currentIcon.style.color = 'var(--trinus-horizon)';
    }

    sortData();
    renderTable(filteredData);
}

function sortData() {
    filteredData.sort((a, b) => {
        let valA = a[sortCol] ?? '';
        let valB = b[sortCol] ?? '';

        if (['id', 'valor', 'tempo_gasto', 'priority', 'status'].includes(sortCol)) {
            return sortAsc ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return sortAsc ? -1 : 1;
        if (strA > strB) return sortAsc ? 1 : -1;
        return 0;
    });
}

// =========================================
// UTILITÁRIOS DE FORMATAÇÃO
// =========================================
function getStatusName(status) {
    return { 2: 'Aberto', 3: 'Pendente', 4: 'Resolvido', 5: 'Fechado' }[status] || `Status ${status}`;
}

function getPriorityName(priority) {
    return { 1: 'Baixa', 2: 'Média', 3: 'Alta', 4: 'Urgente' }[priority] || priority;
}

function getSourceName(source) {
    return {
        1: 'Email', 2: 'Portal', 3: 'Telefone', 4: 'Chat',
        5: 'Mobihelp', 6: 'Feedback Widget', 7: 'Outbound Email'
    }[source] || 'Outro';
}

function formatCurrency(value) {
    if (value == null || value === '') return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return String(value);
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

function renderPriority(priority) {
    const names = { 1: 'Baixa', 2: 'Média', 3: 'Alta', 4: 'Urgente' };
    return `<span class="priority-badge priority-${priority}">${names[priority] || priority}</span>`;
}

function renderDocBadge(tem_documento) {
    if (tem_documento === 'Sim') {
        return `<span style="color: var(--type-pix); font-weight:700; font-size:0.75rem;">
                    <i class="ph ph-check-circle"></i> Sim
                </span>`;
    }
    return `<span style="color: var(--status-pending-text); font-weight:700; font-size:0.75rem;">
                <i class="ph ph-x-circle"></i> Não
            </span>`;
}

function renderTipoPagamento(tipo) {
    if (!tipo) return '-';
    const tipoUpper = String(tipo).toUpperCase();
    let dotClass = 'dot';
    if (tipoUpper.includes('PIX'))    dotClass += ' dot-pix';
    else if (tipoUpper.includes('TED'))    dotClass += ' dot-ted';
    else if (tipoUpper.includes('BOLETO')) dotClass += ' dot-boleto';
    return `<div class="type-indicator"><div class="${dotClass}"></div>${escapeHtml(tipoUpper)}</div>`;
}

function formatAttachments(attachments, isTable = false) {
    if (!attachments || attachments.length === 0) return '-';

    if (isTable) {
        return `<div class="truncate" title="${attachments.map(a => a.name).join(', ')}">
                    <i class="ph ph-paperclip" style="color: var(--trinus-blue);"></i>
                    ${attachments.length} arquivo(s)
                </div>`;
    }

    return attachments.map(a => `
        <div class="attachment-item">
            <span><i class="ph ph-file" style="color: var(--trinus-blue);"></i> ${escapeHtml(a.name)}</span>
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                <i class="ph ph-download-simple"></i> Baixar
            </a>
        </div>
    `).join('');
}

function escapeHtml(unsafe) {
    if (unsafe == null) return '-';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        return new Date(dateStr).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// =========================================
// MODAL DE DETALHES
// =========================================
function openModal(id) {
    const ticket = ticketsData.find(t => t.id === id);
    if (!ticket) return;

    modalTitle.textContent = `Ticket #${ticket.id}`;
    modalTicketLink.href = `https://trinus.freshservice.com/a/tickets/${ticket.id}`;

    // Renderiza os campos de detalhe
    modalDetails.innerHTML = `
        <div class="detail-group">
            <span class="detail-label">Assunto</span>
            <span class="detail-value" style="font-weight:700;">${escapeHtml(ticket.subject)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Status</span>
            <span class="detail-value"><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Prioridade</span>
            <span class="detail-value">${renderPriority(ticket.priority)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Criado em</span>
            <span class="detail-value">${formatDate(ticket.created_at)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Solicitante</span>
            <span class="detail-value">${escapeHtml(ticket.requester_name)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">E-mail Solicitante</span>
            <span class="detail-value">${escapeHtml(ticket.requester_email)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Agente Responsável</span>
            <span class="detail-value">${escapeHtml(ticket.agente)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Empresa / Empreendimento</span>
            <span class="detail-value">${escapeHtml(ticket.empreendimento)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Valor</span>
            <span class="detail-value" style="font-size:1.1rem; font-weight:800; color: var(--trinus-horizon);">
                ${formatCurrency(ticket.valor)}
            </span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Tipo de Pagamento</span>
            <span class="detail-value">${renderTipoPagamento(ticket.tipo_pagamento)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Banco / Agência / Conta</span>
            <span class="detail-value">${escapeHtml(ticket.banco)} / ${escapeHtml(ticket.agencia)} / ${escapeHtml(ticket.conta)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Contrato / Medição</span>
            <span class="detail-value">${escapeHtml(ticket.contrato_medicao)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Tempo Gasto</span>
            <span class="detail-value">${ticket.tempo_gasto}h</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Possui Documento</span>
            <span class="detail-value">${renderDocBadge(ticket.tem_documento)}</span>
        </div>

        <div class="attachments-section">
            <h3>Anexos (${ticket.attachments ? ticket.attachments.length : 0})</h3>
            <div class="attachment-list">
                ${formatAttachments(ticket.attachments, false)}
            </div>
        </div>
    `;

    // Resetar seção de conversas
    convCount.textContent = '—';
    conversationsList.innerHTML = `
        <div class="conv-loading">
            <i class="ph ph-spinner-gap ph-spin"></i>
            Carregando conversas...
        </div>
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Buscar conversas
    loadConversations(ticket.id);
}

function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

// =========================================
// CONVERSAS EM TEMPO REAL
// =========================================
async function loadConversations(ticketId) {
    if (!isApiConfigured()) {
        conversationsList.innerHTML = `
            <div class="conv-error">
                <i class="ph ph-warning" style="font-size:1.2rem; flex-shrink:0; margin-top:2px;"></i>
                <div>
                    <strong>API não configurada.</strong><br>
                    <span style="font-size:0.78rem; color: var(--text-muted);">
                        Clique em "Configurar API" na barra lateral para habilitar a visualização de conversas em tempo real.
                    </span>
                </div>
            </div>
        `;
        convCount.textContent = '!';
        return;
    }

    const { domain, apiKey } = getApiConfig();

    try {
        // Usar um proxy CORS via allorigins ou fazer a chamada direta (depende do CORS do Freshservice)
        // Tentativa direta primeiro — Freshservice geralmente bloqueia CORS para API v2
        // Por isso usamos a abordagem de CORS proxy público para leitura

        // Endpoint: GET /api/v2/tickets/{id}/conversations
        // Freshservice não permite CORS direto do browser, então usaremos allorigins como proxy de leitura
        const fsUrl = `https://${domain}/api/v2/tickets/${ticketId}/conversations`;
        const authToken = btoa(`${apiKey}:X`);

        // Tentativa direta (funciona se o domínio Freshservice tiver CORS habilitado)
        const response = await fetch(fsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Chave de API inválida. Verifique nas configurações.');
            }
            throw new Error(`Erro da API: ${response.status}`);
        }

        const data = await response.json();
        const conversations = data.conversations || [];

        // Filtrar apenas notas públicas e respostas (excluir private notes)
        const publicConvs = conversations.filter(c => !c.private);

        renderConversations(publicConvs);

    } catch (error) {
        console.error('Erro ao buscar conversas:', error);

        // Verificar se é erro de CORS
        const isCorsError = error.message === 'Failed to fetch' || error.name === 'TypeError';

        if (isCorsError) {
            conversationsList.innerHTML = `
                <div class="conv-error">
                    <i class="ph ph-globe-x" style="font-size:1.2rem; flex-shrink:0; margin-top:2px;"></i>
                    <div>
                        <strong>Bloqueio de CORS detectado.</strong><br>
                        <span style="font-size:0.78rem; color: var(--text-muted); line-height:1.5;">
                            O Freshservice bloqueia chamadas diretas do browser por política de CORS.<br>
                            Para habilitar conversas em tempo real, é necessário configurar um proxy reverso
                            ou usar a solução via GitHub Actions (pré-fetch).
                        </span>
                    </div>
                </div>
            `;
        } else {
            conversationsList.innerHTML = `
                <div class="conv-error">
                    <i class="ph ph-warning" style="font-size:1.2rem; flex-shrink:0; margin-top:2px;"></i>
                    <div>
                        <strong>Erro ao carregar conversas.</strong><br>
                        <span style="font-size:0.78rem; color: var(--text-muted);">${escapeHtml(error.message)}</span>
                    </div>
                </div>
            `;
        }
        convCount.textContent = '!';
    }
}

function renderConversations(conversations) {
    if (conversations.length === 0) {
        conversationsList.innerHTML = `
            <div class="conv-empty">
                <i class="ph ph-chat-slash" style="font-size:2rem; display:block; margin-bottom:.5rem; opacity:0.4;"></i>
                Nenhuma conversa ou nota pública encontrada neste ticket.
            </div>
        `;
        convCount.textContent = '0';
        return;
    }

    convCount.textContent = String(conversations.length);

    conversationsList.innerHTML = conversations.map((conv, i) => {
        const isNote     = conv.incoming === false && conv.support_email == null;
        const isIncoming = conv.incoming === true;

        let agentNameStr = 'Agente';
        if (conv.user_id && agentsMap[conv.user_id]) {
            agentNameStr = agentsMap[conv.user_id];
        }

        const authorName = isIncoming
            ? (conv.from_email || 'Solicitante')
            : (conv.user_id ? agentNameStr : 'Sistema');

        // Tentar extrair nome do from_email
        const displayName = conv.from_email
            ? conv.from_email.replace(/<.*>/, '').trim() || conv.from_email
            : (isIncoming ? 'Solicitante' : agentNameStr);

        const avatarClass = isNote ? 'note' : (isIncoming ? 'customer' : 'agent');
        const initials    = getInitials(displayName);

        const typeLabel = isNote
            ? `<span class="conv-type-tag note"><i class="ph ph-note"></i> Nota Pública</span>`
            : (isIncoming
                ? `<span class="conv-type-tag reply" style="background:rgba(100,116,139,0.15); color:#94a3b8;">
                       <i class="ph ph-user"></i> Solicitante
                   </span>`
                : `<span class="conv-type-tag reply"><i class="ph ph-headset"></i> Resposta do Agente</span>`
              );

        // Corpo da mensagem: usar body_text (texto puro) ou limpar HTML levemente
        let bodyContent = conv.body_text || stripHtml(conv.body || '');
        if (!bodyContent) bodyContent = '(sem conteúdo)';

        const bubbleClass = isNote ? 'conv-body note-body' : 'conv-body';

        // Tratar anexos da conversa/nota
        let attachmentsHtml = '';
        if (conv.attachments && conv.attachments.length > 0) {
            attachmentsHtml = '<div class="conv-attachments" style="margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">';
            conv.attachments.forEach(att => {
                const url = att.attachment_url || att.url || '#';
                const name = att.name || 'Anexo';
                const ext = name.split('.').pop().toLowerCase();
                const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);

                if (isImage) {
                    attachmentsHtml += `
                        <div class="conv-attachment-item">
                            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
                                <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" style="max-width: 100%; max-height: 250px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.1);">
                            </a>
                        </div>
                    `;
                } else {
                    attachmentsHtml += `
                        <div class="conv-attachment-item">
                            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.8rem; font-weight: 600; color: var(--trinus-blue); text-decoration: none;">
                                <i class="ph ph-file-arrow-down" style="font-size: 1.2rem;"></i> ${escapeHtml(name)}
                            </a>
                        </div>
                    `;
                }
            });
            attachmentsHtml += '</div>';
        }

        return `
            <div class="conversation-item" style="animation-delay: ${i * 0.05}s;">
                <div class="conv-avatar ${avatarClass}">${initials}</div>
                <div class="conv-bubble">
                    <div class="conv-meta">
                        <span class="conv-author">${escapeHtml(displayName)}</span>
                        ${typeLabel}
                        <span class="conv-date">${formatDate(conv.created_at)}</span>
                    </div>
                    <div class="${bubbleClass}">${escapeHtml(bodyContent)}</div>
                    ${attachmentsHtml}
                </div>
            </div>
        `;
    }).join('');
}

// Remove tags HTML de forma simples para exibição de texto
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// =========================================
// MODAL DE CONFIGURAÇÃO
// =========================================
function openConfigModal() {
    loadConfigFromStorage();
    configModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeConfigModal() {
    configModal.classList.remove('active');
    document.body.style.overflow = '';
}

function saveConfig() {
    const domain = configDomain.value.trim()
        .replace(/^https?:\/\//, '')   // Remover protocolo se colado
        .replace(/\/$/, '');           // Remover barra final

    const apiKey = configApikey.value.trim();

    if (!domain) {
        configDomain.focus();
        configDomain.style.borderColor = 'var(--status-resolved-text)'; // vermelho
        return;
    }

    localStorage.setItem('fs_domain', domain);
    localStorage.setItem('fs_apikey', apiKey);

    closeConfigModal();

    // Feedback visual
    btnConfig.innerHTML = '<i class="ph ph-check"></i> API Configurada';
    btnConfig.style.color = 'rgba(52, 211, 153, 0.8)';
    setTimeout(() => {
        btnConfig.innerHTML = '<i class="ph ph-gear"></i> Configurar API';
        btnConfig.style.color = '';
    }, 2500);
}

// =========================================
// EXPORTAÇÕES
// =========================================
function getExportData() {
    return filteredData.map(t => ({
        'ID':                    t.id,
        'Assunto':               t.subject,
        'Status':                getStatusName(t.status),
        'Prioridade':            getPriorityName(t.priority),
        'Origem':                getSourceName(t.source),
        'Email Solicitante':     t.requester_email,
        'Nome Solicitante':      t.requester_name,
        'Empresa/Empreendimento': t.empreendimento,
        'Valor':                 t.valor,
        'Tempo Gasto (h)':       t.tempo_gasto,
        'Tem Documento':         t.tem_documento,
        'Arquivos':              t.attachments ? t.attachments.map(a => a.name).join(' | ') : '',
        'Banco':                 t.banco,
        'Agência':               t.agencia,
        'Conta':                 t.conta,
        'Tipo de Pagamento':     t.tipo_pagamento,
        'Contrato/Medição':      t.contrato_medicao,
        'Agente':                t.agente,
        'Data de Criação':       t.created_at
    }));
}

function exportToCSV() {
    if (filteredData.length === 0) { alert('Nenhum dado para exportar.'); return; }

    const data    = getExportData();
    const headers = Object.keys(data[0]);

    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(fieldName => {
            let val = row[fieldName] ?? '';
            val = String(val).replace(/"/g, '""');
            if (/[",\n]/.test(val)) val = `"${val}"`;
            return val;
        }).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `trinus_auditoria_${Date.now()}.csv`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert('A biblioteca de exportação ainda não carregou. Tente novamente.');
        return;
    }
    if (filteredData.length === 0) { alert('Nenhum dado para exportar.'); return; }

    const data      = getExportData();
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoria');

    if (data.length > 0) {
        const wscols = Object.keys(data[0]).map(key => ({
            wch: Math.min(Math.max(...data.map(row => String(row[key] ?? '').length), key.length) + 2, 50)
        }));
        worksheet['!cols'] = wscols;
    }

    XLSX.writeFile(workbook, `trinus_auditoria_${Date.now()}.xlsx`);
}
