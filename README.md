<div align="center">
  <img src="https://img.shields.io/badge/wa--gateway-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="wa-gateway" height="42" />
  <p><em>Gateway HTTP independiente para WhatsApp</em></p>
</div>

---

Expone una API REST que permite a cualquier aplicación enviar y recibir mensajes, imágenes y archivos a través de WhatsApp, sin acoplarse a ningún framework ni lenguaje específico.

---

## Descripción

wa-gateway corre como un proceso de fondo (o servicio de Windows) y actúa como intermediario entre tu aplicación y WhatsApp Web. Tu aplicación solo habla HTTP.

**Capacidades:**

- Enviar mensajes de texto e imágenes a números individuales y grupos
- Recibir mensajes entrantes (texto y archivos multimedia) mediante polling o webhooks push
- Guardar automáticamente los archivos multimedia recibidos y servirlos vía HTTP
- Notificar por email cuando WhatsApp se desconecta o reconecta
- Soportar múltiples instancias simultáneas con sesiones independientes

**Stack:**

- Node.js 20+ con módulo `http` nativo — sin Express ni frameworks
- `whatsapp-web.js` + Puppeteer con Chrome headless
- `LocalAuth` para persistir la sesión entre reinicios
- `nodemailer` para alertas de email

---

## Requisitos

- Node.js 20 o superior
- Google Chrome instalado
- Windows (el proyecto usa `taskkill` y `rd /s /q` para manejo de procesos y sesiones)
- NSSM (opcional, para instalar como servicio de Windows)

---

## Instalación

### 1. Instalar dependencias

```bat
cd C:\ruta\al\proyecto\wa-gateway
npm install
```

### 2. Configurar

```bat
copy config.json.example config.json
```

Editar `config.json` con los valores del entorno:

```json
{
  "port": 3000,
  "host": "127.0.0.1",
  "chrome_path": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "session_id": "wa-gateway",
  "media_dir": "media",

  "email": {
    "enabled": false,
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "sender": "correo@dominio.com",
    "password": "app_password_aqui",
    "recipients": ["admin@dominio.com"]
  },

  "webhooks": []
}
```

| Campo | Descripción |
|---|---|
| `port` | Puerto TCP del servidor HTTP |
| `host` | `127.0.0.1` para solo localhost; `0.0.0.0` para acceso desde la red local |
| `chrome_path` | Ruta absoluta al ejecutable de Chrome |
| `session_id` | Identificador de sesión. Usar nombres distintos para múltiples instancias |
| `media_dir` | Directorio donde se guardan los archivos multimedia recibidos (relativo al proyecto) |
| `email.enabled` | `true` para activar alertas por email en desconexiones |
| `webhooks` | Lista de URLs que reciben POST automático al llegar cada mensaje |

---

## Autenticación QR

La primera vez — y cada vez que la sesión expire — es necesario escanear un código QR con el teléfono.

**wa-gateway debe estar detenido** antes de correr este paso.

Abrir `setup-whatsapp.bat` y seleccionar **Reconectar sesión**. El script:

1. Detiene servicios residuales (node, chrome)
2. Ejecuta `wa-login.js` en la terminal actual
3. Muestra el código QR en consola
4. Al escanear con WhatsApp, guarda la sesión y termina

Desde el teléfono: **WhatsApp > Menú > Dispositivos vinculados > Vincular dispositivo**

---

## Arranque del servicio

### Modo desarrollo (terminal visible)

```bat
node wa-server.js
```

### Como servicio de Windows con NSSM

La forma más sencilla es usar el `setup-whatsapp.bat` (opción **Instalar servicio**), que realiza todas las verificaciones automáticamente.

Para hacerlo manualmente (como Administrador):

```bat
nssm install wa-gateway "C:\Program Files\nodejs\node.exe"
nssm set wa-gateway AppParameters "C:\ruta\wa-gateway\wa-server.js"
nssm set wa-gateway AppDirectory "C:\ruta\wa-gateway"
nssm set wa-gateway AppStdout "C:\ruta\wa-gateway\logs\wa-gateway.log"
nssm set wa-gateway AppStderr "C:\ruta\wa-gateway\logs\wa-gateway.log"
nssm set wa-gateway AppRotateFiles 1
nssm set wa-gateway Start SERVICE_AUTO_START
nssm start wa-gateway
```

#### Gestión del servicio

