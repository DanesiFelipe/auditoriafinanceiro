/**
 * Trinus Audit v2 — scripts/login.js
 * Autenticação via API local do servidor Node.js.
 */

const API_BASE = 'http://127.0.0.1:5000';

const loginOverlay = document.getElementById('login-overlay');
const loginForm    = document.getElementById('login-form');
const loginError   = document.getElementById('login-error');
const loginBtn     = document.getElementById('login-btn');
const mainApp      = document.getElementById('main-app');

function unlockApp() {
    loginOverlay.style.display = 'none';
    mainApp.style.display = 'flex';
    // Disparar carregamento de dados
    if (typeof loadData === 'function') loadData();
    if (typeof initApp === 'function') initApp();
}

function showLoginError(msg) {
    loginError.textContent = msg;
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="ph ph-sign-in"></i> Entrar';
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
}

// Verificar se já estava logado (sessão ativa)
if (sessionStorage.getItem('trinus_auth') === 'true') {
    unlockApp();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i> Verificando...';
    loginError.textContent = '';

    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const resp = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await resp.json();

        if (resp.ok && data.status === 'success') {
            sessionStorage.setItem('trinus_auth', 'true');
            sessionStorage.setItem('trinus_role', data.role || 'user');
            sessionStorage.setItem('trinus_user', username);
            unlockApp();
        } else {
            showLoginError(data.message || 'Usuário ou senha incorretos.');
        }
    } catch {
        // Fallback: Modo estático (GitHub Pages) lê direto do arquivo JSON
        try {
            console.warn('Servidor Node.js não encontrado. Usando autenticação estática de fallback...');
            const fallbackResp = await fetch('data/users.json');
            if (!fallbackResp.ok) throw new Error();
            const usersObj = await fallbackResp.json();
            
            // Fazer o hash da senha usando Web Crypto API
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const passHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const userEntry = usersObj[username];
            if (userEntry && userEntry.hash === passHash) {
                sessionStorage.setItem('trinus_auth', 'true');
                sessionStorage.setItem('trinus_role', userEntry.role || 'user');
                sessionStorage.setItem('trinus_user', username);
                unlockApp();
            } else {
                showLoginError('Usuário ou senha incorretos.');
            }
        } catch (e) {
            console.error(e);
            showLoginError('Servidor indisponível e erro ao carregar fallback estático.');
        }
    }
});

// Expor para uso externo
window.API_BASE = API_BASE;
