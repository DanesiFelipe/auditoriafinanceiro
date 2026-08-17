/**
 * Trinus Audit v2 — server.js
 * Servidor Express (Node.js) com fetch inteligente e cadenciado.
 * Estrategia: sequencial com pausas, filtro local, sem sobrecarregar a API.
 */

'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const DOMAIN       = (process.env.FRESHSERVICE_DOMAIN || '').trim();
const API_KEY      = (process.env.FRESHSERVICE_API_KEY || '').trim();
const WORKSPACE_ID = parseInt(process.env.WORKSPACE_ID || '24', 10);
const PORT         = parseInt(process.env.PORT || '5000', 10);
const TARGET_IDS   = [476, 477];
const FETCH_SINCE  = '2025-01-01T00:00:00Z';

// Arquivos de dados
const DATA_DIR    = path.join(__dirname, 'data');
const CACHE_FILE  = path.join(DATA_DIR, 'tickets.json');
const USERS_FILE  = path.join(DATA_DIR, 'users.json');

// Tempos de espera (ms) — controle de ritmo para nao sobrecarregar a API
const DELAY_BETWEEN_PAGES   = 1200;  // entre paginas da listagem
const DELAY_BETWEEN_DETAILS = 800;   // entre chamadas de detalhe de cada ticket
const DELAY_ON_429          = 0;     // calculado dinamicamente pelo Retry-After

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
let cache = { metadata: { lastSync: null, totalRecords: 0 }, tickets: [] };
let users = {};
let syncState = { running: false, phase: 'idle', checked: 0, matched: 0, total: 0, error: null };

// ─── INICIALIZAÇÃO ───────────────────────────────────────────────────────────
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            console.log(`[Cache] ${cache.metadata.totalRecords} tickets carregados.`);
        }
    } catch (e) {
        console.warn('[Cache] Erro ao carregar cache:', e.message);
    }
}

function saveCache() {
    ensureDataDir();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } else {
            // Usuario padrao se nao existir arquivo
            const defaultHash = crypto.createHash('sha256').update('auditoria@Felipe2026').digest('hex');
            users = { 'felipe.danesi': { hash: defaultHash, role: 'admin' } };
            saveUsers();
        }
    } catch (e) {
        console.error('[Users] Erro ao carregar usuarios:', e.message);
    }
}

function saveUsers() {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────
const AUTH_HEADER = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Faz uma unica requisicao GET com retry automatico e respeito ao 429.
 */
async function apiGet(apiPath, retries = 4) {
    const url = `https://${DOMAIN}${apiPath}`;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const result = await new Promise((resolve, reject) => {
                const options = {
                    hostname: DOMAIN,
                    path: apiPath,
                    method: 'GET',
                    headers: {
                        'Authorization': AUTH_HEADER,
                        'Content-Type': 'application/json'
                    },
                    rejectUnauthorized: false  // necessario para redes corporativas com SSL intercept
                };

                const req = https.request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 429) {
                            const retryAfter = parseInt(res.headers['retry-after'] || '60', 10);
                            return reject({ is429: true, retryAfter });
                        }
                        if (res.statusCode === 404) return resolve(null);
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                        }
                        try { resolve(JSON.parse(body)); }
                        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
                    });
                });

                req.on('error', e => reject(new Error(`Network: ${e.message}`)));
                req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout 30s')); });
                req.end();
            });

            return result;

        } catch (err) {
            if (err.is429) {
                const waitMs = err.retryAfter * 1000;
                console.log(`[429] Rate limit. Aguardando ${err.retryAfter}s...`);
                syncState.phase = `Rate limit atingido. Aguardando ${err.retryAfter}s...`;
                await sleep(waitMs);
                continue;
            }
            if (attempt === retries - 1) throw err;
            console.warn(`[Retry ${attempt + 1}] ${err.message}. Aguardando 5s...`);
            await sleep(5000);
        }
    }
    return null;
}

// ─── EXTRATOR DE CAMPOS ──────────────────────────────────────────────────────
function cf(obj, ...keys) {
    if (!obj) return '-';
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]);
    }
    return '-';
}

