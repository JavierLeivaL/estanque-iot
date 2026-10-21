"use client";
export default function TokenGenerado({ token, alCerrar }) {
  return (
    <div className="tarjeta aviso">
      <h3>Token del dispositivo</h3>
      <p>Cópialo ahora: <b>no se volverá a mostrar</b> (solo guardamos su hash). Pégalo en <code>device/.env</code> de la Raspberry:</p>
      <pre>DEVICE_TOKEN={token}</pre>
      <div className="fila"><button onClick={() => navigator.clipboard?.writeText(token)}>Copiar</button><button className="sec" onClick={alCerrar}>Listo</button></div>
    </div>
  );
}

