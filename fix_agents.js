require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const DOMAIN = (process.env.FRESHSERVICE_DOMAIN || '').trim();
const API_KEY = (process.env.FRESHSERVICE_API_KEY || '').trim();
const CACHE_FILE = path.join(__dirname, 'data', 'tickets.json');

const AUTH_HEADER = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');

function apiGet(apiPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: DOMAIN,
            path: apiPath,
            method: 'GET',
            headers: { 'Authorization': AUTH_HEADER, 'Content-Type': 'application/json' },
            rejectUnauthorized: false
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) resolve(JSON.parse(body));
                else resolve(null);
            });
        });
        req.on('error', e => reject(e));
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    if (!fs.existsSync(CACHE_FILE)) {
        console.log('Arquivo tickets.json não encontrado.');
        return;
    }

    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const tickets = data.tickets || [];
    
    // Identificar agentes que estão como #ID
    const missingIds = new Set();
    tickets.forEach(t => {
        if (t.agente && (t.agente.startsWith('#') || t.agente.startsWith('Agente '))) {
            const id = t.agente.replace('#', '').replace('Agente ', '');
            missingIds.add(id);
        }
    });

    if (missingIds.size === 0) {
        console.log('Nenhum agente pendente de nome encontrado!');
        return;
    }

    console.log(`Encontrados ${missingIds.size} IDs de agentes sem nome. Buscando na API...`);

    let updatedCount = 0;
    const newAgentsMap = data.metadata.agents || {};

    for (const id of missingIds) {
        console.log(`Buscando agente ${id}...`);
        try {
            const res = await apiGet(`/api/v2/agents/${id}`);
            if (res && res.agent) {
                const fname = res.agent.first_name || '';
                const lname = res.agent.last_name || '';
                const name = (fname + ' ' + lname).trim() || `Agente ${id}`;
                newAgentsMap[id] = name;
                
                // Atualiza em todos os tickets que tem esse ID
                tickets.forEach(t => {
                    if (t.agente === `#${id}` || t.agente === `Agente ${id}`) {
                        t.agente = name;
                        updatedCount++;
                    }
                });
                console.log(` -> Nome encontrado: ${name}`);
            } else {
                console.log(` -> Não encontrado na API.`);
            }
        } catch (e) {
            console.log(` -> Erro ao buscar: ${e.message}`);
        }
        await sleep(500); // Pausa pra não sobrecarregar
    }

    if (updatedCount > 0) {
        data.metadata.agents = newAgentsMap;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log(`\nSucesso! ${updatedCount} tickets atualizados com o nome do agente.`);
        console.log('Agora é só atualizar (F5) o seu navegador!');
    } else {
        console.log('\nNenhum ticket foi alterado.');
    }
}

run();
