// POST /api/v1/alerts/{id}/ack — marca una alerta como reconocida.
import { json, manejar, usuarioDesde } from "@/lib/server/http";
import { reconocer } from "@/lib/server/services/alertas";

export const POST = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(await reconocer(await usuarioDesde(req), id));
});
