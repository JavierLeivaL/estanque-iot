// LÓGICA DE NEGOCIO: tokens de dispositivo.
// Formato: "<deviceId>.<secreto>". En Firestore solo se guarda el SHA-256 del secreto,
// así que ni siquiera con acceso a la base se puede reconstruir el token.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const hashSecreto = (s) => createHash("sha256").update(s).digest("hex");

export function generarToken(deviceId) {
  const secreto = randomBytes(32).toString("base64url");
  return { token: `${deviceId}.${secreto}`, hash: hashSecreto(secreto) };
}

export function separarToken(token) {
  const i = (token || "").indexOf(".");
  if (i <= 0) return null;
  return { deviceId: token.slice(0, i), secreto: token.slice(i + 1) };
}

export function coincide(secreto, hashGuardado) {
  if (!secreto || !hashGuardado) return false;
  const a = Buffer.from(hashSecreto(secreto), "hex");
  const b = Buffer.from(hashGuardado, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
