// LÓGICA DE NEGOCIO: consulta de históricos por rango de fechas.
// Costo en Firestore: 1 lectura por cada HORA del rango (24 lecturas por día consultado),
// en lugar de 1 lectura por cada minuto (1.440 por día).
import { ErrorApi } from "../http";
import * as repo from "../repos/dispositivos";
import { obtenerDeOrg } from "./dispositivos";

const MAX_DIAS = 31;
const MAX_PUNTOS_RESPUESTA = 1500;

/** Reduce la cantidad de puntos promediando grupos consecutivos (para gráficos). */
function reducir(puntos, max) {
  if (puntos.length <= max) return puntos;
  const tam = Math.ceil(puntos.length / max);
  const salida = [];
  for (let i = 0; i < puntos.length; i += tam) {
    const g = puntos.slice(i, i + tam);
    const prom = (k) => {
      const v = g.map((x) => x[k]).filter((x) => typeof x === "number");
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
    };
    salida.push({ t: g[0].t, p: prom("p"), nv: prom("nv"), d: prom("d"), tc: prom("tc"), hr: prom("hr"), e: g[g.length - 1].e });
  }
  return salida;
}

export async function historico(usuario, id, desdeIso, hastaIso) {
  await obtenerDeOrg(usuario, id);
  const hasta = hastaIso ? Date.parse(hastaIso) : Date.now();
  const desde = desdeIso ? Date.parse(desdeIso) : hasta - 24 * 3600e3;
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || desde >= hasta)
    throw new ErrorApi(400, "Rango inválido: use ?desde=ISO&hasta=ISO con desde < hasta");
  if (hasta - desde > MAX_DIAS * 86400e3) throw new ErrorApi(400, `El rango máximo es de ${MAX_DIAS} días`);

  const horas = await repo.leerHoras(id, Math.floor(desde / 3600e3) * 3600e3, hasta);
  const puntos = [];
  for (const h of horas) {
    const base = h.hora.toMillis() / 1000;
    for (const [mm, p] of Object.entries(h.m || {})) {
      const t = base + Number(mm) * 60;
      if (t * 1000 >= desde && t * 1000 <= hasta) puntos.push({ t, ...p });
    }
  }
  puntos.sort((a, b) => a.t - b.t);
  return {
    desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString(),
    documentosLeidos: horas.length, puntosTotales: puntos.length,
    puntos: reducir(puntos, MAX_PUNTOS_RESPUESTA),
  };
}
