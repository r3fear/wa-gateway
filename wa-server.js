'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const nodemailer = require('nodemailer');

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

// whatsapp-web.js LocalAuth intenta borrar archivos de Chrome al hacer logout;
// en Windows algunos quedan bloqueados (EBUSY). Capturamos para no crashear.
process.on('uncaughtException', (err) => {
    if (err.message && (err.message.includes('EBUSY') || err.message.includes('ENOENT'))) {
        log('WARNING', 'Archivo de sesion bloqueado al cerrar sesion (ignorado): ' + err.message);
    } else {
        log('ERROR', 'Error fatal no capturado: ' + err.message);
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes('EBUSY') || msg.includes('ENOENT')) {
        log('WARNING', 'Promise rechazada por archivo bloqueado (ignorado): ' + msg);
    } else if (msg.includes('Failed to launch the browser process')) {
        log('ERROR', 'Chrome no pudo iniciarse. Verifica chrome_path en config.json.');
        alertAndExit(
            'wa-gateway — Chrome no pudo iniciarse ' + fmtNow(),
            'El proceso de Chrome falló al iniciar en wa-gateway.\n\nVerifica que chrome_path en config.json apunta al ejecutable correcto y que Chrome está instalado.\n\nSession: ' + SESSION_ID + '\n\nDetalle: ' + msg
        );
    } else {
        log('ERROR', 'Promise rechazada no capturada: ' + msg);
        alertAndExit(
            'wa-gateway — Error fatal ' + fmtNow(),
            'Error no capturado en wa-gateway que requiere reinicio.\n\nSession: ' + SESSION_ID + '\n\nDetalle: ' + msg
        );
    }
});

const PORT = config.port || 3000;
const HOST = config.host || '127.0.0.1';
const SESSION_ID = config.session_id || 'wa-gateway';
const CHROME_PATH = config.chrome_path || '';
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, message) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    console.log(`${y}-${mo}-${d} ${h}:${mi}:${s} - ${level} - ${message}`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isReady = false;
let hasBeenReadyBefore = false;
let inbox = [];
const MAX_INBOX = 50;
let lidToNumber = {};
let lastReadyTs = 0;
let lastDisconnectedTs = 0;
let webhooks = Array.isArray(config.webhooks) ? [...config.webhooks] : [];
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Cleanup lock files
// ---------------------------------------------------------------------------

function cleanupLockFiles() {
    log('INFO', 'Limpiando procesos y lock files de sesion anterior...');

    try {
        execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    } catch (_) {
        // no hay procesos chrome corriendo, ignorar
    }

    try {
        // ping -n 3 genera ~2s de espera en Windows
        execSync('ping -n 3 127.0.0.1', { stdio: 'ignore' });
    } catch (_) {}

    const sessionDir = path.join(AUTH_DIR, 'session-' + SESSION_ID);
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];

    for (const fname of lockFiles) {
        const fpath = path.join(sessionDir, fname);
        try {
            if (fs.existsSync(fpath)) {
                fs.unlinkSync(fpath);
                log('INFO', 'Eliminado lock file: ' + fname);
            }
        } catch (err) {
            log('ERROR', 'No se pudo eliminar ' + fname + ': ' + err.message);
        }
    }

    log('INFO', 'Limpieza completada.');
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendEmail(subject, body) {
    const em = config.email;
    if (!em || !em.enabled) return;

    try {
        const transporter = nodemailer.createTransport({
            host: em.smtp_server,
            port: em.smtp_port,
            secure: false,
            auth: { user: em.sender, pass: em.password },
        });

        await transporter.sendMail({
            from: em.sender,
            to: em.recipients.join(', '),
            subject,
            text: body,
        });

        log('INFO', 'Email de alerta enviado: ' + subject);
    } catch (err) {
        log('ERROR', 'Error enviando email: ' + err.message);
    }
}

async function alertAndExit(subject, body) {
    await sendEmail(subject, body).catch(() => {});
    process.exit(1);
}

function fmtNow() {
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    const dd = String(n.getDate()).padStart(2, '0');
    const mo = String(n.getMonth() + 1).padStart(2, '0');
    const yy = n.getFullYear();
    return `${hh}:${mm} ${dd}/${mo}/${yy}`;
}

// ---------------------------------------------------------------------------
// Webhooks dispatch
// ---------------------------------------------------------------------------

function dispatchWebhooks(payload) {
    const body = JSON.stringify(payload);
    for (const url of webhooks) {
        (function dispatchOne(webhookUrl) {
            const parsed = new URL(webhookUrl);
            const isHttps = parsed.protocol === 'https:';
            const mod = isHttps ? require('https') : require('http');
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + (parsed.search || ''),
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: 5000,
            };

            const req = mod.request(options, (res) => {
                log('INFO', 'Webhook entregado a ' + webhookUrl + ' — HTTP ' + res.statusCode);
            });

            req.on('timeout', () => {
                req.destroy();
                log('WARNING', 'Timeout enviando webhook a ' + webhookUrl);
            });

            req.on('error', (err) => {
                log('WARNING', 'Error enviando webhook a ' + webhookUrl + ': ' + err.message);
            });

            req.write(body);
            req.end();
        })(url);
    }
}

