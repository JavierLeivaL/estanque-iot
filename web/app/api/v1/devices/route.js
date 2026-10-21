// GET  /api/v1/devices — lista los dispositivos de la organización del usuario.
// POST /api/v1/devices — (admin) da de alta un dispositivo y devuelve su token una sola vez.
import { json, leerJson, manejar, usuarioDesde } from "@/lib/server/http";
import { crear, listar } from "@/lib/server/services/dispositivos";

export const GET = manejar(async (req) => json({ dispositivos: await listar(await usuarioDesde(req)) }));
export const POST = manejar(async (req) => json(await crear(await usuarioDesde(req, { soloAdmin: true }), await leerJson(req)), 201));