```bat
nssm start wa-gateway
nssm stop wa-gateway
nssm restart wa-gateway
nssm status wa-gateway
nssm remove wa-gateway confirm
```

#### Ver logs en tiempo real (PowerShell)

```powershell
Get-Content C:\ruta\wa-gateway\logs\wa-gateway.log -Wait
```

---

## Panel de control — setup-whatsapp.bat

Script de administración interactivo con menú agrupado:

```
  SESION DE WHATSAPP
   [1] Reconectar sesion         nueva autenticacion QR
   [2] Cerrar sesion              desvincular WhatsApp

  SERVICIO DE WINDOWS
   [3] Instalar servicio          npm install + NSSM
   [4] Iniciar servicio
   [5] Detener servicio
   [6] Reiniciar servicio

  DIAGNOSTICO
   [7] Test de WhatsApp           verificar y probar
```

La opción **Instalar servicio** verifica automáticamente: permisos de Administrador, Node.js, npm, NSSM, `config.json` y la ruta a Chrome antes de proceder.

La opción **Test de WhatsApp** abre un submenú interactivo para verificar el estado del servicio, enviar un mensaje de prueba, revisar el inbox y listar grupos.

---

## Referencia de la API

Todos los endpoints responden JSON. Los errores de negocio retornan HTTP 200 con `{ "ok": false, "error": "..." }`.

---

### POST /send

Envía un mensaje de texto (y opcionalmente una imagen) a un número individual o a un grupo.

**Body:**
```json
{
  "to": "521XXXXXXXXXX",
  "message": "Hola desde wa-gateway",
  "imagePath": "C:\\ruta\\absoluta\\imagen.jpg"
}
```

| Campo | Requerido | Descripción |
|---|---|---|
| `to` | Sí | Número sin `@` (se agrega `@c.us` automáticamente), o JID completo (`número@c.us` o `ID@g.us` para grupos) |
| `message` | Sí | Texto del mensaje |
| `imagePath` | No | Ruta absoluta a una imagen local. Si existe, se envía como archivo adjunto |

**Respuesta:**
```json
{ "ok": true }
```

**Ejemplo con curl:**
```bash
curl -X POST http://127.0.0.1:3000/send \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"521XXXXXXXXXX\",\"message\":\"Hola\"}"
```

**Enviar a un grupo:**
```bash
curl -X POST http://127.0.0.1:3000/send \
  -H "Content-Type: application/json" \
  -d "{\"to\":\"120363XXXXXXXXXX@g.us\",\"message\":\"Hola al grupo\"}"
```

---

### GET /status

Estado de la conexión WhatsApp. Útil para verificar que el servicio está listo antes de enviar mensajes.

**Respuesta:**
```json
{ "ok": true, "connected": true }
```

---

### GET /health

Estado completo del servicio, incluyendo uptime y tamaño del inbox.

**Respuesta:**
```json
{
  "ok": true,
  "connected": true,
  "inbox_size": 3,
  "subscribers": 1,
  "uptime_seconds": 3600,
  "session_id": "wa-gateway"
}
```

---

### GET /inbox

Retorna **y vacía** la cola de mensajes entrantes (modelo polling).

**Respuesta — mensaje de texto:**
```json
{
  "ok": true,
  "messages": [
    {
      "from": "521XXXXXXXXXX@c.us",
      "body": "Hola",
      "timestamp": 1700000000
    }
  ]
}
```

**Respuesta — mensaje con imagen u otro archivo multimedia:**
```json
{
  "ok": true,
  "messages": [
    {
      "from": "521XXXXXXXXXX@c.us",
      "body": "",
      "timestamp": 1700000000,
      "media_type": "image/jpeg",
      "media_filename": "1700000000_abc123.jpeg",
      "media_path": "C:\\ruta\\wa-gateway\\media\\1700000000_abc123.jpeg"
    }
  ]
}
```

