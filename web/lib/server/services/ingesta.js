// LÓGICA DE NEGOCIO: recepción de lotes enviados por la Raspberry Pi.
//  - Autentica el dispositivo con su token (1 lectura).
//  - Valida cada punto y evento.
//  - Agrupa los resúmenes por minuto en documentos por HORA: devices/{id}/horas/{AAAAMMDDHH}
//    con un mapa m.{MM}. Un reenvío del mismo minuto escribe en la misma clave => sin duplicados.
//  - Devuelve la configuración vigente (así el dispositivo no necesita otra llamada).
import { ErrorApi } from "../http";
import * as repo from "../repos/dispositivos";
import { configPorDefecto } from "@/lib/shared/config";
import { coincide, separarToken } from "./tokens";

const ESTADOS = new Set(["normal", "lleno", "temp_alta", "temp_baja"]);
const TIPOS_EVENTO = new Set(["lleno", "temp_alta", "temp_baja", "normalizado", "sin_datos_nivel", "sin_datos_ambiente"]);
const MAX_PUNTOS = 500;
const MAX_EVENTOS = 100;

const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const ent = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

function validarPunto(p, ahoraS) {
  if (!p || typeof p !== "object") return null;
  const t = ent(p.t, ahoraS - 60 * 86400, ahoraS + 600);
  if (t === null || t % 60 !== 0) return null;
  const punto = {
    d: num(p.d, 0, 500), nv: num(p.nv, 0, 500), p: num(p.p, 0, 100),
    tc: num(p.tc, -40, 85), hr: num(p.hr, 0, 100), hl: num(p.hl, 0, 100000),
    nd: ent(p.nd, 0, 10000) ?? 0, na: ent(p.na, 0, 10000) ?? 0,
    e: ESTADOS.has(p.e) ? p.e : "normal",
  };
  if (punto.p === null && punto.tc === null) return null; // sin datos útiles
  return { t, punto };
}

function validarEvento(e, ahoraS) {
  if (!e || typeof e !== "object" || !TIPOS_EVENTO.has(e.tipo)) return null;
  const t = ent(e.t, ahoraS - 60 * 86400, ahoraS + 600);
  if (t === null) return null;
  return {
    t, tipo: e.tipo, valor: num(e.valor, -1000, 100000), umbral: num(e.umbral, -1000, 100000),
    mensaje: String(e.mensaje || "").slice(0, 200),
  };
}

const dos = (n) => String(n).padStart(2, "0");

export async function ingerir(token, cuerpo) {
  const partes = separarToken(token);
  if (!partes) throw new ErrorApi(401, "Token de dispositivo ausente o mal formado");
  const dispositivo = await repo.obtener(partes.deviceId);
  if (!dispositivo || dispositivo.tokenRevocado || !coincide(partes.secreto, dispositivo.tokenHash))
    throw new ErrorApi(401, "Token de dispositivo inválido o revocado");

  if (!cuerpo || typeof cuerpo !== "object") throw new ErrorApi(400, "Cuerpo inválido");
  const puntosIn = Array.isArray(cuerpo.puntos) ? cuerpo.puntos : [];
  const eventosIn = Array.isArray(cuerpo.eventos) ? cuerpo.eventos : [];
  if (puntosIn.length > MAX_PUNTOS || eventosIn.length > MAX_EVENTOS)
    throw new ErrorApi(413, `Máximo ${MAX_PUNTOS} puntos y ${MAX_EVENTOS} eventos por lote`);

  const ahoraS = Math.floor(Date.now() / 1000);
  const porHora = new Map();
  let rechazados = 0;
  let puntosOk = 0;
  let ultimo = null;
  for (const p of puntosIn) {
    const v = validarPunto(p, ahoraS);
    if (!v) { rechazados++; continue; }
    const f = new Date(v.t * 1000);
    const horaId = `${f.getUTCFullYear()}${dos(f.getUTCMonth() + 1)}${dos(f.getUTCDate())}${dos(f.getUTCHours())}`;
    if (!porHora.has(horaId)) {
      const inicio = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours());
      porHora.set(horaId, { horaId, inicioMs: inicio, minutos: {} });
    }
    porHora.get(horaId).minutos[dos(f.getUTCMinutes())] = v.punto;
    puntosOk++;
    if (!ultimo || v.t > ultimo.t) ultimo = { t: v.t, ...v.punto };
  }

  const alertas = [];
  for (const e of eventosIn) {
    const v = validarEvento(e, ahoraS);
    if (!v) { rechazados++; continue; }
    alertas.push({
      id: `${dispositivo.id}_${v.t}_${v.tipo}`, // id determinista => reenvíos no duplican
      datos: { ...v, ts: new Date(v.t * 1000), deviceId: dispositivo.id, deviceNombre: dispositivo.nombre, orgId: dispositivo.orgId },
    });
  }

  const cambios = {
    pendientes: ent(cuerpo.pendientes, 0, 1e7) ?? 0,
    appVersion: String(cuerpo.app || "").slice(0, 20),
  };
  if (cuerpo.salud && typeof cuerpo.salud === "object") cambios.salud = JSON.parse(JSON.stringify(cuerpo.salud).slice(0, 5000))
  if (ultimo && (!dispositivo.ultimaLectura || ultimo.t >= dispositivo.ultimaLectura.t)) cambios.ultimaLectura = ultimo;

  const escrituras = await repo.guardarIngesta({ dispositivo, buckets: [...porHora.values()], alertas, cambiosDispositivo: cambios });

  return {
    ok: true,
    aceptados: { puntos: puntosOk, eventos: alertas.length },
    rechazados,
    escrituras,
    config: { ...configPorDefecto(), ...dispositivo.config, version: dispositivo.configVersion || 1 },
  };
}
