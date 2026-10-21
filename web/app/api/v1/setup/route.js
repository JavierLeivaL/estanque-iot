// POST /api/v1/setup — crea una organización y su administrador (requiere x-setup-secret).
import { json, leerJson, manejar } from "@/lib/server/http";
import { setup } from "@/lib/server/services/usuarios";

export const POST = manejar(async (req) => json(await setup(req.headers.get("x-setup-secret"), await leerJson(req)), 201));
