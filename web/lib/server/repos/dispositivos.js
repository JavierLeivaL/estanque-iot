// CAPA DE ACCESO A DATOS: colección `devices` y subcolección `devices/{id}/horas`.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";

const col = () => db().collection("devices");

export async function obtener(id) {
  const snap = await col().doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

export async function listarPorOrg(orgId) {
  const snap = await col().where("orgId", "==", orgId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function crear(datos) {
  const ref = col().doc();
  await ref.set({ ...datos, creadoEn: FieldValue.serverTimestamp() });
  return ref.id;
}

export async function actualizar(id, cambios) {
  await col().doc(id).update(cambios);
}

/** Escribe en UN batch: buckets por hora, alertas y estado del dispositivo. */
export async function guardarIngesta({ dispositivo, buckets, alertas, cambiosDispositivo }) {
  const batch = db().batch();
  for (const b of buckets) {
    const ref = col().doc(dispositivo.id).collection("horas").doc(b.horaId);
    batch.set(ref, { orgId: dispositivo.orgId, deviceId: dispositivo.id, hora: Timestamp.fromMillis(b.inicioMs), m: b.minutos }, { merge: true });
  }
  for (const a of alertas) {
    const ref = db().collection("orgs").doc(dispositivo.orgId).collection("alertas").doc(a.id);
    batch.set(ref, a.datos, { merge: true });
  }
  batch.update(col().doc(dispositivo.id), { ...cambiosDispositivo, ultimoContacto: FieldValue.serverTimestamp() });
  await batch.commit();
  return buckets.length + alertas.length + 1; // escrituras realizadas
}

/** Lee los buckets horarios entre dos instantes (1 lectura por hora consultada). */
export async function leerHoras(id, desdeMs, hastaMs) {
  const snap = await col().doc(id).collection("horas")
    .where("hora", ">=", Timestamp.fromMillis(desdeMs))
    .where("hora", "<=", Timestamp.fromMillis(hastaMs))
    .orderBy("hora")
    .get();
  return snap.docs.map((d) => d.data());
}
