"""Microservicio de SALUD.

Responsabilidad única: informar el estado del dispositivo.
  - Escucha los latidos que cada microservicio publica en `estanque/salud/<servicio>`.
  - Mide CPU, memoria, disco y temperatura de la placa.
  - Publica un resumen en `estanque/salud/resumen` (sincronización lo adjunta a cada
    lote, así la plataforma web muestra el estado de los microservicios).
  - Expone un endpoint HTTP local: http://127.0.0.1:8080/ (solo accesible desde la
    propia Raspberry; el puerto no se publica hacia la red).
"""
import json
import logging
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import paho.mqtt.client as mqtt

NOMBRE = "salud"
MQTT_HOST = os.getenv("MQTT_HOST", "broker")
SERVICIOS = ["nivel", "ambiente", "procesamiento", "sincronizacion"]
ARCHIVO_SALUD = "/tmp/healthy"

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s [{NOMBRE}] %(levelname)s %(message)s")
log = logging.getLogger(NOMBRE)

latidos = {}
resumen = {}
broker = {"conectado": False}
cpu_previo = {"total": 0, "ocioso": 0}


def leer_cpu_pct():
    with open("/proc/stat") as f:
        valores = [int(x) for x in f.readline().split()[1:]]
    ocioso, total = valores[3] + valores[4], sum(valores)
    d_total, d_ocioso = total - cpu_previo["total"], ocioso - cpu_previo["ocioso"]
    cpu_previo.update(total=total, ocioso=ocioso)
    return round(100 * (1 - d_ocioso / d_total), 1) if d_total > 0 else None


def leer_memoria_pct():
    info = {}
    with open("/proc/meminfo") as f:
        for linea in f:
            k, v = linea.split(":")
            info[k] = int(v.split()[0])
    return round(100 * (1 - info["MemAvailable"] / info["MemTotal"]), 1)


def leer_temp_placa():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read()) / 1000, 1)
    except OSError:
        return None


def calcular_resumen():
    ahora = time.time()
    servicios = {"broker": {"ok": broker["conectado"], "hace_s": 0, "detalle": "mosquitto"}}
    for s in SERVICIOS:
        l = latidos.get(s)
        if l is None:
            servicios[s] = {"ok": False, "hace_s": None, "detalle": "sin latido"}
        else:
            hace = round(ahora - l["recibido"])
            servicios[s] = {"ok": bool(l.get("ok")) and hace < 90, "hace_s": hace, "detalle": str(l.get("detalle", ""))[:120]}
    disco = shutil.disk_usage("/")
    with open("/proc/uptime") as f:
        uptime = int(float(f.read().split()[0]))
    return {
        "ts": int(ahora), "cpu_pct": leer_cpu_pct(), "mem_pct": leer_memoria_pct(),
        "temp_placa_c": leer_temp_placa(), "disco_pct": round(100 * disco.used / disco.total, 1),
        "uptime_s": uptime, "servicios": servicios,
        "todos_ok": all(v["ok"] for v in servicios.values()),
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        cuerpo = json.dumps(resumen or calcular_resumen(), indent=2, ensure_ascii=False).encode()
        self.send_response(200 if resumen.get("todos_ok") else 503)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, *args):
        pass


def main():
    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"estanque-{NOMBRE}")
    except AttributeError:
        c = mqtt.Client(client_id=f"estanque-{NOMBRE}")

    def on_connect(client, *args):
        broker["conectado"] = True
        client.subscribe("estanque/salud/+", qos=0)
        log.info("Conectado al broker")

    def on_disconnect(client, *args):
        broker["conectado"] = False

    def on_message(client, userdata, msg):
        servicio = msg.topic.rsplit("/", 1)[-1]
        if servicio == "resumen":
            return
        try:
            latidos[servicio] = {**json.loads(msg.payload), "recibido": time.time()}
        except ValueError:
            pass

    c.on_connect = on_connect
    c.on_disconnect = on_disconnect
    c.on_message = on_message
    c.reconnect_delay_set(1, 30)
    c.connect_async(MQTT_HOST, 1883, keepalive=30)
    c.loop_start()

    servidor = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    log.info("Endpoint de salud en :8080")

    while True:
        resumen.clear()
        resumen.update(calcular_resumen())
        c.publish("estanque/salud/resumen", json.dumps(resumen), qos=0, retain=True)
        with open(ARCHIVO_SALUD, "w") as f:
            f.write(str(time.time()))
        time.sleep(30)


if __name__ == "__main__":
    main()
