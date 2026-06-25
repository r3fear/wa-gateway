'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const { Client, LocalAuth } = require('whatsapp-web.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
    console.error('ERROR: No se pudo leer config.json: ' + err.message);
    process.exit(1);
}

const SESSION_ID = config.session_id || 'wa-gateway';
const CHROME_PATH = config.chrome_path || '';
const PORT = config.port || 3000;
const HOST = config.host === '0.0.0.0' ? '127.0.0.1' : (config.host || '127.0.0.1');
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const SESSION_DEFAULT_DIR = path.join(AUTH_DIR, 'session-' + SESSION_ID, 'Default');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad(str, len) {
    const s = String(str);
    if (s.length >= len) return s.substring(0, len - 3) + '...';
    return s + ' '.repeat(len - s.length);
}

function printGroups(groups) {
    if (groups.length === 0) {
        console.log('No se encontraron grupos en esta sesion.');
    } else {
        console.log('Grupos encontrados: ' + groups.length);
        console.log('');
        console.log(pad('Nombre del grupo', 45) + '  ID (usar en POST /send)');
        console.log('-'.repeat(90));
        for (const g of groups) {
            console.log(pad(g.name, 45) + '  ' + g.id);
        }
    }
    console.log('');
}

// ---------------------------------------------------------------------------
// Intentar obtener grupos del servicio en ejecucion
// ---------------------------------------------------------------------------

function queryService() {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { hostname: HOST, port: PORT, path: '/groups', timeout: 4000 },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            }
        );
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Obtener grupos via Chrome (servicio detenido)
// ---------------------------------------------------------------------------

function queryViaPuppeteer() {
    if (!fs.existsSync(SESSION_DEFAULT_DIR)) {
        console.error('ERROR: No hay sesion activa.');
        console.error('Ejecuta la opcion 1 del menu para autenticar primero.');
        process.exit(1);
    }

    const puppeteerArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
    ];

    const clientOpts = {
        authStrategy: new LocalAuth({ clientId: SESSION_ID, dataPath: AUTH_DIR }),
        puppeteer: { headless: true, args: puppeteerArgs },
    };

    if (CHROME_PATH) clientOpts.puppeteer.executablePath = CHROME_PATH;

    const client = new Client(clientOpts);

    process.on('uncaughtException', (err) => {
        if (err.message && err.message.includes('Execution context was destroyed')) return;
        console.error('\nError inesperado: ' + err.message);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        if (msg.includes('Execution context was destroyed') || msg.includes('EBUSY')) return;
        console.error('\nError inesperado: ' + msg);
        process.exit(1);
    });

    const watchdog = setTimeout(() => {
        console.error('\nERROR: Tiempo de espera agotado (90s). Verifica que Chrome puede abrirse.');
        process.exit(1);
    }, 90000);

    console.log('Conectando a WhatsApp directamente...');
    console.log('(Esto puede tardar unos segundos)');
    console.log('');

    client.on('qr', () => {
        clearTimeout(watchdog);
        console.error('ERROR: La sesion expiro. Ejecuta la opcion 1 para reautenticar.');
        process.exit(1);
    });

    client.on('ready', async () => {
        clearTimeout(watchdog);
        try {
            const chats = await client.getChats();
            const groups = chats
                .filter((c) => c.isGroup)
                .map((c) => ({ name: c.name, id: c.id._serialized }));
            printGroups(groups);
        } catch (err) {
            console.error('ERROR obteniendo grupos: ' + err.message);
        }
        try { await client.destroy(); } catch (_) {}
        process.exit(0);
    });

    client.on('auth_failure', (msg) => {
        clearTimeout(watchdog);
        console.error('ERROR: Fallo de autenticacion: ' + msg);
        process.exit(1);
    });

    client.initialize().catch((err) => {
        if (!err.message || !err.message.includes('Execution context was destroyed')) {
            clearTimeout(watchdog);
            console.error('\nERROR al inicializar WhatsApp: ' + err.message);
            process.exit(1);
        }
    });
}

// ---------------------------------------------------------------------------
// Main: probar servicio primero, fallback a Puppeteer
// ---------------------------------------------------------------------------

console.log('');

queryService().then((result) => {
    if (result.ok) {
        console.log('(Obtenido del servicio wa-gateway en http://' + HOST + ':' + PORT + ')');
        console.log('');
        printGroups(result.groups);
        process.exit(0);
    } else {
        console.error('El servicio respondio con error: ' + result.error);
        process.exit(1);
    }
}).catch(() => {
    // Servicio no disponible — usar Chrome directamente
    queryViaPuppeteer();
});
