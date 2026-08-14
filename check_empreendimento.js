require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data', 'tickets.json');
const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const tickets = data.tickets || [];

// Ver amostra dos primeiros valores de empreendimento e form_data
console.log('\n=== Primeiros 20 valores de "empreendimento" ===\n');
tickets.slice(0, 20).forEach(t => {
    console.log(`#${t.id} | empreendimento: "${t.empreendimento}"`);
    if (t.form_data && Object.keys(t.form_data).length > 0) {
        const keys = Object.keys(t.form_data).filter(k =>
            k.includes('empresa') || k.includes('empreend') || k.includes('department') || k.includes('company')
        );
        if (keys.length) console.log(`       form_data keys: ${keys.map(k => `${k}="${t.form_data[k]}"`).join(', ')}`);
    }
});

// Contar valores únicos que parecem IDs (numéricos)
const counts = {};
tickets.forEach(t => {
    const v = t.empreendimento || '(vazio)';
    counts[v] = (counts[v] || 0) + 1;
});

console.log('\n=== Top 30 valores únicos de "empreendimento" ===\n');
Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([v, n]) => console.log(`${n.toString().padStart(5)} x  "${v}"`));