// ---------------------------------------------------------------------------
// @lid resolution
// ---------------------------------------------------------------------------

async function buildLidMap(numbers) {
    let mapped = 0;
    for (const num of numbers) {
        const jid = num.includes('@') ? num : num + '@c.us';
        try {
            const chat = await client.getChatById(jid);
            const messages = await chat.fetchMessages({ limit: 10 });
            for (const msg of messages) {
                if (msg.fromMe) continue;
                const from = msg.author || msg.from;
                if (from && from.endsWith('@lid')) {
                    const lid = from.replace('@lid', '');
                    lidToNumber[lid] = num;
                    mapped++;
                    log('INFO', 'Mapeado @lid ' + lid + ' -> ' + num);
                    break;
                }
            }
        } catch (err) {
            log('WARNING', 'No se pudo mapear numero ' + num + ': ' + err.message);
        }
    }
    return mapped;
}

function resolveSender(raw) {
    if (!raw) return raw;
    if (raw.endsWith('@lid')) {
        const lid = raw.replace('@lid', '');
        return lidToNumber[lid] ? lidToNumber[lid] + '@c.us' : raw;
    }
    return raw;
}

// ---------------------------------------------------------------------------
// WhatsApp client
// ---------------------------------------------------------------------------

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

client.on('qr', () => {
    log('ERROR', 'No hay sesion activa de WhatsApp. Ejecuta setup-whatsapp.bat para autenticar.');
    log('INFO', 'Deteniendo el servicio...');
    alertAndExit(
        'wa-gateway — Sin sesion activa ' + fmtNow(),
        'wa-gateway no tiene sesion de WhatsApp activa y no puede iniciar.\n\nEjecuta setup-whatsapp.bat en el servidor para autenticar la sesion.\n\nSession: ' + SESSION_ID
    );
});

client.on('ready', () => {
    const now = Date.now();
    if (now - lastReadyTs < 2000) return;
    lastReadyTs = now;

    isReady = true;
    log('INFO', 'Cliente WhatsApp listo y conectado.');

    if (hasBeenReadyBefore) {
        log('INFO', 'WhatsApp reconectado exitosamente.');
        sendEmail(
            'wa-gateway — WhatsApp reconectado ' + fmtNow(),
            'El servicio wa-gateway ha restaurado la conexion con WhatsApp.\n\nSession: ' + SESSION_ID
        );
    }

    hasBeenReadyBefore = true;
});

client.on('auth_failure', (msg) => {
    isReady = false;
    log('ERROR', 'Fallo de autenticacion WhatsApp: ' + msg);
    log('INFO', 'Ejecuta setup-whatsapp.bat para reconfigurar la sesion.');
    log('INFO', 'Deteniendo el servicio...');
    alertAndExit(
        'wa-gateway — WhatsApp desconectado ' + fmtNow(),
        'Fallo de autenticacion en wa-gateway.\n\nDetalle: ' + msg + '\n\nEjecuta setup-whatsapp.bat en el servidor para reautenticar la sesion.\n\nSession: ' + SESSION_ID
    );
});

client.on('disconnected', (reason) => {
    const now = Date.now();
    if (now - lastDisconnectedTs < 2000) return;
    lastDisconnectedTs = now;

    isReady = false;
    log('WARNING', 'WhatsApp desconectado. Razon: ' + reason);
    log('INFO', 'Ejecuta setup-whatsapp.bat para reconfigurar la sesion.');
    log('INFO', 'Deteniendo el servicio...');
    alertAndExit(
        'wa-gateway — WhatsApp desconectado ' + fmtNow(),
        'WhatsApp se desconecto en wa-gateway.\n\nRazon: ' + reason + '\n\nEjecuta setup-whatsapp.bat en el servidor para reautenticar la sesion.\n\nSession: ' + SESSION_ID
    );
});

