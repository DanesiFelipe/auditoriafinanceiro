const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tickets.json'), 'utf8'));

console.log('=== Checking Forma de Pagamento keys ===');
let found = 0;
data.tickets.forEach(t => {
    if (found >= 5) return;
    if (t.form_data) {
        const keys = Object.keys(t.form_data);
        const pt = keys.filter(k => k.includes('pagamento') || k.includes('forma'));
        if (pt.length > 0) {
            console.log(`Ticket ${t.id}:`);
            pt.forEach(k => console.log(`  ${k} = ${t.form_data[k]}`));
            found++;
        }
    }
});

console.log('\n=== Checking Attachments ===');
found = 0;
data.tickets.forEach(t => {
    if (found >= 5) return;
    // t.attachments in cache? No, t.attachments comes from API but let's check what's in cache
    if (t.attachments && t.attachments.length > 0) {
        console.log(`Ticket ${t.id} has attachments:`, t.attachments);
        found++;
    }
});
