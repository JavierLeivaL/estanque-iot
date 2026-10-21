// POST /api/v1/ingest — lote de datos enviado por la Raspberry Pi (token de dispositivo).
import { json, leerJson, manejar, tokenDispositivoDesde } from "@/lib/server/http";
import { ingerir } from "@/lib/server/services/ingesta";

export const POST = manejar(async (req) => json(await ingerir(tokenDispositivoDesde(req), await leerJson(req))));
