// LÓGICA DE NEGOCIO: usuarios, roles y organizaciones.
import { ErrorApi } from "../http";
import * as repo from "../repos/usuarios";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function crearUsuario(admin, { email, password, role }) {
  if (!EMAIL.test(email || "")) throw new ErrorApi(400, "Correo inválido");
  if (!password || password.length < 6) throw new ErrorApi(400, "La contraseña debe tener al menos 6 caracteres");
  if (!["admin", "consulta"].includes(role)) throw new ErrorApi(400, "role debe ser 'admin' o 'consulta'");
  const uid = await repo.crearOActualizarUsuario({ email, password, role, orgId: admin.orgId });
  return { uid, email, role, orgId: admin.orgId };
}

export async function listar(admin) {
  return (await repo.listarPorOrg(admin.orgId)).map((u) => ({
    uid: u.uid, email: u.email, role: u.role, actualizadoEn: u.actualizadoEn?.toDate?.().toISOString() ?? null,
  }));
}

/** Configuración inicial: crea una organización y su primer administrador. */
export async function setup(secreto, { orgId, orgNombre, email, password }) {
  if (!process.env.SETUP_SECRET || secreto !== process.env.SETUP_SECRET) throw new ErrorApi(401, "Clave de setup incorrecta");
  if (!/^[a-z0-9-]{3,40}$/.test(orgId || "")) throw new ErrorApi(400, "orgId: 3-40 caracteres en minúscula, números o guiones");
  if (!EMAIL.test(email || "") || !password || password.length < 6) throw new ErrorApi(400, "email y password (mín. 6) son obligatorios");
  await repo.crearOrg(orgId, orgNombre || orgId);
  const uid = await repo.crearOActualizarUsuario({ email, password, orgId, role: "admin" });
  return { orgId, uid, email, role: "admin" };
}
