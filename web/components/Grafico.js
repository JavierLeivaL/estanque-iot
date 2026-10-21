"use client";
// Gráfico de líneas en SVG puro (sin librerías): series sobre un eje de tiempo.
export default function Grafico({ puntos, series, alto = 220 }) {
  const ancho = 800, m = { i: 44, d: 44, s: 12, b: 26 };
  const validos = puntos.filter((p) => series.some((s) => typeof p[s.clave] === "number"));
  if (validos.length < 2) return <p className="tenue">Aún no hay suficientes datos para graficar.</p>;
  const t0 = validos[0].t, t1 = validos[validos.length - 1].t;
  const x = (t) => m.i + ((t - t0) / Math.max(1, t1 - t0)) * (ancho - m.i - m.d);
  const ejes = { izq: series.filter((s) => s.eje !== "der"), der: series.filter((s) => s.eje === "der") };
  const rango = (lista) => {
    const vals = validos.flatMap((p) => lista.map((s) => p[s.clave])).filter((v) => typeof v === "number");
    if (!vals.length) return [0, 1];
    let [lo, hi] = [Math.min(...vals), Math.max(...vals)];
    if (lista[0]?.min != null) lo = Math.min(lo, lista[0].min);
    if (lista[0]?.max != null) hi = Math.max(hi, lista[0].max);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    return [lo, hi];
  };
  const rIzq = rango(ejes.izq), rDer = rango(ejes.der);
  const y = (v, [lo, hi]) => m.s + (1 - (v - lo) / (hi - lo)) * (alto - m.s - m.b);
  const camino = (s) => {
    const r = s.eje === "der" ? rDer : rIzq;
    let d = "", previo = null;
    for (const p of validos) {
      const v = p[s.clave];
      if (typeof v !== "number") { previo = null; continue; }
      const corte = previo && p.t - previo > 5 * 60; // hueco de datos > 5 min: cortar la línea
      d += `${!previo || corte ? "M" : "L"}${x(p.t).toFixed(1)},${y(v, r).toFixed(1)}`;
      previo = p.t;
    }
    return d;
  };
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));
  const etiqueta = (t) => new Date(t * 1000).toLocaleString("es-CL", t1 - t0 > 2 * 86400 ? { day: "2-digit", month: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="grafico" role="img">
        {[0, 0.5, 1].map((f) => {
          const yy = m.s + f * (alto - m.s - m.b);
          const vI = rIzq[1] - f * (rIzq[1] - rIzq[0]), vD = rDer[1] - f * (rDer[1] - rDer[0]);
          return <g key={f}>
            <line x1={m.i} x2={ancho - m.d} y1={yy} y2={yy} className="grilla" />
            {ejes.izq.length > 0 && <text x={m.i - 6} y={yy + 4} textAnchor="end" className="eje">{vI.toFixed(0)}</text>}
            {ejes.der.length > 0 && <text x={ancho - m.d + 6} y={yy + 4} className="eje">{vD.toFixed(0)}</text>}
          </g>;
        })}
        {marcas.map((t, i) => <text key={i} x={x(t)} y={alto - 6} textAnchor="middle" className="eje">{etiqueta(t)}</text>)}
        {series.map((s) => <path key={s.clave} d={camino(s)} fill="none" stroke={s.color} strokeWidth="2" />)}
      </svg>
      <div className="leyenda">{series.map((s) => <span key={s.clave}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>
    </div>
  );
}
