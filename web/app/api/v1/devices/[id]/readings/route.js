// GET /api/v1/devices/{id}/readings?desde=ISO&hasta=ISO — histórico por rango de fechas.
import { json, manejar, usuarioDesde } from "@/lib/server/http";
import { historico } from "@/lib/server/services/lecturas";

export const GET = manejar(async (req, { params }) => {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  return json(await historico(await usuarioDesde(req), id, q.get("desde"), q.get("hasta")));
});