client.on('message', async (msg) => {
    if (msg.fromMe) return;

    const isGroup = msg.from.endsWith('@g.us');
    let entry;

    if (isGroup) {
        const rawAuthor = msg.author || '';
        const resolvedAuthor = rawAuthor ? resolveSender(rawAuthor) : null;
        entry = {
            from: msg.from,
            body: msg.body,
            timestamp: msg.timestamp,
        };
        if (resolvedAuthor) entry.author = resolvedAuthor;
        log('INFO', 'Mensaje de grupo ' + msg.from + (resolvedAuthor ? ' (de ' + resolvedAuthor + ')' : '') + ': ' + (msg.body || '[media]').substring(0, 80));
    } else {
        const resolvedFrom = resolveSender(msg.from);
        entry = {
            from: resolvedFrom,
            body: msg.body,
            timestamp: msg.timestamp,
        };
        log('INFO', 'Mensaje recibido de ' + resolvedFrom + ': ' + (msg.body || '[media]').substring(0, 80));
    }

    // Descargar y guardar media adjunta (imagenes, videos, documentos, audio)
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.data) {
                const mediaDir = path.join(__dirname, config.media_dir || 'media');
                if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

                // Determinar extension desde mimetype (ej: "image/jpeg" -> "jpeg")
                const rawExt = (media.mimetype || 'application/octet-stream').split('/')[1].split(';')[0];
                const safeExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
                const basename = media.filename
                    ? media.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
                    : (msg.timestamp + '_' + msg.id.id.substring(0, 16) + '.' + safeExt);

                const filePath = path.join(mediaDir, basename);
                fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                entry.media_type = media.mimetype;
                entry.media_path = filePath;
                entry.media_filename = basename;
                log('INFO', 'Media recibida [' + media.mimetype + '] guardada en: ' + filePath);
            }
        } catch (err) {
            log('WARNING', 'No se pudo descargar media del mensaje: ' + err.message);
        }
    }

    if (inbox.length >= MAX_INBOX) {
        inbox.shift();
    }
    inbox.push(entry);
    dispatchWebhooks(entry);
});

// ---------------------------------------------------------------------------
// HTTP utilities
// ---------------------------------------------------------------------------

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (e) {
                reject(new Error('JSON invalido'));
            }
        });
        req.on('error', reject);
    });
}

function send200(res, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
}

function send400(res, msg) {
    const body = JSON.stringify({ ok: false, error: msg });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(body);
}

function send405(res) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
}

function send404(res) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
}

