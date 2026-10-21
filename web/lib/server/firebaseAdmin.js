// CAPA DE ACCESO A DATOS: inicialización del Admin SDK de Firebase.
// Las credenciales de administrador existen SOLO como variable de entorno en Vercel
// (FIREBASE_SERVICE_ACCOUNT). Nunca están en el repositorio ni en la Raspberry Pi.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function credenciales() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error("Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT");
  const cuenta = JSON.parse(crudo.trim().startsWith("{") ? crudo : Buffer.from(crudo, "base64").toString("utf8"));
  if (cuenta.private_key) cuenta.private_key = cuenta.private_key.replace(/\\n/g, "\n");
  return cuenta;
}

function app() {
  return getApps()[0] ?? initializeApp({ credential: cert(credenciales()) });
}

export const db = () => getFirestore(app());
export const adminAuth = () => getAuth(app());
