// LÓGICA DE NEGOCIO: gestión de dispositivos (alta, token, configuración, estado).
import { FieldValue } from "firebase-admin/firestore";
import { ErrorApi } from "../http";
import * as repo from "../repos/dispositivos";
import { configPorDefecto, validarConfig } from "@/lib/shared/config";
import { generarToken } from "./tokens";

/** Convierte el documento de Firestore en la vista pública (sin el hash del token). */
export function vistaPublica(d) {
  const { tokenHash, ...resto } = d;
  return {
    ...resto,
    tieneToken: Boolean(tokenHash) && !d.tokenRevocado,
    creadoEn: d.creadoEn?.toDate?.().toISOString() ?? null,
    ultimoContacto: d.ultimoContacto?.toDate?.().toISOString() ?? null,
    tokenCreadoEn: d.tokenCreadoEn?.toDate?.().toISOString() ?? null,
  };
}

export async function obtenerDeOrg(usuario, id) {
  const d = await repo.obtener(id);
  // Si no existe o es de otra organización se responde igual (404) para no filtrar información.
  if (!d || d.orgId !== usuario.orgId) throw new ErrorApi(404, "Dispositivo no encontrado");
  return d;
}

export async function listar(usuario) {
  return (await repo.listarPorOrg(usuario.orgId)).map(vistaPublica);
}

export async function crear(usuario, { nombre, ubicacion, tipo }) {
  if (!nombre || typeof nombre !== "string" || nombre.length > 60) throw new ErrorApi(400, "nombre es obligatorio (máx. 60 caracteres)");
  const tipoOk = ["estanque", "basurero"].includes(tipo) ? tipo : "estanque";
  const id = await repo.crear({
    orgId: usuario.orgId, nombre: nombre.trim(), ubicacion: String(ubicacion || "").slice(0, 100), tipo: tipoOk,
    config: configPorDefecto(), configVersion: 1, tokenHash: null, tokenRevocado: false,
  });
  const { token } = await regenerarToken(usuario, id);
  return { id, token };
}

export async function regenerarToken(usuario, id) {
  await obtenerDeOrg(usuario, id);
  const { token, hash } = generarToken(id);
  await repo.actualizar(id, { tokenHash: hash, tokenRevocado: false, tokenCreadoEn: FieldValue.serverTimestamp() });
  return { token }; // se muestra UNA sola vez; solo queda guardado el hash
}

export async function revocarToken(usuario, id) {
  await obtenerDeOrg(usuario, id);
  await repo.actualizar(id, { tokenHash: null, tokenRevocado: true });
}

export async function actualizarConfig(usuario, id, cambios) {
  const d = await obtenerDeOrg(usuario, id);
  const { config, errores } = validarConfig(cambios, { ...configPorDefecto(), ...d.config });
  if (errores.length) throw new ErrorApi(400, "Configuración inválida", errores);
  const configVersion = (d.configVersion || 0) + 1;
  await repo.actualizar(id, { config, configVersion });
  return { config, configVersion };
}
