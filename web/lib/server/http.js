// Utilidades HTTP compartidas por los controladores (route handlers).
import { NextResponse } from "next/server";
import { adminAuth } from "./firebaseAdmin";

export class ErrorApi extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

export const json = (datos, status = 200) => NextResponse.json(datos, { status });

/** Envuelve un handler: traduce errores a respuestas JSON consistentes. */
export function manejar(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ErrorApi) return json({ error: e.message, detalles: e.detalles }, e.status);
      console.error(e);
      return json({ error: "Error interno del servidor" }, 500);
    }
  };
}

export async function leerJson(req) {
  try {
    return await req.json();
  } catch {
    throw new ErrorApi(400, "El cuerpo no es JSON válido");
  }
}

function tokenBearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Autenticación de USUARIOS: ID token de Firebase Auth con claims { orgId, role }. */
export async function usuarioDesde(req, { soloAdmin = false } = {}) {
  const token = tokenBearer(req);
  if (!token) throw new ErrorApi(401, "Falta el token de usuario (Authorization: Bearer <idToken>)");
  let dec;
  try {
    dec = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new ErrorApi(401, "Token de usuario inválido o expirado");
  }
  if (!dec.orgId || !dec.role) throw new ErrorApi(403, "El usuario no pertenece a ninguna organización");
  if (soloAdmin && dec.role !== "admin") throw new ErrorApi(403, "Se requiere rol administrador");
  return { uid: dec.uid, email: dec.email, orgId: dec.orgId, role: dec.role };
}

export const tokenDispositivoDesde = (req) => tokenBearer(req);
