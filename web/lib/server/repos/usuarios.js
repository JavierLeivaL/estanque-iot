// CAPA DE ACCESO A DATOS: Firebase Authentication + colección `users` + `orgs`.
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../firebaseAdmin";

export async function crearOrg(orgId, nombre) {
  await db().collection("orgs").doc(orgId).set({ nombre, creadoEn: FieldValue.serverTimestamp() }, { merge: true });
}

export async function obtenerOrg(orgId) {
  const s = await db().collection("orgs").doc(orgId).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

export async function crearOActualizarUsuario({ email, password, orgId, role }) {
  let usuario;
  try {
    usuario = await adminAuth().getUserByEmail(email);
    if (password) await adminAuth().updateUser(usuario.uid, { password });
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    usuario = await adminAuth().createUser({ email, password });
  }
  // Los claims viajan dentro del ID token: las Security Rules los leen sin costo de lecturas.
  await adminAuth().setCustomUserClaims(usuario.uid, { orgId, role });
  await db().collection("users").doc(usuario.uid).set(
    { email, orgId, role, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true });
  return usuario.uid;
}

export async function listarPorOrg(orgId) {
  const snap = await db().collection("users").where("orgId", "==", orgId).get();
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
