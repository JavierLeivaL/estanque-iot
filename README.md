# Estanques IoT — Monitoreo de nivel de estanques y contenedores

Sistema IoT para la Solemne 1 de Infraestructura TI. Una **Raspberry Pi 4** mide el nivel de llenado de un estanque o basurero con un **HC-SR04** y la temperatura y humedad con un **DHT22**. Los datos se procesan en **6 contenedores Docker** dentro de la Raspberry, se envían por HTTPS a una **API en Vercel**, se guardan en **Cloud Firestore** y se visualizan en una **plataforma web** con roles y organizaciones aisladas.

```
 HC-SR04 ─► [nivel] ─┐                                   ┌─► Firestore (plan Spark)
                     ├─► MQTT ─► [procesamiento] ─► MQTT ─► [sincronizacion] ══HTTPS══► API Vercel ─┤
 DHT22 ──► [ambiente]┘   (Mosquitto)                       │  buffer SQLite                       └─► Web (Next.js)
                                  [salud] ◄── latidos ─────┘
```

## Estructura del repositorio

| Carpeta | Contenido |
|---|---|
| `device/` | Software de la Raspberry Pi: `docker-compose.yml`, broker Mosquitto y 5 microservicios en Python |
| `web/` | Plataforma web + API REST (Next.js, desplegada en Vercel) |
| `firebase/` | Security Rules e índices de Firestore |
| `docs/` | Modelo de datos, API (OpenAPI) y documentación técnica |

## Microservicios (Raspberry Pi)

| Contenedor | Responsabilidad única | Entrada → Salida |
|---|---|---|
| `broker` | Mosquitto: desacopla productores y consumidores | — |
| `nivel` | Lee el HC-SR04 por `/dev/gpiochip0` (libgpiod) | GPIO → `estanque/crudo/nivel` |
| `ambiente` | Lee el DHT22 desde el driver del kernel (`/sys/bus/iio`) | sysfs → `estanque/crudo/ambiente` |
| `procesamiento` | Valida, compensa la distancia por temperatura, calcula % de llenado, proyecta cuándo se llena, agrega por minuto y detecta umbrales | `crudo/#` → `estanque/agregado`, `estanque/eventos` |
| `sincronizacion` | Buffer SQLite, envío por lotes HTTPS a la API, recepción de configuración | `agregado`, `eventos` → API; API → `estanque/config` (retenido) |
| `salud` | Latidos de cada servicio + CPU/RAM/disco/temperatura de la placa; endpoint local `127.0.0.1:8080` | `estanque/salud/+` → `estanque/salud/resumen` |

Todos tienen `restart: unless-stopped`, *healthcheck*, límite de memoria e imágenes ARM64 livianas (`debian:trixie-slim`). Ningún contenedor es privilegiado ni expone puertos hacia la red.

---

## Despliegue desde cero

### 1. Firebase (plan Spark, sin tarjeta)
1. Crear un proyecto en <https://console.firebase.google.com>.
2. **Firestore Database** → Crear base de datos → edición *Standard* → ubicación `southamerica-east1` → modo **producción**.
3. **Firestore → Reglas**: pegar el contenido de `firebase/firestore.rules` y **Publicar**.
4. **Firestore → Índices → Exenciones de campo único**: agregar exención para colección `horas`, campo `m`, desactivando todos los índices (ahorra almacenamiento; ver `docs/modelo-datos.md`).
5. **Authentication** → Comenzar → habilitar **Correo electrónico/contraseña**.
6. **Configuración del proyecto → General → Tus apps → Web (`</>`)**: registrar la app y copiar `firebaseConfig`.
7. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**: descarga un `.json` (**secreto**, no se sube al repo).

### 2. Vercel (plan Hobby, sin tarjeta)
1. <https://vercel.com/new> → importar este repositorio de GitHub.
2. **Root Directory**: `web`. Framework: Next.js (se detecta solo).
3. **Environment Variables** (ver `web/.env.example`):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` de firebaseConfig |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `FIREBASE_SERVICE_ACCOUNT` | contenido **completo** del `.json` de la cuenta de servicio |
| `SETUP_SECRET` | una clave larga inventada por ustedes |

4. **Deploy**. Cada `git push` a `main` vuelve a desplegar automáticamente.

### 3. Crear la organización y el primer administrador
Desde cualquier terminal (PowerShell, la Raspberry, etc.):
```bash
curl -X POST https://<tu-app>.vercel.app/api/v1/setup \
  -H "Content-Type: application/json" -H "x-setup-secret: <SETUP_SECRET>" \
  -d '{"orgId":"org-norte","orgNombre":"Organización Norte","email":"admin@norte.cl","password":"cambiar123"}'
```
Repetir con otro `orgId` para crear una segunda organización (para demostrar el aislamiento). Luego entrar a la web, crear el dispositivo en **Panel → + Nuevo dispositivo** y copiar el **token** que aparece (se muestra una sola vez).

### 4. Raspberry Pi
Requisitos: Raspberry Pi OS Lite 64 bits, Docker y Docker Compose (`curl -fsSL https://get.docker.com | sudo sh`).