**Respuesta — mensaje de grupo:**
```json
{
  "ok": true,
  "messages": [
    {
      "from": "120363XXXXXXXXXX@g.us",
      "author": "521XXXXXXXXXX@c.us",
      "body": "Hola desde el grupo",
      "timestamp": 1700000000
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `from` | JID del remitente o del grupo |
| `author` | JID del miembro que escribió (solo en mensajes de grupo) |
| `body` | Texto del mensaje. Puede estar vacío si el mensaje es solo multimedia |
| `timestamp` | Unix timestamp en segundos |
| `media_type` | MIME type del archivo adjunto (ej. `image/jpeg`, `video/mp4`, `application/pdf`) |
| `media_filename` | Nombre del archivo guardado localmente |
| `media_path` | Ruta absoluta al archivo guardado en el servidor |

Después de llamar a `GET /inbox`, la cola queda vacía. Los mensajes no se pueden releer una vez consumidos.

---

### GET /media/:filename

Sirve un archivo multimedia recibido. Permite a consumidores remotos (vía webhook) obtener el archivo sin necesidad de acceso directo al sistema de archivos del servidor.

```
GET http://127.0.0.1:3000/media/1700000000_abc123.jpeg
```

Responde con el archivo binario y el `Content-Type` correcto. Solo archivos dentro del directorio `media_dir` son accesibles.

**Tipos soportados:** imágenes (jpg, png, gif, webp), video (mp4, mov, avi), audio (mp3, ogg, wav), documentos (pdf, doc, docx, xlsx), y cualquier otro tipo como `application/octet-stream`.

---

### GET /groups

Lista todos los grupos de WhatsApp en los que el número conectado es miembro.

**Respuesta:**
```json
{
  "ok": true,
  "groups": [
    { "id": "120363XXXXXXXXXX@g.us", "name": "Equipo Operaciones" },
    { "id": "120363YYYYYYYYYY@g.us", "name": "Alertas Produccion" }
  ]
}
```

El `id` del grupo es el valor a usar en el campo `to` de `POST /send`.

---

### POST /register-numbers

Construye el mapa interno `@lid → número de teléfono`. Ver [El problema de @lid](#el-problema-de-lid-whatsapp-multi-device) para entender cuándo es necesario.

**Body:**
```json
{
  "numbers": ["521XXXXXXXXXX", "521YYYYYYYYYY"]
}
```

**Respuesta:**
```json
{ "ok": true, "mapped": 2 }
```

---

### POST /subscribe

Registra una URL que recibirá un `POST` cada vez que llegue un mensaje (webhook push).

**Body:**
```json
{ "url": "http://mi-app:4000/wa-incoming" }
```

**Respuesta:**
```json
{ "ok": true, "subscribers": 1 }
```

El registro es en memoria y se pierde al reiniciar. Para webhooks permanentes, agregar las URLs en `config.json` → `webhooks`.

---

### POST /unsubscribe

Elimina una URL de la lista de webhooks activos.

**Body:**
```json
{ "url": "http://mi-app:4000/wa-incoming" }
```

**Respuesta:**
```json
{ "ok": true, "subscribers": 0 }
```

---

### GET /subscribers

Lista las URLs de webhook actualmente registradas.

**Respuesta:**
```json
{ "ok": true, "subscribers": ["http://mi-app:4000/wa-incoming"] }
```

---

## Mensajes entrantes con multimedia

Cuando alguien envía una imagen, video, documento, audio o nota de voz, wa-gateway:

1. Descarga el archivo automáticamente via `msg.downloadMedia()`
2. Lo guarda en el directorio `media_dir` (por defecto `media/`, relativo al proyecto)
3. Genera un nombre de archivo: usa el nombre original si WhatsApp lo incluye; de lo contrario genera `{timestamp}_{msgId}.{ext}`
4. Agrega los campos `media_type`, `media_filename` y `media_path` al entry del inbox y al payload del webhook

**Integración recomendada para consumidores remotos:**

```
1. Recibir el webhook con { from, body, media_type, media_filename, ... }
2. Si media_filename existe: GET /media/{media_filename}
3. Procesar el archivo (guardar, analizar, reenviar, etc.)
```

---

## Modelo de webhooks

Cuando llega un mensaje, wa-gateway hace `POST` inmediato a cada URL registrada.

**Payload para mensaje de texto:**
```json
{
  "from": "521XXXXXXXXXX@c.us",
  "body": "Texto del mensaje",
  "timestamp": 1700000000
}
```

**Payload para mensaje con archivo:**
```json
{
  "from": "521XXXXXXXXXX@c.us",
  "body": "",
  "timestamp": 1700000000,
  "media_type": "image/jpeg",
  "media_filename": "1700000000_abc123.jpeg",
  "media_path": "C:\\ruta\\wa-gateway\\media\\1700000000_abc123.jpeg"
}
```

**Payload para mensaje de grupo:**
```json
{
  "from": "120363XXXXXXXXXX@g.us",
  "author": "521XXXXXXXXXX@c.us",
  "body": "Mensaje en el grupo",
  "timestamp": 1700000000
}
```

**Características:**
- Timeout de 5 segundos por webhook
- Si falla, se registra `WARNING` en el log y se continúa con los demás
- URLs en `config.json` → `webhooks` son permanentes (sobreviven reinicios)
- URLs registradas vía `POST /subscribe` son en memoria

---

## Guía de integración para nuevos proyectos

Pasos para conectar cualquier aplicación a wa-gateway:

### 1. Verificar que el servicio está listo

```http
GET /status
```
Si `connected` es `false`, esperar o notificar al operador para que re-autentique.

### 2. Registrar los contactos esperados (opcional pero recomendado)

```http
POST /register-numbers
{ "numbers": ["521XXXXXXXXXX", "521YYYYYYYYYY"] }
```

Esto resuelve el problema de `@lid`. Llamar una vez al arrancar la aplicación con los números de los usuarios con los que se espera interacción.

### 3. Enviar mensajes

```http
POST /send
{ "to": "521XXXXXXXXXX", "message": "Hola" }
```

### 4. Recibir mensajes

**Opción A — Polling** (más simple, sin servidor propio):
```http
GET /inbox  →  consumir mensajes, vacía la cola
```
Llamar cada N segundos según la latencia aceptable para la aplicación.

**Opción B — Webhook push** (menor latencia, requiere endpoint HTTP en la aplicación):
```http
POST /subscribe
{ "url": "http://mi-app:PUERTO/wa-incoming" }
```
wa-gateway hará POST a ese endpoint por cada mensaje recibido.

### 5. Descargar archivos multimedia recibidos

Si el mensaje tiene `media_filename`:
```http
GET /media/{media_filename}
```

### 6. Enviar a grupos

Primero obtener el ID del grupo:
```http
GET /groups
```
Luego usar ese ID en el campo `to`:
```http
POST /send
{ "to": "120363XXXXXXXXXX@g.us", "message": "Mensaje al grupo" }
```

---

## Alertas por email

Cuando WhatsApp se desconecta o hay un fallo de autenticación, wa-gateway envía un email a los `recipients` configurados.

Para Gmail se requiere una **contraseña de aplicación** (no la contraseña normal):
`Google Account > Seguridad > Verificación en dos pasos > Contraseñas de aplicaciones`

**Eventos que disparan email:**
- `auth_failure`: fallo de autenticación — el proceso termina
- `disconnected`: desconexión inesperada — el proceso termina
- `qr`: sesión inexistente al arrancar — el proceso termina
- `ready` después de haber estado conectado: email de restauración (informativo, el proceso continúa)

El primer `ready` al arrancar NO envía email.

---

## Gestión de sesión

### Cuándo re-autenticar

- Primera instalación
- Cuando el log muestra `auth_failure` o `disconnected`
- Cuando desde el teléfono se desvincula el dispositivo (WhatsApp > Dispositivos vinculados)
- Cuando el servicio arranca y envía email de "sin sesión activa"

### Procedimiento

1. Detener el servicio: `nssm stop wa-gateway` (o Opción 5 del bat)
2. Abrir `setup-whatsapp.bat` → Opción 1 (Reconectar sesión)
3. Escanear el QR con el teléfono
4. Iniciar el servicio: `nssm start wa-gateway` (o Opción 4 del bat)

### Sesiones múltiples (dos números de WhatsApp)

Crear dos directorios con sus propios `config.json` e instalar dos servicios NSSM:

| Instancia | `session_id` | `port` | Servicio NSSM |
|---|---|---|---|
| Principal | `wa-gateway-1` | `3000` | `wa-gateway-1` |
| Secundaria | `wa-gateway-2` | `3001` | `wa-gateway-2` |

---

## Recuperación de errores

| Síntoma | Causa probable | Solución |
|---|---|---|
| `connected: false` permanente | Sesión expirada | Ejecutar opción 1 del bat para re-autenticar |
| QR no aparece en wa-login | Chrome ocupado o lock files | El script los limpia automáticamente; si persiste, reiniciar el equipo |
| `503` en `/send` | WhatsApp no conectado | Esperar a que conecte o re-autenticar |
| Webhook no recibe mensajes | URL incorrecta o servicio receptor caído | Verificar con `GET /subscribers` y revisar el log |
| `ERROR: No se pudo leer config.json` | Falta el archivo | Copiar `config.json.example` a `config.json` y configurar |
| Media recibida no se guarda | Error al descargar | Revisar el log (aparece como `WARNING`); puede ser un archivo muy grande o un tipo bloqueado por WhatsApp |
| `GET /media/:filename` responde 404 | El archivo no existe en `media_dir` | Verificar que `media_dir` en config.json apunta al directorio correcto |

---

## Notas para IA y desarrolladores

### El problema de @lid (WhatsApp multi-device)

WhatsApp en modo multi-device identifica al remitente con un identificador interno (`1234567890@lid`) en lugar del número de teléfono. `whatsapp-web.js` no provee una API para resolver este identificador a número directamente.

**Solución implementada:** `POST /register-numbers` abre los chats de los números dados, lee los últimos 10 mensajes de cada uno, y si encuentra mensajes entrantes con `from` terminado en `@lid`, guarda la relación `lid → número` en un mapa en memoria (`lidToNumber`). El handler de mensajes resuelve el `@lid` antes de encolar o despachar.

Esto funciona porque si un contacto ya envió mensajes previamente, ese historial contiene su `@lid`. Si no hay historial, el `@lid` aparece sin resolver en el campo `from` hasta que se registre el número.

### Por qué `rd /s /q` y no `fs.rmSync` para borrar la sesión

Chrome escribe archivos con extensiones `.ldb` y directorios de perfil que en Windows tienen handles abiertos o atributos especiales. `fs.rmSync({ recursive: true })` falla con `EPERM` o `EBUSY` en estos casos. `rd /s /q` es el comando nativo de Windows que maneja correctamente estos permisos del sistema de archivos.

### Por qué `__dirname` y no `process.cwd()` en las rutas

El servicio puede iniciarse desde cualquier directorio de trabajo. NSSM usa `AppDirectory` configurado, pero si se llama desde otro directorio `process.cwd()` sería incorrecto. `__dirname` siempre apunta al directorio donde reside el script, independientemente del CWD al momento del inicio.

### Por qué `taskkill` antes de borrar los lock files

Chrome mantiene handles abiertos sobre `SingletonLock` y `DevToolsActivePort` mientras está corriendo. Intentar eliminar estos archivos con el proceso activo falla con `EBUSY`. El orden correcto es: matar Chrome → esperar 2 segundos → eliminar archivos.

### Manejo de EBUSY en `uncaughtException`

`whatsapp-web.js` con `LocalAuth` intenta limpiar archivos internos de Chrome al hacer `client.logout()`. En Windows esto a veces lanza `EBUSY` porque el proceso Chrome aún no liberó los handles. El proceso registra un handler global de `uncaughtException` que filtra estos errores y los registra como `WARNING` sin terminar el proceso, ya que no representan un fallo funcional.

### Seguridad en GET /media/:filename

El endpoint valida que la ruta resuelta (`path.join(mediaDir, filename)`) permanezca dentro del `mediaDir` configurado. Esto previene ataques de path traversal (`../../etc/passwd`). Solo se usa `path.basename()` del nombre del archivo, eliminando cualquier componente de directorio antes de unirlo.

### Formato de log

Todos los mensajes siguen el formato:
```
YYYY-MM-DD HH:MM:SS - LEVEL - mensaje
```

Los niveles usados son `INFO`, `WARNING` y `ERROR`. Este formato facilita el parsing por herramientas de análisis de logs y la correlación con otros servicios que usen el mismo esquema.

### Debounce en eventos de WhatsApp

`whatsapp-web.js` puede disparar los eventos `ready` y `disconnected` múltiples veces en ráfaga (comportamiento interno del cliente). Se implementa un guard de 2000ms: si el mismo evento llega en menos de 2 segundos desde el anterior, se ignora. Esto evita enviar múltiples emails de alerta por un solo evento.

---

## Créditos

wa-gateway está construido sobre [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), una librería no oficial para WhatsApp Web desarrollada por [Pedro S. Lopez](https://github.com/pedroslopez) y sus colaboradores. Esta librería es la que gestiona la sesión, la autenticación QR, el envío y recepción de mensajes, y la interacción con WhatsApp Web a través de Puppeteer.

> **Nota:** whatsapp-web.js no está afiliado ni respaldado por WhatsApp o Meta. El uso de esta librería está sujeto a los términos de servicio de WhatsApp.
