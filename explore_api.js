require('dotenv').config();
const https = require('https');

const DOMAIN  = (process.env.FRESHSERVICE_DOMAIN || '').trim();
const API_KEY = (process.env.FRESHSERVICE_API_KEY || '').trim();
const AUTH    = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');
const BO_ID   = '24000020096';

function apiGet(p) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { hostname: DOMAIN, path: p, method: 'GET', headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' }, rejectUnauthorized: false },
            (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve(res.statusCode === 200 ? JSON.parse(b) : null)); }
        );
        req.on('error', reject);
        req.end();
    });
}

async function run() {
    // Ver estrutura completa de um record (não só o .data)
    const p1 = await apiGet(`/api/v2/objects/${BO_ID}/records?per_page=5&page=1`);
    console.log('Chaves do record:', Object.keys(p1?.records?.[0] || {}));
    console.log('\nPrimeiro record completo:');
    console.log(JSON.stringify(p1?.records?.[0], null, 2));
}
run();
