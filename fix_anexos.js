const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data', 'tickets.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let updated = 0;
data.tickets.forEach(t => {
    const allAttachments = [];
    
    // Anexos do ticket original (se houver no cache, mas provavelmente nao tem porque antes nao baixava o full ticket)
    if (t.attachments && t.attachments.length) {
        // Se ja tiver url, eh porque ja foi mapeado
        if (t.attachments[0].url) {
            t.attachments.forEach(a => allAttachments.push(a));
        }
    }

    // Anexos das conversas
    if (t.conversations) {
        t.conversations.forEach(c => {
            if (c.attachments) {
                c.attachments.forEach(a => {
                    // Evitar duplicados pelo nome ou URL
                    if (!allAttachments.some(existing => existing.name === a.name)) {
                        allAttachments.push({ name: a.name, url: a.attachment_url || a.url || '#' });
                    }
                });
            }
        });
    }

    if (allAttachments.length > 0) {
        t.attachments = allAttachments;
        t.tem_documento = 'Sim';
        updated++;
    } else {
        t.attachments = [];
        t.tem_documento = 'Nao';
    }
});

fs.writeFileSync(file, JSON.stringify(data, null, 2));
console.log(`Atualizado anexos em ${updated} tickets.`);
