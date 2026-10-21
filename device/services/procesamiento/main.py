"""Microservicio de PROCESAMIENTO.

Responsabilidad única: transformar lecturas crudas en información útil.
  1. Valida y filtra lecturas (rangos físicos del sensor y saltos bruscos).
  2. Combina los sensores:
       - Corrige la distancia del HC-SR04 con la temperatura del DHT
         (la velocidad del sonido cambia ~0,6 m/s por cada °C).
       - Calcula el nivel de llenado (%) con la geometría configurada.
       - Proyecta en cuántas horas se llenará (regresión lineal de los últimos 30 min).
       - Determina el estado del estanque cruzando llenado y temperatura.
  3. Agrega por minuto: publica UN resumen por minuto en `estanque/agregado`
     (en vez de una lectura cada 5 s -> ~12 veces menos datos hacia la nube).
  4. Detecta eventos (umbral superado / normalizado / sensor sin datos) y los
     publica en `estanque/eventos`.
"""
import json
import logging
import os
import statistics
import threading
import time
from collections import deque
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

NOMBRE = "procesamiento"
MQTT_HOST = os.getenv("MQTT_HOST", "broker")
TOPICO_SALUD = f"estanque/salud/{NOMBRE}"
ARCHIVO_SALUD = "/tmp/healthy"
V_REF = 343.0  # m/s usado por el microservicio de nivel

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s [{NOMBRE}] %(levelname)s %(message)s")
log = logging.getLogger(NOMBRE)

config = {
    "alturaSensorCm": 40.0,      # distancia del sensor al fondo (estanque vacío)
    "distanciaLlenoCm": 5.0,     # distancia del sensor a la superficie cuando está lleno
    "umbralLlenadoPct": 80.0,
    "umbralTempMaxC": 35.0,
    "umbralTempMinC": 2.0,
}
lock = threading.Lock()
ventanas = {}  # minuto (epoch/60) -> {"d": [...], "t": [...], "h": [...]}
historial_llenado = deque(maxlen=60)  # (epoch_minuto, pct)
ultima_temp = {"valor": None, "ts": 0.0}
estado_actual = {"estado": "normal"}
ultimo_dato = {"nivel": time.time(), "ambiente": time.time()}
sin_datos_reportado = {"nivel": False, "ambiente": False}


def velocidad_sonido(temp_c):
    return 331.3 + 0.606 * temp_c


def ventana(minuto):
    return ventanas.setdefault(minuto, {"d": [], "t": [], "h": []})


