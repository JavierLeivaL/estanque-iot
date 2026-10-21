"use client";
// Cliente de la API REST propia: adjunta el ID token del usuario en cada llamada.
import { fbAuth } from "./firebase";

export async function api(ruta, { metodo = "GET", cuerpo } = {}) {
  const usuario = fbAuth().currentUser;
  if (!usuario) throw new Error("No hay sesión iniciada");
  const token = await usuario.getIdToken();
  const r = await fetch(`/api/v1${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(datos.error || `Error ${r.status}`);
    e.detalles = datos.detalles;
    throw e;
  }
  return datos;
}

export const fechaHora = (v) => (v ? new Date(v).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—");
export const haceCuanto = (ms) => {
  if (ms == null) return "nunca";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};
export const fmt = (v, dec = 1, unidad = "") => (typeof v === "number" ? `${v.toFixed(dec)}${unidad}` : "—");
