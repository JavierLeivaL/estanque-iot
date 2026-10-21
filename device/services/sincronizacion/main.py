"""Microservicio de SINCRONIZACIÓN con la nube.

Responsabilidad única: mover datos entre el dispositivo y la API en Vercel.
  - Recibe los resúmenes por minuto (`estanque/agregado`) y los eventos
    (`estanque/eventos`) y los guarda primero en un buffer local SQLite.
  - Cada `envioSeg` segundos envía un LOTE por HTTPS (solo conexiones salientes)
    a POST {API_URL}/api/v1/ingest, autenticado con el token del dispositivo.
  - Si no hay Internet, los datos quedan en SQLite y se reenvían al reconectar.
    No hay duplicados: cada punto tiene una clave única (su minuto) y en la nube
    se guarda en una posición fija, por lo que reenviarlo lo sobrescribe.
  - La respuesta de la API trae la configuración vigente del dispositivo; si cambió,
    se publica (retenida) en `estanque/config` y los demás servicios la aplican
    sin reiniciarse. La última configuración también se guarda en SQLite.
"""
import json
import logging
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request

import paho.mqtt.client as mqtt

NOMBRE = "sincronizacion"
MQTT_HOST = os.getenv("MQTT_HOST", "broker")
API_URL = os.getenv("API_URL", "").rstrip("/")
TOKEN = os.getenv("DEVICE_TOKEN", "")
DB_PATH = os.getenv("DB_PATH", "/data/buffer.db")
TOPICO_SALUD = f"estanque/salud/{NOMBRE}"
ARCHIVO_SALUD = "/tmp/healthy"
MAX_LOTE = 300
MAX_PENDIENTES = 50000  # ~34 días de resúmenes por minuto
VERSION_APP = "1.0.0"

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s [{NOMBRE}] %(levelname)s %(message)s")
log = logging.getLogger(NOMBRE)

CONFIG_DEFECTO = {
    "version": 0, "muestreoSeg": 5, "envioSeg": 60,
    "alturaSensorCm": 40, "distanciaLlenoCm": 5,
    "umbralLlenadoPct": 80, "umbralTempMaxC": 35, "umbralTempMinC": 2,
    "sensorNivelActivo": True, "sensorAmbienteActivo": True,
}

db_lock = threading.Lock()
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.execute("PRAGMA journal_mode=WAL")
db.execute("CREATE TABLE IF NOT EXISTS pendientes (clave TEXT PRIMARY KEY, tipo TEXT NOT NULL, payload TEXT NOT NULL, creado REAL NOT NULL)")
db.execute("CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)")
db.commit()

estado = {"ultimo_envio_ok": None, "ultimo_error": None, "salud": None, "enviados_total": 0, "lotes_total": 0}


def cargar_config():
    fila = db.execute("SELECT json FROM config WHERE id = 1").fetchone()
    return {**CONFIG_DEFECTO, **json.loads(fila[0])} if fila else dict(CONFIG_DEFECTO)


config = cargar_config()


def guardar_pendiente(clave, tipo, payload, reemplazar):
    verbo = "INSERT OR REPLACE" if reemplazar else "INSERT OR IGNORE"
    with db_lock:
        db.execute(f"{verbo} INTO pendientes (clave, tipo, payload, creado) VALUES (?, ?, ?, ?)",
                   (clave, tipo, payload, time.time()))
        # política de retención local: si el buffer crece demasiado se descarta lo más antiguo
        db.execute("DELETE FROM pendientes WHERE clave IN (SELECT clave FROM pendientes ORDER BY creado ASC "
                   "LIMIT MAX(0, (SELECT COUNT(*) FROM pendientes) - ?))", (MAX_PENDIENTES,))
        db.commit()


def contar_pendientes():
    with db_lock:
        return db.execute("SELECT COUNT(*) FROM pendientes").fetchone()[0]


def publicar_config(cliente):
    cliente.publish("estanque/config", json.dumps(config), qos=1, retain=True)


