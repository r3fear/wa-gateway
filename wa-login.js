'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

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
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const SESSION_DEFAULT_DIR = path.join(AUTH_DIR, 'session-' + SESSION_ID, 'Default');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

function killChrome() {
    try {
        execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    } catch (_) {}
}

function waitSeconds(n) {
    try {
        execSync('ping -n ' + (n + 1) + ' 127.0.0.1', { stdio: 'ignore' });
    } catch (_) {}
}

function cleanupLockFiles() {
    const sessionDir = path.join(AUTH_DIR, 'session-' + SESSION_ID);
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
    for (const fname of lockFiles) {
        const fpath = path.join(sessionDir, fname);
        try {
            if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
        } catch (_) {}
    }
}

function deleteSessionDir() {
    const sessionDir = path.join(AUTH_DIR, 'session-' + SESSION_ID);
    try {
        // rd /s /q es necesario en Windows para eliminar perfiles Chrome correctamente
        // fs.rmSync con recursive falla en algunos archivos de perfil Chrome en Windows
        execSync('rd /s /q "' + sessionDir + '"', { stdio: 'ignore' });
        console.log('Sesion anterior eliminada.');
    } catch (err) {
        console.error('Advertencia: no se pudo eliminar directorio de sesion: ' + err.message);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('');
    console.log('=================================================');
    console.log('  wa-gateway - Configuracion de sesion WhatsApp  ');
    console.log('=================================================');
    console.log('Session ID: ' + SESSION_ID);
    console.log('');

    // Verificar si existe sesion previa
    if (fs.existsSync(SESSION_DEFAULT_DIR)) {
        console.log('Se encontro una sesion activa en:');
        console.log('  ' + SESSION_DEFAULT_DIR);
        console.log('');

        const answer = await ask('Desea iniciar nueva sesion? [s/n]: ');

        if (answer !== 's') {
            console.log('Operacion cancelada. La sesion existente se mantiene.');
            process.exit(0);
        }

        console.log('');
        console.log('Eliminando sesion anterior...');
        killChrome();
        waitSeconds(2);
        deleteSessionDir();
        console.log('');
    }

    // Limpiar lock files y procesos antes de iniciar
    console.log('Preparando entorno...');
    killChrome();
    waitSeconds(2);
    cleanupLockFiles();

    // Configurar cliente
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
        authStrategy: new LocalAuth({
            clientId: SESSION_ID,
            dataPath: AUTH_DIR,
        }),
        puppeteer: {
            headless: true,
            args: puppeteerArgs,
        },
    };

    if (CHROME_PATH) {
        clientOpts.puppeteer.executablePath = CHROME_PATH;
    }

    const client = new Client(clientOpts);

    client.on('qr', (qr) => {
        console.log('');
        console.log('Escanea este codigo QR con WhatsApp en tu telefono:');
        console.log('(WhatsApp > Menu > Dispositivos vinculados > Vincular dispositivo)');
        console.log('');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        console.log('');
        console.log('=================================================');
        console.log('  Sesion configurada exitosamente!               ');
        console.log('  WhatsApp conectado y listo.                    ');
        console.log('=================================================');
        console.log('');
        console.log('Ahora puedes iniciar wa-server.js como servicio.');
        console.log('');

        try {
            await client.destroy();
        } catch (_) {}

        process.exit(0);
    });

    client.on('auth_failure', (msg) => {
        console.error('');
        console.error('ERROR: Fallo de autenticacion: ' + msg);
        console.error('Intenta correr wa-login.js nuevamente.');
        process.exit(1);
    });

    console.log('Iniciando cliente WhatsApp, espera el codigo QR...');
    console.log('');

    client.initialize();
}

main().catch((err) => {
    console.error('Error inesperado: ' + err.message);
    process.exit(1);
});
