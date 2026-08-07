/**
 * Trinus Audit — fetch-tickets.js
 * Script Node.js para buscar tickets da API do Freshservice e formatar para o frontend.
 * Roda via GitHub Actions.
 *
 * Secrets necessários no GitHub:
 *   FRESHSERVICE_DOMAIN  = trinus.freshservice.com
 *   FRESHSERVICE_API_KEY = <sua api key>
 *
 * Variáveis de ambiente opcionais:
 *   WORKSPACE_ID      = 24   (padrão)
 *   SERVICE_ITEM_IDS  = 477,476  (se vazio, busca todos os service requests)
 *   AUDIT_YEAR        = 2025 (se vazio, busca TODOS os anos sem filtro)
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// =========================================
// CONFIGURAÇÃO
// =========================================
const DOMAIN       = process.env.FRESHSERVICE_DOMAIN;
const API_KEY      = process.env.FRESHSERVICE_API_KEY;
const WORKSPACE_ID = parseInt(process.env.WORKSPACE_ID || '24', 10);

// SERVICE_ITEM_IDS: usado apenas para extrair os custom_fields corretos
// NÃO filtra/descarta tickets — apenas prioriza a leitura dos campos do formulário
const SERVICE_ITEM_IDS = process.env.SERVICE_ITEM_IDS
    ? process.env.SERVICE_ITEM_IDS.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    : [477, 476];

// AUDIT_YEAR: se definido, filtra apenas tickets desse ano. Se vazio, busca tudo.
const AUDIT_YEAR = process.env.AUDIT_YEAR
    ? parseInt(process.env.AUDIT_YEAR, 10)
    : null;

if (!DOMAIN || !API_KEY) {
    console.error('ERRO: FRESHSERVICE_DOMAIN e FRESHSERVICE_API_KEY são obrigatórias.');
    process.exit(1);
}

const AUTH_TOKEN = Buffer.from(`${API_KEY}:X`).toString('base64');

console.log('\n=== Trinus Audit — Fetch de Tickets ===');
console.log(`Domínio:          ${DOMAIN}`);
console.log(`Workspace ID:     ${WORKSPACE_ID}`);
console.log(`Service Items:    ${SERVICE_ITEM_IDS.join(', ')}`);
console.log(`Filtro de Ano:    ${AUDIT_YEAR || 'Todos os anos'}`);
console.log('=======================================\n');

// =========================================
// HELPER: Requisição HTTPS
// =========================================
function fetchAPI(apiPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: DOMAIN,
            port: 443,
            path: apiPath,
            method: 'GET',
            headers: {
                'Authorization': `Basic ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Parse JSON error: ${e.message} | body: ${data.substring(0, 100)}`));
                    }
                } else if (res.statusCode === 429) {
                    reject(new Error('Rate limit atingido (429). Aguarde alguns minutos e tente novamente.'));
                } else if (res.statusCode === 401) {
                    reject(new Error('Autenticação falhou (401). Verifique FRESHSERVICE_API_KEY.'));
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 300)}`));
                }
            });
        });

        req.on('error', e => reject(e));
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Timeout na requisição (30s)'));
        });
        req.end();
    });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// =========================================
// HELPER: Extrair campo customizado
// =========================================
function extractCustomField(ticket, fieldName) {
    if (ticket.custom_fields && ticket.custom_fields[fieldName] !== undefined) {
        return ticket.custom_fields[fieldName] ?? '-';
    }
    return '-';
}

// =========================================
// BUSCAR TODOS OS TICKETS (paginação completa)
// Sem filtro de tipo nem de ano na URL — busca TUDO do workspace e filtra depois
// =========================================
async function fetchAllTickets() {
    let allTickets = [];
    let page = 1;
    const perPage = 100;
    let totalFetched = 0;

    console.log('Iniciando busca paginada de tickets...\n');

    while (true) {
        // Busca todos os tickets do workspace, sem filtro de type (para não perder nenhum)
        // A API v2 do Freshservice não aceita "type" como query param — o filtro é feito em JS
        const apiPath = `/api/v2/tickets?include=requester,stats&per_page=${perPage}&page=${page}&workspace_id=${WORKSPACE_ID}&order_by=created_at&order_type=desc`;

        console.log(`  Página ${page}...`);

        let response;
        try {
            response = await fetchAPI(apiPath);
        } catch (e) {
            // Se der erro de paginação depois da pág 1, parar (Freshservice limita a 300 páginas)
            if (page > 1 && e.message.includes('400')) {
                console.log(`  Fim da paginação na página ${page}.`);
                break;
            }
            throw e;
        }

        const tickets = response.tickets || [];
        totalFetched += tickets.length;

        if (tickets.length === 0) {
            console.log(`  Nenhum ticket na página ${page}. Fim da busca.`);
            break;
        }

        // Filtrar por ano, SE AUDIT_YEAR estiver definido
        let toAdd = tickets;
        if (AUDIT_YEAR) {
            toAdd = tickets.filter(t => {
                const created = new Date(t.created_at);
                return created.getFullYear() === AUDIT_YEAR;
            });

            // Se nenhum ticket desta página é do ano, E já passamos do início do ano → parar
            // (tickets ordenados desc, então se chegamos em datas anteriores ao ano, paramos)
            const oldestOnPage = new Date(tickets[tickets.length - 1].created_at);
            if (oldestOnPage.getFullYear() < AUDIT_YEAR) {
                allTickets = allTickets.concat(toAdd);
                console.log(`    → ${tickets.length} tickets, ${toAdd.length} do ano ${AUDIT_YEAR} (chegamos em ${AUDIT_YEAR - 1}, parando)`);
                break;
            }
        }

        allTickets = allTickets.concat(toAdd);
        console.log(`    → ${tickets.length} brutos | ${toAdd.length} incluídos | total acumulado: ${allTickets.length}`);

        if (tickets.length < perPage) {
            console.log('  Última página atingida.');
            break;
        }

        // Freshservice API v2 limita a 30 páginas (3000 tickets) na rota /tickets
        if (page >= 30) {
            console.log('  Limite de 30 páginas (3000 tickets) atingido.');
            break;
        }

        page++;
        await delay(400); // Respeitar rate limit
    }

    console.log(`\nTotal de tickets buscados: ${totalFetched} brutos → ${allTickets.length} após filtros`);
    return allTickets;
}

// =========================================
// BUSCAR ITENS SOLICITADOS (form data do service request)
// =========================================
async function fetchRequestedItems(ticketId) {
    try {
        const resp = await fetchAPI(`/api/v2/tickets/${ticketId}/requested_items`);
        return resp.requested_items || [];
    } catch (e) {
        // 404 = ticket regular (não é service request), é normal
        if (!e.message.includes('404')) {
            console.warn(`  [!] requested_items ticket #${ticketId}: ${e.message}`);
        }
        return [];
    }
}

// =========================================
// BUSCAR CACHE DE AGENTES
// =========================================
async function fetchAgentsCache() {
    const agentsMap = {};
    try {
        // Buscar até 200 agentes (paginação simples)
        for (let page = 1; page <= 2; page++) {
            const resp = await fetchAPI(`/api/v2/agents?per_page=100&page=${page}`);
            const agents = resp.agents || [];
            if (agents.length === 0) break;
            agents.forEach(a => {
                agentsMap[a.id] = a.name || `Agente ${a.id}`;
            });
            if (agents.length < 100) break;
            await delay(200);
        }
        console.log(`Cache de agentes: ${Object.keys(agentsMap).length} carregados.`);
    } catch (e) {
        console.warn(`[!] Não foi possível carregar agentes: ${e.message}`);
    }
    return agentsMap;
}

// =========================================
// MAIN
// =========================================
async function main() {
    try {
        // 1. Cache de agentes
        const agentsMap = await fetchAgentsCache();
        await delay(300);

        // 2. Buscar todos os tickets
        const rawTickets = await fetchAllTickets();

        if (rawTickets.length === 0) {
            console.warn('\n⚠️ Nenhum ticket encontrado. Verifique o WORKSPACE_ID e as credenciais.');
        }

        // 3. Processar cada ticket
        const formattedTickets = [];
        let skipped = 0;

        for (let i = 0; i < rawTickets.length; i++) {
            const t = rawTickets[i];
            process.stdout.write(`\r  Processando ticket ${i + 1}/${rawTickets.length} (#${t.id})...`);

            // Buscar campos do formulário (service request items)
            const reqItems = await fetchRequestedItems(t.id);
            let formData = {};

            // Extrair custom_fields de todos os itens do catálogo
            // Prioriza itens que correspondem aos SERVICE_ITEM_IDS (477, 476)
            const priorityItems = reqItems.filter(item => SERVICE_ITEM_IDS.includes(item.service_item_id));
            const otherItems    = reqItems.filter(item => !SERVICE_ITEM_IDS.includes(item.service_item_id));

            // Aplicar: outros primeiro (menor prioridade), priority por cima
            for (const item of [...otherItems, ...priorityItems]) {
                if (item.custom_fields) {
                    formData = { ...formData, ...item.custom_fields };
                }
            }

            const agenteName    = t.responder_id
                ? (agentsMap[t.responder_id] || `Agente #${t.responder_id}`)
                : 'Não atribuído';

            const hasAttachment = Array.isArray(t.attachments) && t.attachments.length > 0;

            formattedTickets.push({
                id:               t.id,
                subject:          t.subject || '-',
                status:           t.status,
                priority:         t.priority,
                source:           t.source,
                requester_email:  t.requester?.email  || '-',
                requester_name:   t.requester?.name   || '-',
                empreendimento:   formData['empresa_empreendimento']
                               || formData['empreendimento']
                               || extractCustomField(t, 'empresa_empreendimento')
                               || '-',
                valor:            formData['valor']
                               || formData['value']
                               || extractCustomField(t, 'valor')
                               || 0,
                tempo_gasto:      0,
                tem_documento:    hasAttachment ? 'Sim' : 'Não',
                attachments:      (t.attachments || []).map(a => ({
                    name: a.name,
                    url:  a.attachment_url
                })),
                banco:            formData['banco']             || extractCustomField(t, 'banco'),
                agencia:          formData['agencia']           || extractCustomField(t, 'agencia'),
                conta:            formData['conta']             || extractCustomField(t, 'conta'),
                tipo_pagamento:   formData['tipo_de_pagamento'] || formData['tipo_pagamento']
                               || extractCustomField(t, 'tipo_de_pagamento')
                               || '-',
                contrato_medicao: formData['contrato_medicao']  || formData['contrato']
                               || extractCustomField(t, 'contrato_medicao')
                               || '-',
                agente:           agenteName,
                created_at:       t.created_at
            });

            await delay(150);
        }

        console.log(`\n\nProcessados: ${formattedTickets.length} | Ignorados: ${skipped}`);

        // 4. Ordenar por ID decrescente (mais recente primeiro)
        formattedTickets.sort((a, b) => b.id - a.id);

        // 5. Salvar JSON
        const outputData = {
            metadata: {
                lastSync:     new Date().toISOString(),
                totalRecords: formattedTickets.length,
                auditYear:    AUDIT_YEAR || 'todos',
                workspaceId:  WORKSPACE_ID,
                serviceItems: SERVICE_ITEM_IDS
            },
            tickets: formattedTickets
        };

        const outDir  = path.join(__dirname, '..', 'data');
        const outPath = path.join(outDir, 'tickets.json');

        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        fs.writeFileSync(outPath, JSON.stringify(outputData, null, 2), 'utf8');

        console.log(`\n✅ Sucesso! ${formattedTickets.length} tickets salvos em data/tickets.json`);
        console.log(`   Sync: ${outputData.metadata.lastSync}\n`);

    } catch (error) {
        console.error('\n❌ ERRO FATAL:', error.message);
        process.exit(1);
    }
}

main();