# ---------------------------------------------------------------- validación
def procesar_nivel(m):
    d = float(m["distancia_cm"])
    if not (2.5 <= d <= 400):  # zona ciega y alcance máximo del HC-SR04
        return
    ultimo_dato["nivel"] = time.time()
    with lock:
        ventana(int(m["ts"] // 60))["d"].append(d)


def procesar_ambiente(m):
    t, h = float(m["temp_c"]), float(m["hum_pct"])
    if not (-40 <= t <= 80 and 0 <= h <= 100):
        return
    previa = ultima_temp["valor"]
    if previa is not None and time.time() - ultima_temp["ts"] < 120 and abs(t - previa) > 8:
        log.warning("Salto de temperatura descartado: %.1f -> %.1f", previa, t)
        return
    ultima_temp.update(valor=t, ts=time.time())
    ultimo_dato["ambiente"] = time.time()
    with lock:
        w = ventana(int(m["ts"] // 60))
        w["t"].append(t)
        w["h"].append(h)


# ---------------------------------------------------------------- combinación
def horas_para_llenar(pct_actual):
    """Pendiente (%/min) por mínimos cuadrados con los últimos 30 minutos."""
    puntos = [(t, p) for t, p in historial_llenado if t >= historial_llenado[-1][0] - 30]
    if len(puntos) < 5:
        return None
    xs = [t for t, _ in puntos]
    ys = [p for _, p in puntos]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return None
    pendiente = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    if pendiente <= 0.01:  # vaciándose o estable
        return None
    return round((100 - pct_actual) / pendiente / 60, 1)


def evaluar_estado(pct, temp):
    if pct is not None and pct >= config["umbralLlenadoPct"]:
        return "lleno"
    if temp is not None and temp >= config["umbralTempMaxC"]:
        return "temp_alta"
    if temp is not None and temp <= config["umbralTempMinC"]:
        return "temp_baja"
    return "normal"


MENSAJES = {
    "lleno": "Nivel de llenado sobre el umbral: vaciar o dejar de llenar",
    "temp_alta": "Temperatura sobre el máximo configurado",
    "temp_baja": "Temperatura bajo el mínimo (riesgo de congelamiento)",
    "normal": "Condición normalizada",
}


def cerrar_minuto(cliente, minuto, w):
    temp = round(statistics.fmean(w["t"]), 2) if w["t"] else None
    hum = round(statistics.fmean(w["h"]), 2) if w["h"] else None
    punto = {"t": minuto * 60, "tc": temp, "hr": hum, "nd": len(w["d"]), "na": len(w["t"])}
    pct = None
    if w["d"]:
        d = statistics.median(w["d"])
        t_ref = temp if temp is not None else (ultima_temp["valor"] if time.time() - ultima_temp["ts"] < 600 else None)
        if t_ref is not None:
            d = d * velocidad_sonido(t_ref) / V_REF  # compensación por temperatura
        alto = float(config["alturaSensorCm"])
        lleno = float(config["distanciaLlenoCm"])
        pct = (alto - d) / max(alto - lleno, 1e-6) * 100
        pct = round(min(100.0, max(0.0, pct)), 1)
        punto.update(d=round(d, 1), nv=round(max(0.0, alto - d), 1), p=pct)
        historial_llenado.append((minuto, pct))
        punto["hl"] = horas_para_llenar(pct)
    estado = evaluar_estado(pct, temp)
    punto["e"] = estado
    cliente.publish("estanque/agregado", json.dumps(punto), qos=1)
    log.info("Minuto %s: %s", datetime.fromtimestamp(minuto * 60, timezone.utc).strftime("%H:%M"), punto)

    if estado != estado_actual["estado"]:
        tipo = estado if estado != "normal" else "normalizado"
        valor = pct if estado == "lleno" else temp
        umbral = {
            "lleno": config["umbralLlenadoPct"],
            "temp_alta": config["umbralTempMaxC"],
            "temp_baja": config["umbralTempMinC"],
        }.get(estado)
        evento = {"t": minuto * 60, "tipo": tipo, "valor": valor, "umbral": umbral,
                  "mensaje": MENSAJES[estado], "anterior": estado_actual["estado"]}
        cliente.publish("estanque/eventos", json.dumps(evento), qos=1)
        log.warning("EVENTO %s", evento)
        estado_actual["estado"] = estado


def revisar_sensores(cliente):
    for sensor in ("nivel", "ambiente"):
        sin_datos = time.time() - ultimo_dato[sensor] > 300
        if sin_datos and not sin_datos_reportado[sensor]:
            cliente.publish("estanque/eventos", json.dumps({
                "t": int(time.time()), "tipo": f"sin_datos_{sensor}", "valor": None, "umbral": None,
                "mensaje": f"El sensor de {sensor} no entrega lecturas válidas hace más de 5 minutos"}), qos=1)
            sin_datos_reportado[sensor] = True
        elif not sin_datos:
            sin_datos_reportado[sensor] = False


def ciclo_cierre(cliente):
    """Cierra los minutos terminados (con 5 s de margen para lecturas atrasadas)."""
    while True:
        minuto_actual = int((time.time() - 5) // 60)
        with lock:
            cerrados = sorted(m for m in ventanas if m < minuto_actual)
            listos = [(m, ventanas.pop(m)) for m in cerrados]
        for m, w in listos:
            if w["d"] or w["t"]:
                cerrar_minuto(cliente, m, w)
        revisar_sensores(cliente)
        cliente.publish(TOPICO_SALUD, json.dumps({"ok": True, "ts": time.time(), "detalle": f"estado={estado_actual['estado']}"}), retain=True)
        with open(ARCHIVO_SALUD, "w") as f:
            f.write(str(time.time()))
        time.sleep(5)


def main():
    try:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"estanque-{NOMBRE}")
    except AttributeError:
        c = mqtt.Client(client_id=f"estanque-{NOMBRE}")
    c.will_set(TOPICO_SALUD, json.dumps({"ok": False, "detalle": "desconectado"}), qos=1, retain=True)

    def on_connect(client, *args):
        client.subscribe([("estanque/crudo/#", 1), ("estanque/config", 1)])
        log.info("Conectado al broker")

    def on_message(client, userdata, msg):
        try:
            datos = json.loads(msg.payload)
            if msg.topic == "estanque/crudo/nivel":
                procesar_nivel(datos)
            elif msg.topic == "estanque/crudo/ambiente":
                procesar_ambiente(datos)
            elif msg.topic == "estanque/config":
                config.update({k: v for k, v in datos.items() if k in config})
                log.info("Configuración aplicada: %s", config)
        except Exception as e:  # noqa: BLE001
            log.error("Mensaje inválido en %s: %s", msg.topic, e)

    c.on_connect = on_connect
    c.on_message = on_message
    c.reconnect_delay_set(1, 30)
    c.connect_async(MQTT_HOST, 1883, keepalive=30)
    c.loop_start()
    ciclo_cierre(c)


if __name__ == "__main__":
    main()
