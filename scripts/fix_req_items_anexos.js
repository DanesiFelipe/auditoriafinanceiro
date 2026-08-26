require('dotenv').config({ path: 'C:/Users/felipe.danesi/OneDrive - TRINUS CO. PARTICIPACOES S.A/Documentos/prohetos/freshservice-auditoria-v2/.env' });
const fs = require('fs');
const https = require('https');
const path = require('path');

const DOMAIN = process.env.FRESHSERVICE_DOMAIN.trim();
const API_KEY = process.env.FRESHSERVICE_API_KEY.trim();
const AUTH_HEADER = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');
const TARGET_IDS = [477, 476]; // Solicitacao de pagamento

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(apiPath) {
    let retries = 3;
    for (let i = 0; i < retries; i++) {
        try {
            return await new Promise((resolve, reject) => {
                const options = {
                    hostname: DOMAIN,
                    path: apiPath,
                    method: 'GET',
                    headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' }
                };
                const req = https.request(options, res => {
                    if (res.statusCode === 404) return resolve(null);
                    if (res.statusCode === 429) {
                        const retryAfter = (parseInt(res.headers['retry-after']) || 1) * 1000;
                        return reject(new Error(`HTTP 429: Rate limit (retry-after ${retryAfter}ms)`));
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
                    });
                });
                req.on('error', reject);
                req.end();
            });
        } catch (e) {
            if (e.message.includes('429')) {
                const waitTime = parseInt(e.message.match(/\d+ms/)?.[0] || '2000');
                console.log(`  Rate limit atingido. Aguardando ${waitTime}ms...`);
                await sleep(waitTime);
            } else if (i === retries - 1) {
                console.error(`  Falha na requisição: ${e.message}`);
                return null;
            } else {
                await sleep(1000);
            }
        }
    }
}

async function run() {
    const filePath = 'C:/Users/felipe.danesi/OneDrive - TRINUS CO. PARTICIPACOES S.A/Documentos/prohetos/freshservice-auditoria-v2/data/tickets.json';
    const data = require(filePath);
    let updated = 0;

    const ticketsToFix = data.tickets; // varrer todos os tickets conforme pedido
    console.log(`Verificando attachments em requested_items para TODOS os ${ticketsToFix.length} tickets...`);

    for (let i = 0; i < ticketsToFix.length; i++) {
        const t = ticketsToFix[i];
        
        const reqData = await apiGet(`/api/v2/tickets/${t.id}/requested_items`);
        const reqItems = reqData?.requested_items || [];
        const matching = reqItems.filter(item => TARGET_IDS.includes(item.service_item_id));

        let found = false;
        const allAttachments = t.attachments || [];

        matching.forEach(item => {
            if (item.attachments) {
                item.attachments.forEach(a => {
                    const newAtt = { name: a.name, url: a.attachment_url || a.url || '#' };
                    if (!allAttachments.some(ex => ex.name === newAtt.name)) {
                        allAttachments.push(newAtt);
                        found = true;
                    }
                });
            }
        });

        if (found) {
            t.attachments = allAttachments;
            t.tem_documento = 'Sim';
            updated++;
            console.log(`[${i+1}/${ticketsToFix.length}] Ticket #${t.id} -> Anexos encontrados!`);
        } else {
            console.log(`[${i+1}/${ticketsToFix.length}] Ticket #${t.id} -> Nenhum anexo encontrado.`);
        }

        if (i > 0 && i % 200 === 0) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`Salvamento intermediario realizado.`);
        }

        await sleep(300); // Para nao estourar a API (max ~3 req/s)
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`\nFinalizado. ${updated} tickets atualizados com anexos.`);
}

run();
