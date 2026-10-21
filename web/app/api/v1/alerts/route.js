// GET /api/v1/alerts?deviceId=&limite= — últimas alertas de la organización.
import { json, manejar, usuarioDesde } from "@/lib/server/http";
import { listar } from "@/lib/server/services/alertas";

export const GET = manejar(async (req) => {
  const q = new URL(req.url).searchParams;
  return json({ alertas: await listar(await usuarioDesde(req), { deviceId: q.get("deviceId"), limite: q.get("limite") }) });
});