// ─── FETCH INTELIGENTE ───────────────────────────────────────────────────────
async function runSync() {
    if (syncState.running) return;

    syncState = { running: true, phase: 'Iniciando...', checked: 0, matched: 0, total: 0, error: null };
    console.log('\n' + '='.repeat(50));
    console.log(' [SYNC] Iniciando sincronizacao inteligente...');
    console.log('='.repeat(50));

    try {
        // FASE 1: Carregar agentes
        syncState.phase = 'Carregando agentes...';
        const agentsMap = {};
        let agPage = 1;
        while (agPage <= 5) {
            const d = await apiGet(`/api/v2/agents?per_page=100&page=${agPage}`);
            const agents = d?.agents || [];
            if (!agents.length) break;
            agents.forEach(a => { agentsMap[a.id] = a.name || `#${a.id}`; });
            if (agents.length < 100) break;
            agPage++;
            await sleep(800);
        }
        console.log(`[Agentes] ${Object.keys(agentsMap).length} carregados.`);

        // FASE 2: Listar todos os tickets de pagamento (paginado, sequencial)
        syncState.phase = 'Listando tickets...';
        const allTicketsMap = new Map();
        let updatedSince = FETCH_SINCE;

        outerLoop: while (true) {
            let page = 1;
            let fetchedInCycle = 0;
            let lastUpdatedAt = updatedSince;

            while (page <= 300) {
                syncState.phase = `Listando pagina ${page} (desde ${updatedSince.slice(0, 10)})...`;
                const path = `/api/v2/tickets?workspace_id=${WORKSPACE_ID}&updated_since=${updatedSince}&per_page=100&page=${page}&order_by=updated_at&order_type=asc&include=requester,stats`;
                const data = await apiGet(path);
                const tickets = data?.tickets || [];

                if (!tickets.length) break;

                tickets.forEach(t => {
                    allTicketsMap.set(t.id, t);
                    lastUpdatedAt = t.updated_at;
                });

                fetchedInCycle += tickets.length;
                console.log(`  [Pag ${page}] ${tickets.length} tickets (total unico: ${allTicketsMap.size})`);

                if (tickets.length < 100) break;

                page++;
                await sleep(DELAY_BETWEEN_PAGES); // pausa entre paginas — controle de ritmo
            }

            if (fetchedInCycle >= 300 * 100) {
                updatedSince = lastUpdatedAt;
                console.log(`  [Janela] Deslizando para: ${updatedSince}`);
            } else {
                break outerLoop;
            }
        }

        // FASE 3: Filtro local (sem nenhuma chamada extra)
        const filtered = Array.from(allTicketsMap.values()).filter(t => {
            const subj = (t.subject || '').toLowerCase();
            return (t.type === 'Request' || t.type === 'Service Request') && subj.includes('pagamento');
        });

        syncState.total = filtered.length;
        syncState.phase = `Buscando detalhes de ${filtered.length} tickets...`;
        console.log(`\n[Filtro] ${allTicketsMap.size} total → ${filtered.length} de pagamento`);

        // FASE 4: Detalhes um a um (sequencial, cadenciado)
        const result = [];

        for (let i = 0; i < filtered.length; i++) {
            const t = filtered[i];
            syncState.checked = i + 1;
            syncState.phase = `Detalhes: ticket ${i + 1}/${filtered.length} (#${t.id})...`;

            try {
                // Requested Items
                const reqData = await apiGet(`/api/v2/tickets/${t.id}/requested_items`);
                const reqItems = reqData?.requested_items || [];
                const matching = reqItems.filter(item => TARGET_IDS.includes(item.service_item_id));

                if (!matching.length) {
                    await sleep(300); // pequena pausa mesmo para nao-matching
                    continue;
                }

                syncState.matched++;

                // Buscar o ticket completo para pegar os anexos iniciais da descricao
                const ticketData = await apiGet(`/api/v2/tickets/${t.id}`);
                const fullTicket = ticketData?.ticket || t;

                // Conversas (que também podem ter anexos)
                const convData = await apiGet(`/api/v2/tickets/${t.id}/conversations`);
                const conversations = convData?.conversations || [];

                // Montar form_data
                const formData = {};
                matching.forEach(item => { if (item.custom_fields) Object.assign(formData, item.custom_fields); });

                const serviceNames = matching.map(i => {
                    if (i.service_item_id === 477) return 'Solicitacao de Pagamento';
                    if (i.service_item_id === 476) return 'Solicitacao de Pagamento Especial';
                    return `Item ${i.service_item_id}`;
                });

                const agentName = t.responder_id ? (agentsMap[t.responder_id] || `#${t.responder_id}`) : 'Nao atribuido';

                let valor = 0;
                try {
                    const vs = cf(formData, 'valor', 'value', 'montante').replace(',', '.');
                    valor = vs !== '-' ? parseFloat(vs) || 0 : 0;
                } catch (_) {}

                // Coletar todos os anexos (do ticket + das conversas)
                const allAttachments = [];
                if (fullTicket.attachments) {
                    fullTicket.attachments.forEach(a => allAttachments.push({ name: a.name, url: a.attachment_url || a.url || '#' }));
                }
                conversations.forEach(c => {
                    if (c.attachments) {
                        c.attachments.forEach(a => allAttachments.push({ name: a.name, url: a.attachment_url || a.url || '#' }));
                    }
                });

                let tempoGasto = '0h';
                if (fullTicket.stats && fullTicket.stats.resolution_time_in_secs) {
                    const secs = fullTicket.stats.resolution_time_in_secs;
                    const hrs = Math.floor(secs / 3600);
                    const mins = Math.floor((secs % 3600) / 60);
                    if (hrs > 0 && mins > 0) tempoGasto = `${hrs}h ${mins}m`;
                    else if (hrs > 0) tempoGasto = `${hrs}h`;
                    else if (mins > 0) tempoGasto = `${mins}m`;
                }

                result.push({
                    id:               t.id,
                    subject:          t.subject || `Ticket #${t.id}`,
                    servico:          serviceNames.join(' / '),
                    status:           t.status,
                    priority:         t.priority,
                    source:           t.source,
                    requester_email:  t.requester?.email  || '-',
                    requester_name:   t.requester?.name   || '-',
                    empreendimento:   cf(formData, 'empresa_empreendimento', 'empreendimento', 'empresa'),
                    valor,
                    tempo_gasto:      tempoGasto,
                    banco:            cf(formData, 'banco', 'banco_cod_banco', 'codigo_banco'),
                    agencia:          cf(formData, 'agencia'),
                    conta:            cf(formData, 'conta', 'conta_corrente'),
                    tipo_pagamento:   cf(formData, 'tipo_de_pagamento', 'tipo_pagamento', 'tipo'),
                    forma_pagamento:  cf(formData, 'forma_de_pagamento', 'forma_pagamento'),
                    contrato_medicao: cf(formData, 'contrato_medicao', 'contrato', 'medicao', 'n_do_contrato', 'numero_do_contrato'),
                    tem_documento:    allAttachments.length > 0 ? 'Sim' : 'Nao',
                    attachments:      allAttachments,
                    agente:           agentName,
                    created_at:       t.created_at,
                    updated_at:       t.updated_at,
                    conversations,
                    form_data:        formData
                });

                console.log(`  [OK] #${t.id} — "${t.subject?.slice(0, 50)}"`);

            } catch (err) {
                console.warn(`  [ERRO] Ticket #${t.id}: ${err.message}`);
            }

            // Pausa cadenciada entre cada ticket — o coracao da estrategia
            await sleep(DELAY_BETWEEN_DETAILS);
        }

        // Ordenar e salvar
        result.sort((a, b) => b.id - a.id);

        cache = {
            metadata: {
                lastSync:     new Date().toISOString(),
                totalRecords: result.length,
                workspaceId:  WORKSPACE_ID,
                targetItems:  TARGET_IDS,
                agents:       agentsMap
            },
            tickets: result
        };

        saveCache();

        syncState.running = false;
        syncState.phase = 'concluido';
        syncState.matched = result.length;

        console.log(`\n[SYNC] Concluido! ${result.length} tickets salvos.`);

    } catch (err) {
        syncState.running = false;
        syncState.phase = `erro: ${err.message}`;
        syncState.error = err.message;
        console.error('[SYNC] Erro fatal:', err.message);
    }
}

