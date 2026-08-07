/**
 * Trinus Audit — fetch-tickets.js
 * Busca tickets REAIS do Freshservice (service items 476 e 477).
 * Roda via GitHub Actions.
 *
 * Secrets necessários:
 *   FRESHSERVICE_DOMAIN  → ex: trinus.freshservice.com
 *   FRESHSERVICE_API_KEY → sua API key do Freshservice
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DOMAIN       = (process.env.FRESHSERVICE_DOMAIN || '').trim();
const API_KEY      = (process.env.FRESHSERVICE_API_KEY || '').trim();
const WORKSPACE_ID = parseInt(process.env.WORKSPACE_ID || '24', 10);

// IDs dos itens do catálogo de serviços que queremos capturar
const TARGET_ITEM_IDS = [476, 477];

if (!DOMAIN || !API_KEY) {
    console.error('❌ ERRO: FRESHSERVICE_DOMAIN e FRESHSERVICE_API_KEY são obrigatórias.');
    process.exit(1);
}

const AUTH = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');

log('═══════════════════════════════════════════');
log('  Trinus Audit — Fetch de Tickets');
log('═══════════════════════════════════════════');
log(`  Domínio:      ${DOMAIN}`);
log(`  Workspace:    ${WORKSPACE_ID}`);
log(`  Itens alvo:   ${TARGET_ITEM_IDS.join(', ')}`);
log('═══════════════════════════════════════════\n');

// ─── LOGGER ───────────────────────────────────────────────────────────────────
function log(msg) { console.log(msg); }
function warn(msg) { console.warn('⚠️  ' + msg); }
function err(msg)  { console.error('❌ ' + msg); }

// ─── HTTP HELPER ─────────────────────────────────────────────────────────────
function get(apiPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: DOMAIN,
            port: 443,
            path: apiPath,
            method: 'GET',
            headers: {
                'Authorization': AUTH,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                log(`  [HTTP ${res.statusCode}] ${apiPath.split('?')[0]}`);

                if (res.statusCode === 429) {
                    return reject(new Error('RATE_LIMIT: Aguarde e tente novamente.'));
                }
                if (res.statusCode === 401 || res.statusCode === 403) {
                    return reject(new Error(`AUTH_ERROR (${res.statusCode}): API Key inválida ou sem permissão. Verifique a secret FRESHSERVICE_API_KEY.`));
                }
                if (res.statusCode === 404) {
                    return resolve(null); // 404 = recurso não existe, retorna null graciosamente
                }
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 300)}`));
                }

                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message} | body: ${body.substring(0, 100)}`));
                }
            });
        });

        req.on('error', e => reject(new Error(`Network error: ${e.message}`)));
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout (30s)')); });
        req.end();
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── BUSCAR UMA PÁGINA DE TICKETS ────────────────────────────────────────────
async function fetchTicketsPage(currentUpdatedSince, page) {
    const path = `/api/v2/tickets?workspace_id=${WORKSPACE_ID}&updated_since=${currentUpdatedSince}&per_page=100&page=${page}&order_by=updated_at&order_type=asc&include=requester`;
    const data = await get(path);
    return data ? (data.tickets || []) : [];
}

// ─── BUSCAR REQUESTED ITEMS DE UM TICKET ─────────────────────────────────────
async function fetchRequestedItems(ticketId) {
    const data = await get(`/api/v2/tickets/${ticketId}/requested_items`);
    if (!data) return []; // 404 = ticket regular, sem items
    return data.requested_items || [];
}

// ─── BUSCAR AGENTES ───────────────────────────────────────────────────────────
async function fetchAgents() {
    const map = {};
    let page = 1;
    while (page <= 5) {
        const data = await get(`/api/v2/agents?per_page=100&page=${page}`);
        const agents = data ? (data.agents || []) : [];
        if (!agents.length) break;
        agents.forEach(a => { map[a.id] = a.name || `#${a.id}`; });
        if (agents.length < 100) break;
        page++;
        await sleep(300);
    }
    log(`  → ${Object.keys(map).length} agentes carregados.\n`);
    return map;
}

// ─── EXTRAIR CAMPO CUSTOM ────────────────────────────────────────────────────
function cf(obj, ...keys) {
    if (!obj) return '-';
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
            return String(obj[k]);
        }
    }
    return '-';
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
    // 1. Agentes
    log('[ 1/3 ] Carregando agentes...');
    const agents = await fetchAgents();

    // 2. Buscar todos os tickets paginando
    log('[ 2/3 ] Buscando tickets do Freshservice...\n');

    const allTicketsMap = new Map();
    let currentUpdatedSince = '2025-01-01T00:00:00Z';
    const MAX_PAGES = 300;

    while (true) {
        let page = 1;
        let fetchedInCycle = 0;
        let lastUpdatedAt = currentUpdatedSince;

        while (page <= MAX_PAGES) {
            log(`  [Data >= ${currentUpdatedSince}] Página ${page}...`);
            let tickets;
            try {
                tickets = await fetchTicketsPage(currentUpdatedSince, page);
            } catch (e) {
                err(`Erro na página ${page}: ${e.message}`);
                if (page === 1) throw e;
                break;
            }

            if (!tickets.length) {
                log(`  → Página vazia. Fim deste ciclo.`);
                break;
            }

            tickets.forEach(t => {
                if (!allTicketsMap.has(t.id)) allTicketsMap.set(t.id, t);
                lastUpdatedAt = t.updated_at;
            });
            
            log(`  → ${tickets.length} tickets (Total único: ${allTicketsMap.size})`);
            fetchedInCycle += tickets.length;

            if (tickets.length < 100) {
                log('  → Fim dos tickets (menos de 100).');
                break;
            }

            page++;
            await sleep(400);
        }

        // Se baixou 30.000 tickets, significa que bateu no limite do max pages
        // Entao avança a janela de tempo e tenta buscar os mais novos
        if (fetchedInCycle >= (MAX_PAGES * 100)) {
            currentUpdatedSince = lastUpdatedAt;
            log(`\n  → Limite de 30k tickets atingido! Deslizando janela de data para: ${currentUpdatedSince}\n`);
        } else {
            break; // Acabaram todos os tickets
        }
    }

    const allTickets = Array.from(allTicketsMap.values());
    log(`\n  Total bruto extraído: ${allTickets.length} tickets\n`);

    // 3. Processar — checar requested_items para filtrar por item 476/477
    log('[ 3/3 ] Processando e filtrando por service items 476 e 477...\n');

    const result = [];
    let checked = 0;
    let matched = 0;
    let skipped = 0;

    for (const t of allTickets) {
        checked++;
        process.stdout.write(`\r  Verificando ${checked}/${allTickets.length} (${matched} encontrados)...`);

        // Busca os itens do catálogo deste ticket
        let reqItems = [];
        try {
            reqItems = await fetchRequestedItems(t.id);
        } catch (e) {
            warn(`requested_items do ticket #${t.id}: ${e.message}`);
        }

        // Filtra: apenas tickets que possuem item 476 ou 477
        const matchingItems = reqItems.filter(item =>
            TARGET_ITEM_IDS.includes(item.service_item_id)
        );

        if (!matchingItems.length) {
            skipped++;
            await sleep(100);
            continue;
        }

        matched++;

        // Agrupa custom_fields de todos os itens correspondentes
        let formData = {};
        for (const item of matchingItems) {
            if (item.custom_fields) {
                formData = { ...formData, ...item.custom_fields };
            }
        }

        // Determina o nome do serviço pelo item ID
        const serviceNames = matchingItems.map(i => {
            if (i.service_item_id === 477) return 'Solicitação de Pagamento';
            if (i.service_item_id === 476) return 'Solicitação de Pagamento Especial';
            return `Item ${i.service_item_id}`;
        });

        const agentName = t.responder_id
            ? (agents[t.responder_id] || `Agente #${t.responder_id}`)
            : 'Não atribuído';

        const hasAttachment = Array.isArray(t.attachments) && t.attachments.length > 0;

        result.push({
            id:               t.id,                          // ← ID REAL do Freshservice
            subject:          t.subject || `Ticket #${t.id}`,
            servico:          serviceNames.join(' / '),
            status:           t.status,
            priority:         t.priority,
            source:           t.source,
            requester_email:  t.requester?.email  || '-',
            requester_name:   t.requester?.name   || '-',

            // Campos do formulário — ajuste as chaves conforme o seu catálogo
            empreendimento:   cf(formData, 'empresa_empreendimento', 'empreendimento', 'empresa'),
            valor:            cf(formData, 'valor', 'value', 'montante') === '-'
                                ? 0
                                : parseFloat(String(cf(formData, 'valor', 'value', 'montante')).replace(',', '.')) || 0,
            banco:            cf(formData, 'banco'),
            agencia:          cf(formData, 'agencia', 'agência'),
            conta:            cf(formData, 'conta'),
            tipo_pagamento:   cf(formData, 'tipo_de_pagamento', 'tipo_pagamento', 'tipo'),
            contrato_medicao: cf(formData, 'contrato_medicao', 'contrato', 'medicao'),

            tempo_gasto:      0,
            tem_documento:    hasAttachment ? 'Sim' : 'Não',
            attachments:      (t.attachments || []).map(a => ({
                name: a.name,
                url:  a.attachment_url || a.url || '#'
            })),

            agente:      agentName,
            created_at:  t.created_at
        });

        await sleep(150);
    }

    console.log(''); // nova linha após o \r
    log(`\n  ✔ ${matched} tickets encontrados (items 476/477) de ${allTickets.length} verificados\n`);

    if (matched === 0) {
        warn('Nenhum ticket com service_item_id 476 ou 477 foi encontrado.');
        warn('Verifique se os IDs 476 e 477 estão corretos para este ambiente Freshservice.');
        warn('Dica: inspecione o log de um ticket real em /api/v2/tickets/{id}/requested_items');
    }

    // Ordenar por ID decrescente (mais recente primeiro)
    result.sort((a, b) => b.id - a.id);

    // Salvar
    const outDir  = path.join(__dirname, '..', 'data');
    const outPath = path.join(outDir, 'tickets.json');

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const output = {
        metadata: {
            lastSync:     new Date().toISOString(),
            totalRecords: result.length,
            workspaceId:  WORKSPACE_ID,
            serviceItems: TARGET_ITEM_IDS,
            note:         'IDs reais do Freshservice',
            agents:       agents
        },
        tickets: result
    };

    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    log(`✅ Sucesso! ${result.length} tickets salvos em data/tickets.json`);
    log(`   Última sync: ${output.metadata.lastSync}\n`);
}

main().catch(e => {
    err(`ERRO FATAL: ${e.message}`);
    console.error(e);
    process.exit(1);
});
