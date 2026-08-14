require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data', 'tickets.json');
const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const tickets = data.tickets || [];

// Ver todos os valores únicos do campo "agente"
const counts = {};
tickets.forEach(t => {
    const a = t.agente || '(vazio)';
    counts[a] = (counts[a] || 0) + 1;
});

console.log('\n=== Valores únicos do campo "agente" ===\n');
Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([nome, qty]) => console.log(`${qty.toString().padStart(5)} x  "${nome}"`));