def enviar_lote(cliente):
    with db_lock:
        filas = db.execute("SELECT clave, tipo, payload FROM pendientes ORDER BY creado ASC LIMIT ?", (MAX_LOTE,)).fetchall()
    puntos = [json.loads(p) for _, t, p in filas if t == "punto"]
    eventos = [json.loads(p) for _, t, p in filas if t == "evento"]
    cuerpo = json.dumps({
        "v": 1, "app": VERSION_APP, "configVersion": config.get("version", 0),
        "puntos": puntos, "eventos": eventos, "salud": estado["salud"],
        "pendientes": max(0, contar_pendientes() - len(filas)),
    }).encode()
    req = urllib.request.Request(f"{API_URL}/api/v1/ingest", data=cuerpo, method="POST", headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": f"estanque-iot/{VERSION_APP}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        respuesta = json.loads(r.read() or b"{}")
    with db_lock:
        db.executemany("DELETE FROM pendientes WHERE clave = ?", [(c,) for c, _, _ in filas])
        db.commit()
    estado["enviados_total"] += len(filas)
    estado["lotes_total"] += 1
    nueva = respuesta.get("config")
    if isinstance(nueva, dict) and nueva.get("version") != config.get("version"):
        config.clear()
        config.update({**CONFIG_DEFECTO, **nueva})
        with db_lock:
            db.execute("INSERT OR REPLACE INTO config (id, json) VALUES (1, ?)", (json.dumps(config),))
            db.commit()
        publicar_config(cliente)
        log.info("Nueva configuración v%s recibida y publicada", config.get("version"))
    return len(filas)


def latido(cliente, ok, detalle):
    cliente.publish(TOPICO_SALUD, json.dumps({"ok": ok, "ts": time.time(), "detalle": detalle}), retain=True)
    with open(ARCHIVO_SALUD, "w") as f:
        f.write(str(time.time()))


def ciclo_envio(cliente):
    espera_error = 0
    ultimo_intento = 0.0
    while True:
        intervalo = max(10, int(config.get("envioSeg", 60)))
        pendientes = contar_pendientes()
        toca = time.time() - ultimo_intento >= (espera_error or intervalo)
        if toca and API_URL and TOKEN and (pendientes > 0 or time.time() - ultimo_intento > 300):
            ultimo_intento = time.time()
            try:
                n = enviar_lote(cliente)
                estado["ultimo_envio_ok"] = time.time()
                estado["ultimo_error"] = None
                espera_error = 0
                if n:
                    log.info("Lote enviado: %s registros (quedan %s)", n, contar_pendientes())
                if contar_pendientes() >= MAX_LOTE:
                    ultimo_intento = 0  # hay atraso: enviar el siguiente lote de inmediato
            except urllib.error.HTTPError as e:
                detalle = e.read()[:200].decode(errors="replace")
                estado["ultimo_error"] = f"HTTP {e.code}: {detalle}"
                espera_error = min(300, max(intervalo, espera_error * 2 or intervalo))
                log.error("La API respondió %s: %s", e.code, detalle)
            except Exception as e:  # noqa: BLE001  (sin red, DNS, timeout...)
                estado["ultimo_error"] = str(e)
                espera_error = min(300, max(intervalo, espera_error * 2 or intervalo))
                log.warning("Sin conexión con la API (%s). %s registros en buffer local", e, pendientes)
        en_linea = estado["ultimo_envio_ok"] is not None and estado["ultimo_error"] is None
        latido(cliente, bool(API_URL and TOKEN), f"en_linea={en_linea} pendientes={contar_pendientes()}"
               + (f" error={estado['ultimo_error'][:80]}" if estado["ultimo_error"] else ""))
        time.sleep(2)


def main():
    if not API_URL or not TOKEN:
        log.error("Faltan API_URL o DEVICE_TOKEN en device/.env: los datos se acumularán localmente")
    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"estanque-{NOMBRE}")
    except AttributeError:
        c = mqtt.Client(client_id=f"estanque-{NOMBRE}")
    c.will_set(TOPICO_SALUD, json.dumps({"ok": False, "detalle": "desconectado"}), qos=1, retain=True)

    def on_connect(client, *args):
        client.subscribe([("estanque/agregado", 1), ("estanque/eventos", 1), ("estanque/salud/resumen", 0)])
        publicar_config(client)  # al arrancar, los demás servicios reciben la última config conocida
        log.info("Conectado al broker. Config v%s publicada", config.get("version"))

    def on_message(client, userdata, msg):
        try:
            datos = json.loads(msg.payload)
            if msg.topic == "estanque/agregado":
                guardar_pendiente(f"p:{int(datos['t'])}", "punto", msg.payload.decode(), reemplazar=True)
            elif msg.topic == "estanque/eventos":
                guardar_pendiente(f"e:{int(datos['t'])}:{datos['tipo']}", "evento", msg.payload.decode(), reemplazar=False)
            elif msg.topic == "estanque/salud/resumen":
                estado["salud"] = datos
        except Exception as e:  # noqa: BLE001
            log.error("Mensaje inválido en %s: %s", msg.topic, e)

    c.on_connect = on_connect
    c.on_message = on_message
    c.reconnect_delay_set(1, 30)
    c.connect_async(MQTT_HOST, 1883, keepalive=30)
    c.loop_start()
    ciclo_envio(c)


if __name__ == "__main__":
    main()
