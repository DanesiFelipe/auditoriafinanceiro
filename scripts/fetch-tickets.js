/**
 * Trinus Audit — fetch-tickets.js
 * Script Node.js para buscar tickets da API do Freshservice e formatar para o frontend.
 * Roda via GitHub Actions.
 *
 * Configuração:
 *   FRESHSERVICE_DOMAIN  = trinus.freshservice.com
 *   FRESHSERVICE_API_KEY = <sua api key>
 *   WORKSPACE_ID         = 24
 *   SERVICE_ITEM_IDS     = 477,476  (itens do catálogo de pagamento)
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// =========================================
// CONFIGURAÇÃO (GitHub Secrets)
// =========================================
const DOMAIN      = process.env.FRESHSERVICE_DOMAIN;
const API_KEY     = process.env.FRESHSERVICE_API_KEY;
const WORKSPACE_ID = parseInt(process.env.WORKSPACE_ID || '24', 10);
const SERVICE_ITEM_IDS = (process.env.SERVICE_ITEM_IDS || '477,476')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);

// Filtro de período: ano passado por padrão (2025)
const YEAR_FILTER = parseInt(process.env.AUDIT_YEAR || String(new Date().getFullYear() - 1), 10);

if (!DOMAIN || !API_KEY) {
    console.error('ERRO: FRESHSERVICE_DOMAIN e FRESHSERVICE_API_KEY são obrigatórias.');
    process.exit(1);
}

const AUTH_TOKEN = Buffer.from(`${API_KEY}:X`).toString('base64');

console.log(`\n=== Trinus Audit — Fetch de Tickets ===`);
console.log(`Domínio:         ${DOMAIN}`);
console.log(`Workspace ID:    ${WORKSPACE_ID}`);
console.log(`Service Items:   ${SERVICE_ITEM_IDS.join(', ')}`);
console.log(`Ano de Auditoria: ${YEAR_FILTER}`);
console.log(`=======================================\n`);

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
                        reject(new Error(`Parse JSON error: ${e.message}`));
                    }
                } else if (res.statusCode === 429) {
                    reject(new Error(`Rate limit atingido (429). Tente novamente em alguns minutos.`));
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${data.substring(0, 200)}`));
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

// =========================================
// HELPER: Delay para rate limit
// =========================================
const delay = ms => new Promise(r => setTimeout(r, ms));

// =========================================
// HELPER: Extrair campo customizado
// =========================================
function extractCustomField(ticket, fieldName) {
    if (ticket.custom_fields && ticket.custom_fields[fieldName] !== undefined) {
        return ticket.custom_fields[fieldName];
    }
    return '-';
}

// =========================================
// BUSCAR TODOS OS TICKETS (paginação)
// =========================================
async function fetchAllTickets() {
    let allTickets = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        // Filtrar por workspace, tipo service request, e range de data (ano de auditoria)
        const startDate = `${YEAR_FILTER}-01-01T00:00:00Z`;
        const endDate   = `${YEAR_FILTER}-12-31T23:59:59Z`;

        // Usando filter query da API v2
        const query = encodeURIComponent(
            `workspace_id:${WORKSPACE_ID} AND type:Service Request AND created_at:>'${YEAR_FILTER}-01-01'`
        );

        const apiPath = `/api/v2/tickets?include=requester,stats&per_page=${perPage}&page=${page}&workspace_id=${WORKSPACE_ID}&type=Service Request`;

        console.log(`Buscando página ${page}...`);
        const response = await fetchAPI(apiPath);
        const tickets  = response.tickets || [];

        if (tickets.length === 0) break;

        // Filtrar pelo ano de auditoria (client-side fallback se a API não filtrar por data)
        const filtered = tickets.filter(t => {
            const created = new Date(t.created_at);
            return created.getFullYear() === YEAR_FILTER;
        });

        allTickets = allTickets.concat(filtered);
        console.log(`  → Página ${page}: ${tickets.length} tickets brutos, ${filtered.length} do ano ${YEAR_FILTER}`);

        // Se retornou menos que o máximo, não há mais páginas
        if (tickets.length < perPage) break;

        page++;
        await delay(300); // Respeitar rate limit
    }

    return allTickets;
}

// =========================================
// BUSCAR ITENS SOLICITADOS (form data)
// =========================================
async function fetchRequestedItems(ticketId) {
    try {
        const resp = await fetchAPI(`/api/v2/tickets/${ticketId}/requested_items`);
        return resp.requested_items || [];
    } catch (e) {
        console.warn(`  [!] Não foi possível carregar requested_items do ticket ${ticketId}: ${e.message}`);
        return [];
    }
}

// =========================================
// BUSCAR CACHE DE AGENTES
// =========================================
async function fetchAgentsCache() {
    const agentsMap = {};
    try {
        const resp = await fetchAPI('/api/v2/agents?per_page=100');
        const agents = resp.agents || [];
        agents.forEach(a => {
            agentsMap[a.id] = a.name || `Agente ${a.id}`;
        });
        console.log(`Cache de agentes: ${agents.length} agentes carregados.`);
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
        // 1. Carregar cache de agentes
        const agentsMap = await fetchAgentsCache();
        await delay(300);

        // 2. Buscar todos os tickets do workspace/ano
        const rawTickets = await fetchAllTickets();
        console.log(`\nTotal de tickets do ano ${YEAR_FILTER}: ${rawTickets.length}`);

        // 3. Processar cada ticket
        const formattedTickets = [];
        let processedCount = 0;

        for (const t of rawTickets) {
            processedCount++;

            // Buscar itens do formulário
            const reqItems = await fetchRequestedItems(t.id);
            let formData = {};
            let matchesServiceItem = false;

            // Verificar se algum item é dos IDs configurados (477, 476)
            for (const item of reqItems) {
                if (SERVICE_ITEM_IDS.includes(item.service_item_id)) {
                    matchesServiceItem = true;
                    if (item.custom_fields) {
                        formData = { ...formData, ...item.custom_fields };
                    }
                    break;
                }
            }

            // Se SERVICE_ITEM_IDS definido, filtrar apenas tickets com esses itens
            // Se o ticket não tem nenhum item do catálogo esperado, pular
            if (SERVICE_ITEM_IDS.length > 0 && reqItems.length > 0 && !matchesServiceItem) {
                continue;
            }

            const agenteName = t.responder_id
                ? (agentsMap[t.responder_id] || `Agente #${t.responder_id}`)
                : 'Não atribuído';

            // Determinar se tem documento/anexo
            const hasAttachment = t.attachments && t.attachments.length > 0;

            formattedTickets.push({
                id:               t.id,
                subject:          t.subject,
                status:           t.status,
                priority:         t.priority,
                source:           t.source,
                requester_email:  t.requester ? t.requester.email : '-',
                requester_name:   t.requester ? t.requester.name  : '-',
                empreendimento:   formData['empresa_empreendimento']
                               || formData['empreendimento']
                               || extractCustomField(t, 'empresa_empreendimento'),
                valor:            formData['valor']
                               || formData['value']
                               || extractCustomField(t, 'valor')
                               || 0,
                tempo_gasto:      0, // Expandir com time_entries se necessário
                tem_documento:    hasAttachment ? 'Sim' : 'Não',
                attachments:      (t.attachments || []).map(a => ({
                    name: a.name,
                    url:  a.attachment_url
                })),
                banco:            formData['banco']            || extractCustomField(t, 'banco'),
                agencia:          formData['agencia']          || extractCustomField(t, 'agencia'),
                conta:            formData['conta']            || extractCustomField(t, 'conta'),
                tipo_pagamento:   formData['tipo_de_pagamento']|| formData['tipo_pagamento']
                               || extractCustomField(t, 'tipo_de_pagamento'),
                contrato_medicao: formData['contrato_medicao'] || formData['contrato']
                               || extractCustomField(t, 'contrato_medicao'),
                agente:           agenteName,
                created_at:       t.created_at
            });

            console.log(`  [${processedCount}/${rawTickets.length}] Ticket #${t.id} processado`);

            // Pausa para evitar rate limit (200ms entre requests)
            await delay(200);
        }

        // 4. Ordenar por ID decrescente
        formattedTickets.sort((a, b) => b.id - a.id);

        // 5. Salvar JSON
        const outputData = {
            metadata: {
                lastSync:     new Date().toISOString(),
                totalRecords: formattedTickets.length,
                auditYear:    YEAR_FILTER,
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

        console.log(`\n✅ Sucesso! ${formattedTickets.length} tickets salvos em ${outPath}`);
        console.log(`   Ano de auditoria: ${YEAR_FILTER}`);
        console.log(`   Última sincronização: ${outputData.metadata.lastSync}\n`);

    } catch (error) {
        console.error('\n❌ ERRO FATAL:', error.message);
        process.exit(1);
    }
}

main();
