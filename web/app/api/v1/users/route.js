// GET  /api/v1/users — (admin) usuarios de la organización.
// POST /api/v1/users — (admin) crea un usuario { email, password, role: "admin" | "consulta" }.
import { json, leerJson, manejar, usuarioDesde } from "@/lib/server/http";
import { crearUsuario, listar } from "@/lib/server/services/usuarios";

export const GET = manejar(async (req) => json({ usuarios: await listar(await usuarioDesde(req, { soloAdmin: true })) }));
export const POST = manejar(async (req) => json(await crearUsuario(await usuarioDesde(req, { soloAdmin: true }), await leerJson(req)), 201));
