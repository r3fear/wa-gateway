'use strict';

const http = require('http');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

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

const PORT = config.port || 3000;
const HOST = config.host === '0.0.0.0' ? '127.0.0.1' : (config.host || '127.0.0.1');
const BASE_URL = 'http://' + HOST + ':' + PORT;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGet(endpoint) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { hostname: HOST, port: PORT, path: endpoint, timeout: 5000 },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('Respuesta invalida del servicio')); }
                });
            }
        );
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}

function httpPost(endpoint, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const options = {
            hostname: HOST,
            port: PORT,
            path: endpoint,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
            timeout: 10000,
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Respuesta invalida del servicio')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(rl, question) {
    return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function pad(str, len) {
    const s = String(str || '');
    if (s.length >= len) return s.substring(0, len - 3) + '...';
    return s + ' '.repeat(len - s.length);
}

function fmtTimestamp(ts) {
    return new Date(ts * 1000).toLocaleString('es-MX', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

function separator() {
    console.log('  ' + '-'.repeat(70));
}

// ---------------------------------------------------------------------------
// Acciones de prueba
// ---------------------------------------------------------------------------

async function testHealth() {
    console.log('  Estado del servicio (health)');
    separator();

    try {
        const h = await httpGet('/health');
        if (!h.ok) { console.log('  ERROR: ' + h.error + '\n'); return; }

        const uptime = h.uptime_seconds;
        const hh = String(Math.floor(uptime / 3600)).padStart(2, '0');
        const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0');
        const ss = String(uptime % 60).padStart(2, '0');

        console.log('  WhatsApp conectado:  ' + (h.connected ? 'Si' : 'NO'));
        console.log('  Session ID:          ' + h.session_id);
        console.log('  Uptime:              ' + hh + ':' + mm + ':' + ss + '  (' + uptime + 's)');
        console.log('  Mensajes en inbox:   ' + h.inbox_size);
        console.log('  Webhooks activos:    ' + h.subscribers);
        if (h.consumers && h.consumers.length > 0) {
            console.log('  Consumers:           ' + h.consumers.length);
            for (const c of h.consumers) {
                console.log('    - ' + c.name + ':  ' + c.queued + ' mensaje(s) en cola');
            }
        } else {
            console.log('  Consumers:           ninguno (usando inbox global)');
        }
    } catch (err) {
        console.log('  ERROR de conexion: ' + err.message);
    }
    console.log('');
}

async function testSend(rl) {
    console.log('  Enviar mensaje de prueba');
    separator();
    console.log('  Ejemplos de destino:');
    console.log('    Numero:  521XXXXXXXXXX');
    console.log('    Grupo:   120363XXXXXXXXXX@g.us');
    console.log('');

    const to = await ask(rl, '  Destino (numero o ID de grupo): ');
    if (!to) { console.log('  Cancelado.\n'); return; }

    const message = await ask(rl, '  Mensaje: ');
    if (!message) { console.log('  Cancelado.\n'); return; }

    try {
        const result = await httpPost('/send', { to, message });
        if (result.ok) {
            console.log('');
            console.log('  OK - Mensaje enviado correctamente.');
        } else {
            console.log('');
            console.log('  ERROR - ' + result.error);
        }
    } catch (err) {
        console.log('');
        console.log('  ERROR de conexion: ' + err.message);
    }
    console.log('');
}

async function testInbox() {
    console.log('  Mensajes entrantes (inbox)');
    separator();

    try {
        const result = await httpGet('/inbox');
        if (!result.ok) {
            console.log('  ERROR: ' + result.error);
            console.log('');
            return;
        }

        const msgs = result.messages;
        if (msgs.length === 0) {
            console.log('  El inbox esta vacio. No hay mensajes nuevos.');
            console.log('  (Envia un mensaje desde tu telefono y vuelve a intentar)');
        } else {
            console.log('  ' + msgs.length + ' mensaje(s) recibido(s):');
            console.log('');
            for (let i = 0; i < msgs.length; i++) {
                const m = msgs[i];
                console.log('  [' + (i + 1) + '] De:    ' + m.from);
                if (m.author) {
                    console.log('       Autor:  ' + m.author);
                }
                console.log('       Hora:   ' + fmtTimestamp(m.timestamp));
                if (m.body) {
                    console.log('       Texto:  ' + m.body);
                }
                if (m.media_type) {
                    console.log('       Media:  ' + m.media_type);
                    console.log('       Archivo: ' + m.media_filename);
                    console.log('       Ruta:   ' + m.media_path);
                    console.log('       URL:    ' + BASE_URL + '/media/' + m.media_filename);
                }
                console.log('');
            }
            console.log('  (Los mensajes fueron consumidos — el inbox quedo vacio)');
        }
    } catch (err) {
        console.log('  ERROR de conexion: ' + err.message);
    }
    console.log('');
}

async function testGroups() {
    console.log('  Grupos de WhatsApp');
    separator();

    try {
        const result = await httpGet('/groups');
        if (!result.ok) {
            console.log('  ERROR: ' + result.error);
            console.log('');
            return;
        }

        const groups = result.groups;
        if (groups.length === 0) {
            console.log('  No se encontraron grupos en esta sesion.');
        } else {
            console.log('  ' + groups.length + ' grupo(s) encontrado(s):');
            console.log('');
            console.log('  ' + pad('Nombre del grupo', 40) + '  ID (usar en POST /send)');
            separator();
            for (const g of groups) {
                console.log('  ' + pad(g.name, 40) + '  ' + g.id);
            }
        }
    } catch (err) {
        console.log('  ERROR de conexion: ' + err.message);
    }
    console.log('');
}

async function testConsumers() {
    console.log('  Consumers registrados');
    separator();

    try {
        const result = await httpGet('/consumers');
        if (!result.ok) {
            console.log('  ERROR: ' + result.error);
            console.log('');
            return;
        }

        const consumers = result.consumers;
        if (consumers.length === 0) {
            console.log('  No hay consumers registrados.');
            console.log('  Los mensajes van a la cola global (GET /inbox sin parametros).');
        } else {
            console.log('  ' + consumers.length + ' consumer(s) registrado(s):');
            console.log('');
            console.log('  ' + pad('Consumer', 30) + '  Mensajes en cola');
            separator();
            for (const c of consumers) {
                console.log('  ' + pad(c.name, 30) + '  ' + c.queued);
            }
        }
    } catch (err) {
        console.log('  ERROR de conexion: ' + err.message);
    }
    console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('');
    console.log('  =================================================');
    console.log('    wa-gateway - Test de WhatsApp                  ');
    console.log('  =================================================');
    console.log('  Servicio: ' + BASE_URL);
    console.log('');

    // Verificar que el servicio esta corriendo y WA conectado
    let status;
    try {
        status = await httpGet('/status');
    } catch (err) {
        console.error('  ERROR: No se pudo conectar al servicio en ' + BASE_URL);
        console.error('  Detalle: ' + err.message);
        console.error('');
        console.error('  Verifica en PowerShell:');
        console.error('    Invoke-RestMethod http://' + HOST + ':' + PORT + '/status');
        console.error('');
        process.exit(1);
    }

    if (!status.connected) {
        console.error('  ADVERTENCIA: El servicio esta corriendo pero WhatsApp NO esta conectado.');
        console.error('  Ejecuta la opcion 1 del menu para reautenticar la sesion.');
        console.error('');
        process.exit(1);
    }

    console.log('  Servicio:  OK (' + BASE_URL + ')');
    console.log('  WhatsApp:  Conectado');
    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let running = true;
    while (running) {
        console.log('  -----------------------------------------------');
        console.log('    1. Health del servicio');
        console.log('    2. Enviar mensaje de prueba');
        console.log('    3. Ver mensajes entrantes (inbox)');
        console.log('    4. Listar grupos');
        console.log('    5. Ver consumers registrados');
        console.log('    0. Volver al menu principal');
        console.log('  -----------------------------------------------');
        console.log('');

        const opcion = await ask(rl, '  Selecciona [0-5]: ');
        console.log('');

        if (opcion === '1') {
            await testHealth();
        } else if (opcion === '2') {
            await testSend(rl);
        } else if (opcion === '3') {
            await testInbox();
        } else if (opcion === '4') {
            await testGroups();
        } else if (opcion === '5') {
            await testConsumers();
        } else if (opcion === '0') {
            running = false;
        } else {
            console.log('  Opcion invalida.\n');
        }
    }

    rl.close();
    process.exit(0);
}

main().catch((err) => {
    console.error('  Error inesperado: ' + err.message);
    process.exit(1);
});
