"""Microservicio de ADQUISICIÓN AMBIENTAL (DHT22 / DHT11).

Responsabilidad única: leer temperatura y humedad del aire del estanque y publicarlas
en `estanque/crudo/ambiente`.

Acceso al hardware: el protocolo del DHT exige tiempos de microsegundos, así que lo
maneja el driver del kernel (overlay `dtoverlay=dht11,gpiopin=4`, que sirve para DHT11
y DHT22). El contenedor solo lee los valores desde /sys/bus/iio (sysfs, solo lectura),
por lo que no necesita modo privilegiado ni acceso directo al GPIO.
"""
import glob
import json
import logging
import os
import threading
import time

import paho.mqtt.client as mqtt

NOMBRE = "ambiente"
MQTT_HOST = os.getenv("MQTT_HOST", "broker")
PREFIJO_IIO = os.getenv("IIO_NOMBRE", "dht11")
TOPICO_CRUDO = "estanque/crudo/ambiente"
TOPICO_CONFIG = "estanque/config"
TOPICO_SALUD = f"estanque/salud/{NOMBRE}"
ARCHIVO_SALUD = "/tmp/healthy"
INTERVALO_MIN = 3.0  # el DHT22 no admite más de una lectura cada ~2 s

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s [{NOMBRE}] %(levelname)s %(message)s")
log = logging.getLogger(NOMBRE)

config = {"muestreoSeg": 5, "sensorAmbienteActivo": True}
config_cambio = threading.Event()


def buscar_dispositivo():
    for ruta in glob.glob("/sys/bus/iio/devices/iio:device*"):
        try:
            with open(os.path.join(ruta, "name")) as f:
                if f.read().strip().startswith(PREFIJO_IIO):
                    return ruta
        except OSError:
            continue
    return None


def leer_valor(ruta, archivo):
    with open(os.path.join(ruta, archivo)) as f:
        return int(f.read().strip()) / 1000.0


def leer(ruta, intentos=3):
    """Lee temp y humedad; el sensor falla a veces, por eso se reintenta."""
    ultimo_error = None
    for i in range(intentos):
        try:
            temp = leer_valor(ruta, "in_temp_input")
            hum = leer_valor(ruta, "in_humidityrelative_input")
            return temp, hum, i + 1
        except OSError as e:
            ultimo_error = e
            time.sleep(2.2)
    raise ultimo_error


def nuevo_cliente():
    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"estanque-{NOMBRE}")
    except AttributeError:
        c = mqtt.Client(client_id=f"estanque-{NOMBRE}")
    c.will_set(TOPICO_SALUD, json.dumps({"ok": False, "detalle": "desconectado"}), qos=1, retain=True)

    def on_connect(client, *args):
        client.subscribe(TOPICO_CONFIG, qos=1)
        log.info("Conectado al broker")

    def on_message(client, userdata, msg):
        try:
            config.update(json.loads(msg.payload))
            config_cambio.set()
            log.info("Configuración aplicada: muestreo=%ss activo=%s", config.get("muestreoSeg"), config.get("sensorAmbienteActivo"))
        except Exception as e:  # noqa: BLE001
            log.error("Configuración inválida: %s", e)

    c.on_connect = on_connect
    c.on_message = on_message
    c.reconnect_delay_set(1, 30)
    return c


def latido(cliente, ok, detalle):
    cliente.publish(TOPICO_SALUD, json.dumps({"ok": ok, "ts": time.time(), "detalle": detalle}), qos=0, retain=True)
    with open(ARCHIVO_SALUD, "w") as f:
        f.write(str(time.time()))


def main():
    cliente = nuevo_cliente()
    cliente.connect_async(MQTT_HOST, 1883, keepalive=30)
    cliente.loop_start()
    ruta = None
    fallas = 0
    while True:
        intervalo = max(INTERVALO_MIN, float(config.get("muestreoSeg", 5)))
        if not config.get("sensorAmbienteActivo", True):
            latido(cliente, True, "sensor desactivado por configuración")
        else:
            ruta = ruta or buscar_dispositivo()
            if ruta is None:
                latido(cliente, False, "driver dht11 no encontrado en /sys/bus/iio (revisar dtoverlay)")
            else:
                try:
                    temp, hum, intentos = leer(ruta)
                    fallas = 0
                    cliente.publish(TOPICO_CRUDO, json.dumps({"ts": time.time(), "temp_c": temp, "hum_pct": hum, "intentos": intentos}), qos=1)
                    latido(cliente, True, f"ultima={temp:.1f}C {hum:.1f}%")
                except OSError as e:
                    fallas += 1
                    latido(cliente, fallas < 10, f"error de lectura ({fallas} seguidas): {e.strerror or e}")
        config_cambio.wait(intervalo)
        config_cambio.clear()


if __name__ == "__main__":
    main()
