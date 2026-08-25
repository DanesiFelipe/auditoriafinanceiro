require('dotenv').config({ path: 'C:/Users/felipe.danesi/OneDrive - TRINUS CO. PARTICIPACOES S.A/Documentos/prohetos/freshservice-auditoria-v2/.env' });
const fs = require('fs');
const https = require('https');
const path = require('path');

const DOMAIN = process.env.FRESHSERVICE_DOMAIN.trim();
const API_KEY = process.env.FRESHSERVICE_API_KEY.trim();
const AUTH_HEADER = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');
const WORKSPACE_ID = process.env.WORKSPACE_ID || '24';
const TARGET_IDS = [477, 476];

const ticketsPath = 'C:/Users/felipe.danesi/OneDrive - TRINUS CO. PARTICIPACOES S.A/Documentos/prohetos/freshservice-auditoria-v2/data/tickets.json';
const idsPath = 'C:/Users/felipe.danesi/.gemini/antigravity-ide/brain/031908b0-c707-4f4e-b6aa-cf49376833e1/scratch/missing_ids_3.txt';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(apiPath) {
    let retries = 3;
    for (let i = 0; i < retries; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: DOMAIN,
                    path: apiPath,
                    method: 'GET',
                    headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' }
                }, res => {
                    if (res.statusCode === 404) return resolve(null);
                    let body = '';
                    res.on('data', d => body += d);
                    res.on('end', () => {
                        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                        resolve(JSON.parse(body));
                    });
                });
                req.on('error', reject);
                req.end();
            });
        } catch (err) {
            if (i === retries - 1) throw err;
            await sleep(2000);
        }
    }
}

function cf(obj, ...keys) {
    if (!obj) return '-';
    for (const k of keys) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]);
    }
    return '-';
}

async function run() {
    const rawIds = fs.readFileSync(idsPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const ids = rawIds.map(id => parseInt(id.replace('REQ-', ''))).filter(n => !isNaN(n));
    console.log(`Buscando ${ids.length} tickets faltantes...`);

    const cache = require(ticketsPath);
    const agentsMap = cache.metadata?.agents || {};
    const ticketsMap = new Map();
    cache.tickets.forEach(t => ticketsMap.set(t.id, t));

    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (ticketsMap.has(id)) {
            // console.log(`[${i+1}/${ids.length}] #${id} ja na base. Pulando...`);
            continue;
        }
        console.log(`[${i+1}/${ids.length}] Buscando #${id}...`);
        try {
            const ticketData = await apiGet(`/api/v2/tickets/${id}?include=requester,stats`);
            if (!ticketData || !ticketData.ticket) {
                console.log(`  [X] #${id} nao encontrado.`);
                continue;
            }
            const t = ticketData.ticket;
            
            // Requisicoes e Conversas
            const reqData = await apiGet(`/api/v2/tickets/${t.id}/requested_items`);
            const reqItems = reqData?.requested_items || [];
            const matching = reqItems.filter(item => TARGET_IDS.includes(item.service_item_id));

            if (!matching.length) {
                console.log(`  [!] #${id} nao eh solicitacao de pagamento.`);
                await sleep(1200);
                continue;
            }

            const convData = await apiGet(`/api/v2/tickets/${t.id}/conversations`);
            const conversations = convData?.conversations || [];

            // Extrair form data
            const formData = {};
            matching.forEach(item => { if (item.custom_fields) Object.assign(formData, item.custom_fields); });

            const serviceNames = matching.map(item => {
                if (item.service_item_id === 477) return 'Solicitacao de Pagamento';
                if (item.service_item_id === 476) return 'Solicitacao de Pagamento Especial';
                return `Item ${item.service_item_id}`;
            });

            const agentName = t.responder_id ? (agentsMap[t.responder_id] || `#${t.responder_id}`) : 'Nao atribuido';

            let valor = 0;
            try {
                const vs = cf(formData, 'valor', 'value', 'montante').replace(',', '.');
                valor = vs !== '-' ? parseFloat(vs) || 0 : 0;
            } catch (_) {}

            const allAttachments = [];
            if (t.attachments) t.attachments.forEach(a => allAttachments.push({ name: a.name, url: a.attachment_url || a.url || '#' }));
            conversations.forEach(c => {
                if (c.attachments) c.attachments.forEach(a => allAttachments.push({ name: a.name, url: a.attachment_url || a.url || '#' }));
            });

            let tempoGasto = '0h';
            if (t.stats && t.stats.resolution_time_in_secs) {
                const secs = t.stats.resolution_time_in_secs;
                const hrs = Math.floor(secs / 3600);
                const mins = Math.floor((secs % 3600) / 60);
                if (hrs > 0 && mins > 0) tempoGasto = `${hrs}h ${mins}m`;
                else if (hrs > 0) tempoGasto = `${hrs}h`;
                else if (mins > 0) tempoGasto = `${mins}m`;
            }

            const parsed = {
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
            };

            ticketsMap.set(parsed.id, parsed);
            console.log(`  [OK] Inserido #${parsed.id}`);
            
            await sleep(1200); // Respect limits
        } catch (e) {
            console.error(`  [ERRO] #${id}: ${e.message}`);
        }
    }

    cache.tickets = Array.from(ticketsMap.values()).sort((a,b) => b.id - a.id);
    fs.writeFileSync(ticketsPath, JSON.stringify(cache, null, 2), 'utf8');
    console.log(`\nFinalizado. Total de tickets agora: ${cache.tickets.length}`);
}
run();
