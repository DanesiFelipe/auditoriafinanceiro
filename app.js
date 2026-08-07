// Estado Global
let ticketsData = [];
let filteredData = [];
let sortCol = 'id';
let sortAsc = false;

// Elementos da DOM
const tbody = document.getElementById('audit-tbody');
const loadingIndicator = document.getElementById('loading-indicator');
const recordCount = document.getElementById('record-count');
const syncTime = document.getElementById('sync-time');

// Filtros
const globalSearch = document.getElementById('global-search');
const filterStatus = document.getElementById('filter-status');
const filterTipo = document.getElementById('filter-tipo-pagamento');
const filterEmpresa = document.getElementById('filter-empreendimento');
const filterDateStart = document.getElementById('filter-date-start');
const filterDateEnd = document.getElementById('filter-date-end');
const btnClearFilters = document.getElementById('btn-clear-filters');

// Modal
const modal = document.getElementById('details-modal');
const modalBody = document.getElementById('modal-body');
const modalTitle = document.getElementById('modal-title');
const btnCloseModal = document.getElementById('btn-close-modal');
const modalTicketLink = document.getElementById('modal-ticket-link');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupEventListeners();
});

function setupEventListeners() {
    // Filtros
    globalSearch.addEventListener('input', applyFilters);
    filterStatus.addEventListener('change', applyFilters);
    filterTipo.addEventListener('change', applyFilters);
    filterEmpresa.addEventListener('input', applyFilters);
    filterDateStart.addEventListener('change', applyFilters);
    filterDateEnd.addEventListener('change', applyFilters);
    
    btnClearFilters.addEventListener('click', () => {
        globalSearch.value = '';
        filterStatus.value = '';
        filterTipo.value = '';
        filterEmpresa.value = '';
        filterDateStart.value = '';
        filterDateEnd.value = '';
        applyFilters();
    });

    // Ordenação
    document.querySelectorAll('th').forEach((th, index) => {
        th.addEventListener('click', () => handleSort(index, th));
    });

    // Botões Sidebar
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

    // Modal
    btnCloseModal.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

// Carregamento de Dados
async function loadData() {
    loadingIndicator.style.display = 'flex';
    
    try {
        // Na Option A, o GitHub Actions gera esse JSON.
        // Como o cache pode ser agressivo, adicionamos um timestamp para forçar reload.
        const response = await fetch(`data/tickets.json?t=${new Date().getTime()}`);
        
        if (!response.ok) {
            throw new Error('Falha ao carregar dados. O arquivo data/tickets.json não foi encontrado.');
        }

        const data = await response.json();
        ticketsData = data.tickets || [];
        
        // Atualiza a data de sincronização (metadata gerado pelo script node)
        if (data.metadata && data.metadata.lastSync) {
            const syncDate = new Date(data.metadata.lastSync);
            syncTime.textContent = syncDate.toLocaleString('pt-BR');
        } else {
            syncTime.textContent = new Date().toLocaleString('pt-BR');
        }

        applyFilters();
    } catch (error) {
        console.error('Erro:', error);
        tbody.innerHTML = `<tr><td colspan="19" style="text-align: center; color: var(--status-pending-text); padding: 2rem;">
            Aviso: ${error.message} <br><br>
            Se você acabou de configurar o projeto, certifique-se de que o GitHub Actions rodou pelo menos uma vez para gerar os dados.
        </td></tr>`;
        recordCount.textContent = '0 registros';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

// Renderização
function renderTable(data) {
    tbody.innerHTML = '';
    
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="19" style="text-align: center; padding: 2rem; color: var(--text-muted);">Nenhum registro encontrado.</td></tr>`;
        recordCount.textContent = '0 registros encontrados';
        return;
    }

    data.forEach(ticket => {
        const tr = document.createElement('tr');
        
        // Colunas
        tr.innerHTML = `
            <td>#${ticket.id}</td>
            <td>
                <div class="truncate" title="${escapeHtml(ticket.subject)}">${escapeHtml(ticket.subject)}</div>
            </td>
            <td><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></td>
            <td>${getPriorityName(ticket.priority)}</td>
            <td>${getSourceName(ticket.source)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_email)}">${escapeHtml(ticket.requester_email)}</div></td>
            <td><div class="truncate" title="${escapeHtml(ticket.requester_name)}">${escapeHtml(ticket.requester_name)}</div></td>
            <td><div class="truncate" title="${escapeHtml(ticket.empreendimento)}">${escapeHtml(ticket.empreendimento)}</div></td>
            <td>${formatCurrency(ticket.valor)}</td>
            <td>${ticket.tempo_gasto}h</td>
            <td>${ticket.tem_documento}</td>
            <td>${formatAttachments(ticket.attachments, true)}</td>
            <td>${escapeHtml(ticket.banco)}</td>
            <td>${escapeHtml(ticket.agencia)}</td>
            <td>${escapeHtml(ticket.conta)}</td>
            <td>${renderTipoPagamento(ticket.tipo_pagamento)}</td>
            <td>${escapeHtml(ticket.contrato_medicao)}</td>
            <td><div class="truncate" title="${escapeHtml(ticket.agente)}">${escapeHtml(ticket.agente)}</div></td>
            <td class="actions-col">
                <button class="btn-icon" onclick="openModal(${ticket.id})" title="Ver Detalhes">
                    <i class="ph ph-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    recordCount.textContent = `${data.length} registros encontrados`;
}

// Filtros
function applyFilters() {
    const term = globalSearch.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const statusVal = filterStatus.value;
    const tipoVal = filterTipo.value.toLowerCase();
    const empresaVal = filterEmpresa.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const dateStart = filterDateStart.value ? new Date(filterDateStart.value) : null;
    const dateEnd = filterDateEnd.value ? new Date(filterDateEnd.value) : null;
    
    // Configura o final do dia para a data final
    if (dateEnd) {
        dateEnd.setHours(23, 59, 59, 999);
    }

    filteredData = ticketsData.filter(t => {
        // Filtro Status
        if (statusVal && String(t.status) !== statusVal) return false;
        
        // Filtro Tipo Pagamento
        if (tipoVal && (!t.tipo_pagamento || t.tipo_pagamento.toLowerCase() !== tipoVal)) return false;
        
        // Filtro Empreendimento
        if (empresaVal) {
            const emp = t.empreendimento ? t.empreendimento.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : '';
            if (!emp.includes(empresaVal)) return false;
        }

        // Filtro Data
        if (dateStart || dateEnd) {
            const tDate = new Date(t.created_at);
            if (dateStart && tDate < dateStart) return false;
            if (dateEnd && tDate > dateEnd) return false;
        }

        // Filtro Global (Search)
        if (term) {
            const searchableText = [
                t.id, t.subject, t.requester_name, t.requester_email,
                t.empreendimento, t.banco, t.agencia, t.conta, t.agente
            ].join(' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            
            if (!searchableText.includes(term)) return false;
        }

        return true;
    });

    // Re-aplicar ordenação
    sortData();
    renderTable(filteredData);
}

// Ordenação
const colKeys = [
    'id', 'subject', 'status', 'priority', 'source', 'requester_email', 
    'requester_name', 'empreendimento', 'valor', 'tempo_gasto', 'tem_documento', 
    'attachments', 'banco', 'agencia', 'conta', 'tipo_pagamento', 'contrato_medicao', 'agente'
];

function handleSort(colIndex, thElement) {
    // Ignorar clique na coluna de ações
    if (colIndex >= colKeys.length) return;

    const key = colKeys[colIndex];
    
    if (sortCol === key) {
        sortAsc = !sortAsc;
    } else {
        sortCol = key;
        sortAsc = true;
    }

    // Atualizar ícones
    document.querySelectorAll('th .sort-icon').forEach(icon => {
        icon.className = 'ph ph-caret-up sort-icon';
        icon.style.opacity = '0.2';
    });
    
    const currentIcon = thElement.querySelector('.sort-icon');
    if (currentIcon) {
        currentIcon.className = sortAsc ? 'ph ph-caret-up sort-icon' : 'ph ph-caret-down sort-icon';
        currentIcon.style.opacity = '1';
    }

    sortData();
    renderTable(filteredData);
}

function sortData() {
    filteredData.sort((a, b) => {
        let valA = a[sortCol];
        let valB = b[sortCol];

        // Tratar nulos e undefined
        if (valA == null) valA = '';
        if (valB == null) valB = '';

        // Ordenação numérica para ID e Valor
        if (sortCol === 'id' || sortCol === 'valor' || sortCol === 'tempo_gasto') {
            const numA = Number(valA) || 0;
            const numB = Number(valB) || 0;
            return sortAsc ? numA - numB : numB - numA;
        }

        // Ordenação string
        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        
        if (strA < strB) return sortAsc ? -1 : 1;
        if (strA > strB) return sortAsc ? 1 : -1;
        return 0;
    });
}

// Utilitários de Formatação
function getStatusName(status) {
    const map = { 2: 'Aberto', 3: 'Pendente', 4: 'Resolvido', 5: 'Fechado' };
    return map[status] || `Status ${status}`;
}

function getPriorityName(priority) {
    const map = { 1: 'Baixa', 2: 'Média', 3: 'Alta', 4: 'Urgente' };
    return map[priority] || priority;
}

function getSourceName(source) {
    const map = { 1: 'Email', 2: 'Portal', 3: 'Phone', 4: 'Chat', 5: 'Mobihelp', 6: 'Feedback Widget', 7: 'Outbound Email' };
    return map[source] || 'Outro';
}

function formatCurrency(value) {
    if (!value && value !== 0) return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}

function renderTipoPagamento(tipo) {
    if (!tipo) return '-';
    const tipoUpper = String(tipo).toUpperCase();
    let dotClass = 'dot';
    if (tipoUpper.includes('PIX')) dotClass += ' dot-pix';
    else if (tipoUpper.includes('TED')) dotClass += ' dot-ted';
    else if (tipoUpper.includes('BOLETO')) dotClass += ' dot-boleto';
    
    return `<div class="type-indicator"><div class="${dotClass}"></div>${escapeHtml(tipoUpper)}</div>`;
}

function formatAttachments(attachments, isTable = false) {
    if (!attachments || attachments.length === 0) return '-';
    
    if (isTable) {
        return `<div class="truncate" title="${attachments.map(a => a.name).join(', ')}">${attachments.length} arquivo(s)</div>`;
    }
    
    return attachments.map(a => `
        <div class="attachment-item">
            <span><i class="ph ph-file"></i> ${escapeHtml(a.name)}</span>
            <a href="${a.url}" target="_blank" class="btn btn-secondary"><i class="ph ph-download-simple"></i> Baixar</a>
        </div>
    `).join('');
}

function escapeHtml(unsafe) {
    if (unsafe == null) return '-';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Modal
function openModal(id) {
    const ticket = ticketsData.find(t => t.id === id);
    if (!ticket) return;

    modalTitle.textContent = `Detalhes do Ticket #${ticket.id}`;
    
    // Opcional: ajustar a URL base para o seu domínio real
    modalTicketLink.href = `https://trinus.freshservice.com/a/tickets/${ticket.id}`;

    modalBody.innerHTML = `
        <div class="detail-group">
            <span class="detail-label">Assunto</span>
            <span class="detail-value">${escapeHtml(ticket.subject)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Status</span>
            <span class="detail-value"><span class="badge status-${ticket.status}">${getStatusName(ticket.status)}</span></span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Solicitante</span>
            <span class="detail-value">${escapeHtml(ticket.requester_name)} (${escapeHtml(ticket.requester_email)})</span>
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
            <span class="detail-value">${formatCurrency(ticket.valor)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Tipo de Pagamento</span>
            <span class="detail-value">${renderTipoPagamento(ticket.tipo_pagamento)}</span>
        </div>
        <div class="detail-group">
            <span class="detail-label">Banco / Ag. / Conta</span>
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
        
        <div class="attachments-section">
            <h3>Anexos (${ticket.attachments ? ticket.attachments.length : 0})</h3>
            <div class="attachment-list">
                ${formatAttachments(ticket.attachments, false)}
            </div>
        </div>
    `;

    modal.classList.add('active');
}

function closeModal() {
    modal.classList.remove('active');
}

// Exportações
function getExportData() {
    return filteredData.map(t => ({
        'ID': t.id,
        'Assunto': t.subject,
        'Status': getStatusName(t.status),
        'Prioridade': getPriorityName(t.priority),
        'Origem': getSourceName(t.source),
        'Email Solicitante': t.requester_email,
        'Nome Solicitante': t.requester_name,
        'Empresa/Empreendimento': t.empreendimento,
        'Valor': t.valor,
        'Tempo Gasto': t.tempo_gasto,
        'Tem Documento': t.tem_documento,
        'Arquivos': t.attachments ? t.attachments.map(a => a.name).join(' | ') : '',
        'Banco': t.banco,
        'Agência': t.agencia,
        'Conta': t.conta,
        'Tipo de Pagamento': t.tipo_pagamento,
        'Contrato Medição': t.contrato_medicao,
        'Agente': t.agente,
        'Data de Criação': t.created_at
    }));
}

function exportToCSV() {
    if (filteredData.length === 0) {
        alert("Nenhum dado para exportar.");
        return;
    }
    
    const data = getExportData();
    const headers = Object.keys(data[0]);
    
    // Converter para CSV (tratando aspas e quebras de linha)
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(fieldName => {
            let val = row[fieldName];
            if (val === null || val === undefined) val = '';
            val = String(val).replace(/"/g, '""');
            if (val.search(/("|,|\n)/g) >= 0) val = `"${val}"`;
            return val;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `auditoria_financeira_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        alert("A biblioteca de exportação para Excel ainda não carregou. Tente novamente em alguns segundos.");
        return;
    }
    
    if (filteredData.length === 0) {
        alert("Nenhum dado para exportar.");
        return;
    }

    const data = getExportData();
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Auditoria");
    
    // Ajustar largura das colunas
    const maxWidths = data.map(row => Object.keys(row).map(key => {
        return { width: Math.min(Math.max(String(row[key]).length, String(key).length) + 2, 50) };
    }));
    
    // Simplificado - pegando o máximo de cada coluna
    if (maxWidths.length > 0) {
        const wscols = Object.keys(data[0]).map((key, i) => {
            const max = Math.max(...data.map(row => String(row[key]).length), String(key).length);
            return { wch: Math.min(max + 2, 50) };
        });
        worksheet['!cols'] = wscols;
    }

    XLSX.writeFile(workbook, `auditoria_financeira_${new Date().getTime()}.xlsx`);
}
