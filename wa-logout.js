'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const SESSION_DIR = path.join(AUTH_DIR, 'session-' + SESSION_ID);

// ---------------------------------------------------------------------------
// Cerrar sesion
// ---------------------------------------------------------------------------

console.log('');

if (!fs.existsSync(SESSION_DIR)) {
    console.log('No hay sesion activa para cerrar. El directorio de sesion no existe.');
    process.exit(0);
}

console.log('Cerrando sesion de WhatsApp (session: ' + SESSION_ID + ')...');
console.log('');

// Matar Chrome antes de eliminar archivos (handles abiertos en Windows)
try {
    execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    console.log('Procesos Chrome detenidos.');
} catch (_) {}

// Esperar a que los handles se liberen
try {
    execSync('ping -n 3 127.0.0.1', { stdio: 'ignore' });
} catch (_) {}

// Eliminar directorio de sesion
// rd /s /q en lugar de fs.rmSync: evita EPERM/EBUSY en perfiles Chrome de Windows
try {
    execSync('rd /s /q "' + SESSION_DIR + '"', { stdio: 'ignore' });
    console.log('Sesion eliminada: ' + SESSION_DIR);
    console.log('');
    console.log('WhatsApp desvinculado correctamente.');
    console.log('wa-gateway no podra conectarse hasta que vuelvas a autenticar.');
} catch (err) {
    console.error('Advertencia: no se pudo eliminar completamente el directorio de sesion.');
    console.error('  ' + err.message);
    console.error('Puedes borrarlo manualmente: ' + SESSION_DIR);
}

console.log('');
process.exit(0);
