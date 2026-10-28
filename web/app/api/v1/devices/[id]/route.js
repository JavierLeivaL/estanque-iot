// GET   /api/v1/devices/{id} — detalle de un dispositivo (estado, config, salud).
// PATCH /api/v1/devices/{id} — (admin) cambia nombre, ubicación o tipo.
import { json, leerJson, manejar, usuarioDesde } from "@/lib/server/http";
import { actualizarDatos, obtenerDeOrg, vistaPublica } from "@/lib/server/services/dispositivos";

export const GET = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(vistaPublica(await obtenerDeOrg(await usuarioDesde(req), id)));
});

export const PATCH = manejar(async (req, { params }) => {
  const { id } = await params;
  return json(await actualizarDatos(await usuarioDesde(req, { soloAdmin: true }), id, await leerJson(req)));
});
