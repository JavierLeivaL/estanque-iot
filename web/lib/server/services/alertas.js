// LÓGICA DE NEGOCIO: alertas por umbral generadas en el dispositivo.
import { ErrorApi } from "../http";
import * as repo from "../repos/alertas";

const vista = (a) => ({ ...a, ts: a.ts?.toDate?.().toISOString() ?? a.ts, reconocidaEn: a.reconocidaEn?.toDate?.().toISOString() ?? null });

export async function listar(usuario, { deviceId, limite }) {
  const n = Math.min(200, Math.max(1, Number(limite) || 50));
  const lista = await repo.listar(usuario.orgId, n);
  return lista.filter((a) => !deviceId || a.deviceId === deviceId).map(vista);
}

export async function reconocer(usuario, id) {
  const a = await repo.obtener(usuario.orgId, id);
  if (!a) throw new ErrorApi(404, "Alerta no encontrada");
  await repo.actualizar(usuario.orgId, id, { reconocida: true, reconocidaPor: usuario.email, reconocidaEn: new Date() });
  return { ok: true };
}
