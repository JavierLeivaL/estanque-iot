// GET /api/v1/devices/{id} — detalle de un dispositivo (estado, config, salud).
import { json, manejar, usuarioDesde } from "@/lib/server/http";
import { obtenerDeOrg, vistaPublica } from "@/lib/server/services/dispositivos";

export const GET = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(vistaPublica(await obtenerDeOrg(await usuarioDesde(req), id)));
});
