/**
 * Script Node.js para buscar tickets da API do Freshservice e formatar para o frontend.
 * Deve ser rodado pelo GitHub Actions.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configurações (Vêm dos Secrets do GitHub)
const DOMAIN = process.env.FRESHSERVICE_DOMAIN; // ex: trinus.freshservice.com
const API_KEY = process.env.FRESHSERVICE_API_KEY; // A key pura
const WORKSPACE_ID = process.env.WORKSPACE_ID; // Se for para filtrar por workspace específico

if (!DOMAIN || !API_KEY) {
    console.error("ERRO: Variáveis de ambiente FRESHSERVICE_DOMAIN e FRESHSERVICE_API_KEY são obrigatórias.");
    process.exit(1);
}

// O Freshservice requer Basic Auth onde o username é a API KEY e o password é "X"
const AUTH_TOKEN = Buffer.from(`${API_KEY}:X`).toString('base64');

// Variáveis para configuração de filtros da API (ex: apenas tickets abertos/pendentes/resolvidos/fechados)
// Service Item IDs (Solicitação de Pagamento, Pagamento Especial) - Seria ideal filtrar por isso
const SERVICE_ITEM_IDS = process.env.SERVICE_ITEM_IDS ? process.env.SERVICE_ITEM_IDS.split(',') : null;

// Função Helper para requisições HTTPS
function fetchAPI(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: DOMAIN,
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Basic ${AUTH_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error("Erro ao dar parse no JSON: " + e.message));
                    }
                } else {
                    reject(new Error(`API Error: ${res.statusCode} - ${data}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

// Mapeamento de campos customizados (Ajustar de acordo com o Freshservice real)
function extractCustomField(ticket, fieldName) {
    if (ticket.custom_fields && ticket.custom_fields[fieldName] !== undefined) {
        return ticket.custom_fields[fieldName];
    }
    return "-";
}

async function main() {
    console.log("Iniciando busca de tickets no Freshservice...");
    
    try {
        // Passo 1: Buscar Tickets
        // Monta a query. Idealmente buscar os service items corretos.
        // Como o Freshservice v2 limita paginação e filtros complexos, vamos buscar os mais recentes de service requests
        
        let url = '/api/v2/tickets?include=requester,stats&per_page=100'; // Ajustar filtros conforme necessário
        if (WORKSPACE_ID) {
            url += `&workspace_id=${WORKSPACE_ID}`;
        }
        
        // Pode ser necessário usar a API de /tickets/filter se a query for complexa
        // url = `/api/v2/tickets/filter?query="workspace_id:${WORKSPACE_ID}"` (API V2 filter query syntax)
        
        console.log(`Fazendo request para: ${url}`);
        const response = await fetchAPI(url);
        const rawTickets = response.tickets || [];
        
        console.log(`${rawTickets.length} tickets encontrados.`);

        // Passo 2: Formatar e buscar detalhes extras se necessário (anexos do service request)
        // OBS: Service Requests tem itens requeridos que ficam no endpoint /api/v2/tickets/[id]/requested_items
        const formattedTickets = [];
        
        for (const t of rawTickets) {
            // Verifica se é um request (ticket type = 2)
            if (t.type !== 2 && t.type !== 'Service Request') continue;

            // Busca os campos do formulário do Service Request (Isso gasta 1 call da API por ticket)
            // Se houver muitos tickets, isso pode dar rate limit.
            let reqItems = [];
            try {
                const reqItemResponse = await fetchAPI(`/api/v2/tickets/${t.id}/requested_items`);
                reqItems = reqItemResponse.requested_items || [];
            } catch (e) {
                console.warn(`Aviso: Não foi possível carregar requested_items para ticket ${t.id}`);
            }

            // O form_data geralmente fica dentro do primeiro item solicitado
            let formData = {};
            if (reqItems.length > 0 && reqItems[0].custom_fields) {
                formData = reqItems[0].custom_fields;
            }

            // Mapeia as colunas baseadas nos dados do formulário e do ticket
            // IMPORTANTE: Os nomes das chaves do formData dependem de como estão configurados no seu catálogo.
            
            formattedTickets.push({
                id: t.id,
                subject: t.subject,
                status: t.status,
                priority: t.priority,
                source: t.source,
                requester_email: t.requester ? t.requester.email : "-",
                requester_name: t.requester ? t.requester.name : "-",
                empreendimento: formData['empresa_empreendimento'] || extractCustomField(t, 'empresa_empreendimento'),
                valor: formData['valor'] || extractCustomField(t, 'valor') || 0,
                tempo_gasto: 0, // Precisaria buscar os time_entries ou pegar do campo customizado
                tem_documento: t.attachments && t.attachments.length > 0 ? "Sim" : "Não",
                attachments: (t.attachments || []).map(a => ({
                    name: a.name,
                    url: a.attachment_url
                })),
                banco: formData['banco'] || extractCustomField(t, 'banco'),
                agencia: formData['agencia'] || extractCustomField(t, 'agencia'),
                conta: formData['conta'] || extractCustomField(t, 'conta'),
                tipo_pagamento: formData['tipo_de_pagamento'] || extractCustomField(t, 'tipo_de_pagamento'),
                contrato_medicao: formData['contrato_medicao'] || extractCustomField(t, 'contrato_medicao'),
                agente: t.responder_id ? `Agente ${t.responder_id}` : "Não atribuído", // Idealmente teríamos cache dos agentes
                created_at: t.created_at
            });
            
            // Pausa pequena para evitar rate limit (opcional, depende do volume)
            await new Promise(r => setTimeout(r, 200));
        }

        // Passo 3: Salvar o JSON
        const outputData = {
            metadata: {
                lastSync: new Date().toISOString(),
                totalRecords: formattedTickets.length
            },
            tickets: formattedTickets
        };

        const outPath = path.join(__dirname, '..', 'data', 'tickets.json');
        fs.writeFileSync(outPath, JSON.stringify(outputData, null, 2));
        
        console.log(`Sucesso! ${formattedTickets.length} tickets salvos em ${outPath}`);

    } catch (error) {
        console.error("ERRO FATAL:", error);
        process.exit(1);
    }
}

main();
