// Parche temporal para whatsapp-web.js 1.34.7 — se ejecuta en "postinstall".
//
// Desde ~2026-09-17 WhatsApp Web devuelve MediaData como un modelo con un campo
// interno __x_id. Al hacer spread de mediaOptions sobre el mensaje saliente, ese
// campo pisa el id real del Msg y el envio de imagenes/video falla con:
//   "Data passed to getter must include an id property (it's how we memoize)"
// Los mensajes de texto no se ven afectados.
//
// Basado en los PRs upstream wwebjs/whatsapp-web.js #201923 y #201925.
// Quitar este script cuando salga una version de whatsapp-web.js con el fix.

const fs = require('fs');
const path = require('path');

const MARKER = '// wa-gateway patch: media __x_id';
const target = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');

if (!fs.existsSync(target)) {
    console.log('[patch-whatsapp-web] whatsapp-web.js no instalado, se omite.');
    process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');

if (src.includes(MARKER)) {
    console.log('[patch-whatsapp-web] Parche ya aplicado.');
    process.exit(0);
}

const anchor = /(\n([ \t]*)\/\/ Bot's won't reply if canonicalUrl is set \(linking\))/;
if (!anchor.test(src)) {
    console.warn('[patch-whatsapp-web] No se encontro el punto de parche; la version de whatsapp-web.js cambio. Revisar si aun es necesario.');
    process.exit(0);
}

src = src.replace(anchor, (m, all, indent) =>
    '\n' + indent + MARKER + '\n' +
    indent + 'delete message.__x_id;\n' +
    indent + 'message.id = newMsgKey;\n' +
    all
);

fs.writeFileSync(target, src, 'utf8');
console.log('[patch-whatsapp-web] Parche aplicado a ' + target);