// ─── EXPRESS APP ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // servir HTML/CSS/JS estaticos

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ status: 'error', message: 'Campos obrigatorios.' });

    const user = users[username.trim().toLowerCase()];
    if (!user) return res.status(401).json({ status: 'error', message: 'Usuario ou senha incorretos.' });

    // Se o usuario tem salt, usar PBKDF2. Se nao tem, usa SHA256 antigo (retrocompatibilidade)
    let hash;
    if (user.salt) {
        hash = crypto.pbkdf2Sync(password, Buffer.from(user.salt, 'hex'), 100000, 32, 'sha256').toString('hex');
    } else {
        hash = crypto.createHash('sha256').update(password).digest('hex');
    }

    if (user.hash === hash) {
        return res.json({ status: 'success', role: user.role || 'user' });
    }
    return res.status(401).json({ status: 'error', message: 'Usuario ou senha incorretos.' });
});

// ── USERS ─────────────────────────────────────────────────────────────────────
app.get('/api/users', (req, res) => {
    const list = Object.entries(users).map(([k, v]) => ({ username: k, role: v.role || 'user' }));
    res.json({ status: 'success', users: list });
});

app.post('/api/users', (req, res) => {
    const { username, password, role } = req.body || {};
    const u = (username || '').trim().toLowerCase();
    if (!u || !password) return res.status(400).json({ status: 'error', message: 'Campos obrigatorios.' });
    if (users[u]) return res.status(400).json({ status: 'error', message: 'Usuario ja existe.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');

    users[u] = {
        salt: salt,
        hash: hash,
        role: ['admin', 'user'].includes(role) ? role : 'user'
    };
    saveUsers();
    res.json({ status: 'success', message: `Usuario ${u} criado.` });
});

app.put('/api/users/:username/role', (req, res) => {
    const u = req.params.username.toLowerCase();
    if (!users[u]) return res.status(404).json({ status: 'error', message: 'Usuario nao encontrado.' });
    const newRole = req.body?.role;
    if (!['admin', 'user'].includes(newRole)) return res.status(400).json({ status: 'error', message: 'Role invalida.' });
    users[u].role = newRole;
    saveUsers();
    res.json({ status: 'success', message: `Role de ${u} alterada para ${newRole}.` });
});

app.delete('/api/users/:username', (req, res) => {
    const u = req.params.username.toLowerCase();
    if (!users[u]) return res.status(404).json({ status: 'error', message: 'Usuario nao encontrado.' });
    if (Object.keys(users).length <= 1) return res.status(400).json({ status: 'error', message: 'Impossivel remover o unico usuario.' });
    delete users[u];
    saveUsers();
    res.json({ status: 'success', message: `Usuario ${u} removido.` });
});

// ── TICKETS & STATUS ──────────────────────────────────────────────────────────
app.get('/api/tickets', (req, res) => res.json(cache));

app.get('/api/status', (req, res) => {
    res.json({
        sync_in_progress: syncState.running,
        progress: {
            phase:   syncState.phase,
            checked: syncState.checked,
            matched: syncState.matched,
            total:   syncState.total
        },
        total_records: cache.metadata.totalRecords || 0,
        last_sync:     cache.metadata.lastSync || null
    });
});

app.post('/api/sync', (req, res) => {
    if (syncState.running) return res.status(400).json({ status: 'error', message: 'Sincronizacao ja em andamento.' });
    runSync(); // nao-bloqueante
    res.json({ status: 'success', message: 'Sincronizacao iniciada.' });
});

// Recarrega o cache do disco para a memória (útil após fix_agents.js)
app.post('/api/reload-cache', (req, res) => {
    try {
        loadCache();
        res.json({ status: 'success', message: `Cache recarregado: ${cache.metadata.totalRecords} tickets.` });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Rota fallback — serve o index.html para qualquer rota desconhecida
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── START ───────────────────────────────────────────────────────────────────
ensureDataDir();
loadCache();
loadUsers();

if (!DOMAIN || !API_KEY) {
    console.error('\n[ERRO] FRESHSERVICE_DOMAIN e FRESHSERVICE_API_KEY sao obrigatorios no .env\n');
    process.exit(1);
}

app.listen(PORT, '127.0.0.1', () => {
    const total    = cache.metadata.totalRecords || 0;
    const lastSync = cache.metadata.lastSync;
    const ageHours = lastSync ? (Date.now() - new Date(lastSync)) / 36e5 : Infinity;

    console.log('='.repeat(50));
    console.log(' Trinus Audit v2 — Servidor Node.js');
    console.log('='.repeat(50));
    console.log(` Dominio:    ${DOMAIN}`);
    console.log(` Workspace:  ${WORKSPACE_ID}`);
    console.log(` Cache:      ${total} tickets`);
    console.log(` Ultima sync: ${lastSync ? new Date(lastSync).toLocaleString('pt-BR') : 'Nunca'}`);
    console.log(` Servidor:   http://127.0.0.1:${PORT}`);
    console.log('='.repeat(50));

    // Auto-sync se cache estiver vazio ou com mais de 24h
    if (total === 0) {
        console.log(' [AUTO-SYNC] Cache vazio — iniciando sincronizacao...');
        runSync();
    } else if (ageHours > 24) {
        console.log(` [AUTO-SYNC] Cache com ${ageHours.toFixed(0)}h — atualizando...`);
        runSync();
    } else {
        console.log(` [INFO] Cache atualizado ha ${ageHours.toFixed(1)}h. Use o botao para atualizar.`);
    }
});
