require('dotenv').config();
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DOMAIN     = (process.env.FRESHSERVICE_DOMAIN || '').trim();
const API_KEY    = (process.env.FRESHSERVICE_API_KEY || '').trim();
const AUTH       = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');
const CACHE_FILE = path.join(__dirname, 'data', 'tickets.json');
const BO_ID      = '24000020096';

function apiGetRaw(p) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: DOMAIN, path: p, method: 'GET', headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' }, rejectUnauthorized: false },
            (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); }
        );
        req.on('error', reject);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    // Tentar todas as combinações de sort para pegar IDs 118-140
    const sorts = [
        'sort_by=bo_created_at&sort_order=asc',
        'sort_by=bo_created_at&sort_order=desc',
        'sort_by=bo_updated_at&sort_order=asc',
        'sort_by=bo_updated_at&sort_order=desc',
        '', // sem sort
    ];

    const allFound = {};

    for (const sort of sorts) {
        const qs = sort ? `per_page=100&${sort}` : 'per_page=100';
        const url = `/api/v2/objects/${BO_ID}/records?${qs}`;
        console.log(`\nGET ${url}`);
        const r = await apiGetRaw(url);
        if (r.status !== 200) { console.log('Status:', r.status); continue; }
        const records = JSON.parse(r.body)?.records || [];
        const ids = records.map(rec => rec.data?.bo_display_id).filter(Boolean);
        const range = ids.length ? `${Math.min(...ids)}..${Math.max(...ids)}` : 'vazio';
        console.log(`  ${records.length} registros. IDs: ${range}`);

        // Procurar os 118-140
        const target = records.filter(rec => {
            const id = rec.data?.bo_display_id;
            return id >= 118 && id <= 140;
        });
        if (target.length) {
            console.log(`  ✅ ${target.length} IDs alvo encontrados!`);
            target.forEach(rec => {
                allFound[String(rec.data.bo_display_id)] = rec.data.empreendimentos;
            });
        }

        await sleep(600);
    }

    console.log(`\nEncontrados: ${JSON.stringify(allFound, null, 2)}`);

    if (Object.keys(allFound).length > 0) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        let updated = 0;
        data.tickets.forEach(t => {
            const id = String(t.empreendimento || '');
            if (allFound[id]) { t.empreendimento = allFound[id]; updated++; }
        });
        data.metadata.empresaMap = { ...data.metadata.empresaMap, ...allFound };
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
        console.log(`\nSucesso! ${updated} tickets atualizados.`);
    }
}

run();
