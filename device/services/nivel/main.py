"""Microservicio de ADQUISICIÓN DE NIVEL (HC-SR04).

Responsabilidad única: medir la distancia entre el sensor y la superficie del
contenido del estanque y publicarla en el tópico MQTT `estanque/crudo/nivel`.
No valida, no agrega ni envía a la nube: eso lo hacen otros servicios.

Acceso al hardware: se mapea /dev/gpiochip0 al contenedor (sin modo privilegiado)
y se usa libgpiod v2, que entrega marcas de tiempo del kernel para cada flanco del
pin ECHO (más preciso que medir el pulso por sondeo desde Python).
"""
import json
import logging
import os
import statistics
import threading
import time

import paho.mqtt.client as mqtt

NOMBRE = "nivel"
MQTT_HOST = os.getenv("MQTT_HOST", "broker")
TRIG = int(os.getenv("TRIG_GPIO", "23"))
ECHO = int(os.getenv("ECHO_GPIO", "24"))
CHIP = os.getenv("GPIO_CHIP", "/dev/gpiochip0")
VELOCIDAD_SONIDO_CM_S = 34300.0  # referencia a ~20 °C; procesamiento corrige con la temperatura real
TOPICO_CRUDO = "estanque/crudo/nivel"
TOPICO_CONFIG = "estanque/config"
TOPICO_SALUD = f"estanque/salud/{NOMBRE}"
ARCHIVO_SALUD = "/tmp/healthy"

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s [{NOMBRE}] %(levelname)s %(message)s")
log = logging.getLogger(NOMBRE)

config = {"muestreoSeg": 5, "sensorNivelActivo": True}
config_cambio = threading.Event()


# ---------------------------------------------------------------- hardware
class SensorGpiod:
    """HC-SR04 usando libgpiod v2 (eventos de flanco con timestamp del kernel)."""

    def __init__(self):
        import gpiod
        from gpiod.line import Direction, Edge, Value

        self.Value = Value
        self.gpiod = gpiod
        self.req = gpiod.request_lines(
            CHIP,
            consumer="estanque-nivel",
            config={
                TRIG: gpiod.LineSettings(direction=Direction.OUTPUT, output_value=Value.INACTIVE),
                ECHO: gpiod.LineSettings(direction=Direction.INPUT, edge_detection=Edge.BOTH),
            },
        )

    def medir_cm(self):
        ev_type = self.gpiod.EdgeEvent.Type
        # descartar eventos viejos que hayan quedado en la cola
        while self.req.wait_edge_events(0):
            self.req.read_edge_events()
        self.req.set_value(TRIG, self.Value.ACTIVE)
        time.sleep(0.00001)
        self.req.set_value(TRIG, self.Value.INACTIVE)
        inicio = None
        limite = time.monotonic() + 0.06
        while time.monotonic() < limite:
            if not self.req.wait_edge_events(0.03):
                continue
            for ev in self.req.read_edge_events():
                if ev.event_type == ev_type.RISING_EDGE:
                    inicio = ev.timestamp_ns
                elif ev.event_type == ev_type.FALLING_EDGE and inicio is not None:
                    dur_s = (ev.timestamp_ns - inicio) / 1e9
                    return dur_s * VELOCIDAD_SONIDO_CM_S / 2
        return None


class SensorLgpio:
    """Alternativa con lgpio (sondeo) por si libgpiod v2 no está disponible."""

    def __init__(self):
        import lgpio

        self.lg = lgpio
        self.h = lgpio.gpiochip_open(int(CHIP.replace("/dev/gpiochip", "") or 0))
        lgpio.gpio_claim_output(self.h, TRIG, 0)
        lgpio.gpio_claim_input(self.h, ECHO)

    def medir_cm(self):
        lg, h = self.lg, self.h
        lg.gpio_write(h, TRIG, 1)
        time.sleep(0.00001)
        lg.gpio_write(h, TRIG, 0)
        t = time.perf_counter()
        while lg.gpio_read(h, ECHO) == 0:
            if time.perf_counter() - t > 0.05:
                return None
        ini = time.perf_counter()
        while lg.gpio_read(h, ECHO) == 1:
            if time.perf_counter() - ini > 0.04:
                return None
        return (time.perf_counter() - ini) * VELOCIDAD_SONIDO_CM_S / 2


def abrir_sensor():
    try:
        s = SensorGpiod()
        log.info("Usando libgpiod (TRIG=%s, ECHO=%s)", TRIG, ECHO)
        return s
    except Exception as e:  # noqa: BLE001
        log.warning("libgpiod no disponible (%s); probando lgpio", e)
        s = SensorLgpio()
        log.info("Usando lgpio (TRIG=%s, ECHO=%s)", TRIG, ECHO)
        return s


def medir_con_mediana(sensor, n=5):
    """Toma n mediciones y devuelve la mediana (filtra ecos falsos)."""
    valores = []
    for _ in range(n):
        d = sensor.medir_cm()
        if d is not None:
            valores.append(d)
        time.sleep(0.06)  # el HC-SR04 necesita ~60 ms entre disparos
    if not valores:
        return None, 0
    return statistics.median(valores), len(valores)


# ---------------------------------------------------------------- MQTT
def nuevo_cliente():
    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"estanque-{NOMBRE}")
    except AttributeError:  # paho-mqtt 1.x
        c = mqtt.Client(client_id=f"estanque-{NOMBRE}")
    c.will_set(TOPICO_SALUD, json.dumps({"ok": False, "detalle": "desconectado"}), qos=1, retain=True)

    def on_connect(client, *args):
        client.subscribe(TOPICO_CONFIG, qos=1)
        log.info("Conectado al broker")

    def on_message(client, userdata, msg):
        try:
            nueva = json.loads(msg.payload)
            config.update(nueva)
            config_cambio.set()  # despierta el ciclo para aplicar la configuración sin reiniciar
            log.info("Configuración aplicada: muestreo=%ss activo=%s", config.get("muestreoSeg"), config.get("sensorNivelActivo"))
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
    sensor = abrir_sensor()
    cliente = nuevo_cliente()
    cliente.connect_async(MQTT_HOST, 1883, keepalive=30)
    cliente.loop_start()
    fallas = 0
    while True:
        intervalo = max(1.0, float(config.get("muestreoSeg", 5)))
        if config.get("sensorNivelActivo", True):
            d, n = medir_con_mediana(sensor)
            if d is not None:
                fallas = 0
                cliente.publish(TOPICO_CRUDO, json.dumps({"ts": time.time(), "distancia_cm": round(d, 2), "muestras": n}), qos=1)
                latido(cliente, True, f"ultima={d:.1f}cm")
            else:
                fallas += 1
                latido(cliente, fallas < 10, f"sin eco ({fallas} seguidas)")
        else:
            latido(cliente, True, "sensor desactivado por configuración")
        config_cambio.wait(intervalo)
        config_cambio.clear()


if __name__ == "__main__":
    main()
