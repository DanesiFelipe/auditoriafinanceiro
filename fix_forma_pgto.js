const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data', 'tickets.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let updated = 0;
data.tickets.forEach(t => {
    if (t.form_data) {
        let forma = t.form_data['forma_de_pagamento'] || t.form_data['forma_pagamento'] || '-';
        t.forma_pagamento = forma;
        updated++;
    }
});

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`Atualizado forma_pagamento em ${updated} tickets.`);
