require('dotenv').config();
const https = require('https');
const API_KEY = process.env.FRESHSERVICE_API_KEY.trim();
const DOMAIN = process.env.FRESHSERVICE_DOMAIN.trim();
const AUTH = 'Basic ' + Buffer.from(`${API_KEY}:X`).toString('base64');

function apiGet(p) {
    return new Promise((resolve) => {
        https.request({ hostname: DOMAIN, path: p, headers: { Authorization: AUTH } }, (res) => {
            let b = ''; res.on('data', d=>b+=d); res.on('end', ()=>resolve(JSON.parse(b)));
        }).end();
    });
}

async function run() {
    const r = await apiGet('/api/v2/tickets?per_page=5&include=attachments');
    if (r.tickets) {
        console.log('Tickets:', r.tickets.length);
        r.tickets.forEach(t => {
            console.log(`Ticket ${t.id} attachments:`, t.attachments ? t.attachments.length : 'none');
        });
    } else {
        console.log('Error:', r);
    }
}
run();