function send503(res) {
    const body = JSON.stringify({ ok: false, error: 'WhatsApp no esta conectado' });
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(body);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    try {
        // GET /status
        if (pathname === '/status' && method === 'GET') {
            return send200(res, { ok: true, connected: isReady });
        }

        // GET /inbox
        if (pathname === '/inbox' && method === 'GET') {
            const messages = inbox.slice();
            inbox = [];
            return send200(res, { ok: true, messages });
        }

        // GET /subscribers
        if (pathname === '/subscribers' && method === 'GET') {
            return send200(res, { ok: true, subscribers: webhooks.slice() });
        }

        // GET /health
        if (pathname === '/health' && method === 'GET') {
            return send200(res, {
                ok: true,
                connected: isReady,
                inbox_size: inbox.length,
                subscribers: webhooks.length,
                uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
                session_id: SESSION_ID,
            });
        }

        // POST /send
        if (pathname === '/send' && method === 'POST') {
            if (!isReady) return send503(res);
            let body;
            try { body = await readBody(req); } catch (e) { return send400(res, e.message); }

            const { to, message, imagePath } = body;
            if (!to || !message) return send400(res, 'Faltan campos: to, message');

            const jid = to.includes('@') ? to : to + '@c.us';

            try {
                await client.sendMessage(jid, message);

                if (imagePath && fs.existsSync(imagePath)) {
                    const media = MessageMedia.fromFilePath(imagePath);
                    await client.sendMessage(jid, media);
                    log('INFO', 'Imagen enviada a ' + jid + ' desde ' + imagePath);
                }

                log('INFO', 'Mensaje enviado a ' + jid);
                return send200(res, { ok: true });
            } catch (err) {
                log('ERROR', 'Error enviando mensaje a ' + jid + ': ' + err.message);
                return send200(res, { ok: false, error: err.message });
            }
        }

        // POST /register-numbers
        if (pathname === '/register-numbers' && method === 'POST') {
            if (!isReady) return send503(res);
            let body;
            try { body = await readBody(req); } catch (e) { return send400(res, e.message); }

            const { numbers } = body;
            if (!Array.isArray(numbers)) return send400(res, 'Campo numbers debe ser array');

            log('INFO', 'Iniciando mapeo de ' + numbers.length + ' numeros a @lid...');
            const mapped = await buildLidMap(numbers);
            log('INFO', 'Mapeo completado: ' + mapped + ' numeros resueltos.');
            return send200(res, { ok: true, mapped });
        }

        // GET /groups
        if (pathname === '/groups' && method === 'GET') {
            if (!isReady) return send503(res);
            try {
                const chats = await client.getChats();
                const groups = chats
                    .filter((c) => c.isGroup)
                    .map((c) => ({ id: c.id._serialized, name: c.name }));
                return send200(res, { ok: true, groups });
            } catch (err) {
                log('ERROR', 'Error obteniendo grupos: ' + err.message);
                return send200(res, { ok: false, error: err.message });
            }
        }

        // POST /subscribe
        if (pathname === '/subscribe' && method === 'POST') {
            let body;
            try { body = await readBody(req); } catch (e) { return send400(res, e.message); }

            const { url: webhookUrl } = body;
            if (!webhookUrl) return send400(res, 'Falta campo: url');

            if (!webhooks.includes(webhookUrl)) {
                webhooks.push(webhookUrl);
                log('INFO', 'Webhook registrado: ' + webhookUrl);
            }
            return send200(res, { ok: true, subscribers: webhooks.length });
        }

        // POST /unsubscribe
        if (pathname === '/unsubscribe' && method === 'POST') {
            let body;
            try { body = await readBody(req); } catch (e) { return send400(res, e.message); }

            const { url: webhookUrl } = body;
            if (!webhookUrl) return send400(res, 'Falta campo: url');

            const before = webhooks.length;
            webhooks = webhooks.filter((u) => u !== webhookUrl);
            if (webhooks.length < before) {
                log('INFO', 'Webhook eliminado: ' + webhookUrl);
            }
            return send200(res, { ok: true, subscribers: webhooks.length });
        }

        // GET /media/:filename  — servir archivos de media recibidos
        if (pathname.startsWith('/media/') && method === 'GET') {
            const filename = path.basename(pathname.slice('/media/'.length));
            if (!filename) return send400(res, 'Falta nombre de archivo');

            const mediaDir = path.join(__dirname, config.media_dir || 'media');
            const filePath = path.join(mediaDir, filename);

            // Seguridad: verificar que la ruta resuelta sigue dentro de mediaDir
            if (!filePath.startsWith(mediaDir + path.sep) && filePath !== mediaDir) {
                return send400(res, 'Ruta invalida');
            }

            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: 'Archivo no encontrado' }));
            }

            const ext = path.extname(filename).toLowerCase().replace('.', '');
            const mimeMap = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
                mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo',
                mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
                pdf: 'application/pdf', doc: 'application/msword',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            };
            const contentType = mimeMap[ext] || 'application/octet-stream';

            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stat.size,
                'Content-Disposition': 'inline; filename="' + filename + '"',
            });
            fs.createReadStream(filePath).pipe(res);
            log('INFO', 'Media servida: ' + filename + ' (' + stat.size + ' bytes)');
            return;
        }

        // Method guard for known paths with wrong method
        const knownPaths = ['/send', '/register-numbers', '/subscribe', '/unsubscribe',
            '/status', '/inbox', '/subscribers', '/health', '/groups'];
        if (knownPaths.includes(pathname)) {
            return send405(res);
        }

        return send404(res);

    } catch (err) {
        log('ERROR', 'Error interno manejando ' + method + ' ' + pathname + ': ' + err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

cleanupLockFiles();

server.listen(PORT, HOST, () => {
    log('INFO', 'wa-gateway escuchando en http://' + HOST + ':' + PORT);
});

log('INFO', 'Iniciando cliente WhatsApp (session: ' + SESSION_ID + ')...');
client.initialize();