```bash
# Driver del kernel para el DHT22 (una sola vez) y reinicio
echo "dtoverlay=dht11,gpiopin=4" | sudo tee -a /boot/firmware/config.txt
sudo reboot

git clone https://github.com/JavierLeivaL/estanque-iot.git
cd estanque-iot/device
cp .env.example .env
nano .env                      # API_URL y DEVICE_TOKEN
docker compose up -d --build   # construye y arranca los 6 contenedores
docker compose ps              # todos deben quedar "healthy"
curl -s localhost:8080 | head  # endpoint de salud local
```
Como Docker está habilitado en systemd y los servicios usan `restart: unless-stopped`, **el sistema se inicia solo al encender la placa**.

### Conexión del hardware

| Sensor | Pin del sensor | Pin físico Raspberry Pi |
|---|---|---|
| HC-SR04 | VCC | 2 (5 V) |
| HC-SR04 | Trig | 16 (GPIO23) |
| HC-SR04 | Echo → **divisor 1 kΩ / 2 kΩ** → | 18 (GPIO24) — la 2 kΩ va a GND (pin 14) |
| HC-SR04 | GND | 6 |
| DHT22 | VCC | 1 (3,3 V) |
| DHT22 | DAT | 7 (GPIO4) |
| DHT22 | GND | 9 |

El Echo del HC-SR04 entrega 5 V; el divisor lo baja a 5 × 2/(1+2) ≈ 3,3 V, el máximo que tolera el GPIO.

---

## API REST

Base: `https://<tu-app>.vercel.app/api/v1` · Especificación completa: [`docs/openapi.yaml`](docs/openapi.yaml)

| Método | Ruta | Autenticación | Descripción |
|---|---|---|---|
| GET | `/health` | — | Estado de la API |
| POST | `/setup` | `x-setup-secret` | Crea organización + administrador |
| POST | `/ingest` | Token de dispositivo | Recibe un lote de resúmenes y eventos; responde con la configuración vigente |
| GET | `/devices` | Usuario | Dispositivos de la organización |
| POST | `/devices` | Admin | Alta de dispositivo; devuelve el token una sola vez |
| GET | `/devices/{id}` | Usuario | Detalle (estado, configuración, salud) |
| PUT | `/devices/{id}/config` | Admin | Cambia la configuración remota |
| POST | `/devices/{id}/token` | Admin | Genera un token nuevo (invalida el anterior) |
| DELETE | `/devices/{id}/token` | Admin | Revoca el token |
| GET | `/devices/{id}/readings?desde=&hasta=` | Usuario | Histórico por rango de fechas (máx. 31 días) |
| GET | `/alerts?deviceId=&limite=` | Usuario | Últimas alertas |
| POST | `/alerts/{id}/ack` | Usuario | Reconoce una alerta |
| GET / POST | `/users` | Admin | Lista / crea usuarios (`admin` o `consulta`) de la organización |

Usuarios: `Authorization: Bearer <ID token de Firebase Auth>`. Dispositivo: `Authorization: Bearer <deviceId>.<secreto>`.

**Ejemplo — ingesta desde la Raspberry**
```http
POST /api/v1/ingest
Authorization: Bearer 8fK2...x9.Qm3v...Zt
Content-Type: application/json

{"v":1,"configVersion":3,"pendientes":0,
 "puntos":[{"t":1761080400,"d":21.4,"nv":18.6,"p":53.1,"tc":22.9,"hr":64.0,"hl":5.2,"nd":12,"na":12,"e":"normal"}],
 "eventos":[{"t":1761080400,"tipo":"lleno","valor":81.2,"umbral":80,"mensaje":"Nivel de llenado sobre el umbral"}],
 "salud":{"cpu_pct":7.5,"mem_pct":21.0,"temp_placa_c":48.2,"servicios":{"nivel":{"ok":true}}}}
```
```json
{"ok":true,"aceptados":{"puntos":1,"eventos":1},"rechazados":0,"escrituras":3,
 "config":{"version":3,"muestreoSeg":5,"envioSeg":60,"alturaSensorCm":40,"distanciaLlenoCm":5,
           "umbralLlenadoPct":80,"umbralTempMaxC":35,"umbralTempMinC":2,
           "sensorNivelActivo":true,"sensorAmbienteActivo":true}}
```

**Ejemplo — cambiar configuración**
```bash
curl -X PUT https://<tu-app>.vercel.app/api/v1/devices/<id>/config \
  -H "Authorization: Bearer <idToken>" -H "Content-Type: application/json" \
  -d '{"muestreoSeg":10,"umbralLlenadoPct":75}'
```

## Arquitectura en capas (web)

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| Presentación | `web/app/*/page.js`, `web/components/` | Páginas React, tiempo real con `onSnapshot` |
| Controladores | `web/app/api/v1/**/route.js` | HTTP: autenticación, parseo y respuesta |
| Lógica de negocio | `web/lib/server/services/` | Validación, tokens, ingesta, históricos, roles |
| Acceso a datos | `web/lib/server/repos/`, `firebaseAdmin.js` | Única capa que habla con Firestore/Auth |

## Seguridad
- La Raspberry **solo inicia conexiones salientes HTTPS**; no hay puertos abiertos ni túneles.
- La Raspberry **no tiene credenciales de Firebase**: solo su token propio, revocable, del que se guarda únicamente el hash SHA-256.
- La cuenta de servicio de Firebase existe solo como variable de entorno en Vercel.
- Security Rules: lectura solo dentro de la propia organización (custom claims `orgId` y `role`); ninguna escritura directa desde el navegador.
- Secretos fuera del repo: `.env`, `device/.env` y `*.json` de credenciales están en `.gitignore`.
