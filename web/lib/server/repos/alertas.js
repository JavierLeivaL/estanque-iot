// CAPA DE ACCESO A DATOS: `orgs/{orgId}/alertas`.
import { db } from "../firebaseAdmin";

const col = (orgId) => db().collection("orgs").doc(orgId).collection("alertas");

export async function listar(orgId, limite = 50) {
  const snap = await col(orgId).orderBy("ts", "desc").limit(limite).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function obtener(orgId, id) {
  const snap = await col(orgId).doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function actualizar(orgId, id, cambios) {
  await col(orgId).doc(id).update(cambios);
}
