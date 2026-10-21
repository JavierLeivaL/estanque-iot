// Un dispositivo se considera "en línea" si envió datos dentro de 3 intervalos de envío.
export function enLinea(d) {
  const ms = d.ultimoContacto?.toMillis?.();
  const tolerancia = Math.max(180, 3 * (d.config?.envioSeg || 60)) * 1000;
  return ms != null && Date.now() - ms < tolerancia;
}

