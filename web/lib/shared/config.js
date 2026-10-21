// Configuración remota del dispositivo: definición, valores por defecto y validación.
// Se usa en el servidor (API) y en el cliente (formulario), así ambos validan igual.

export const CAMPOS_CONFIG = {
  muestreoSeg: { etiqueta: "Intervalo de muestreo (s)", tipo: "int", min: 2, max: 3600, defecto: 5,
    ayuda: "Cada cuánto se lee cada sensor en la Raspberry." },
  envioSeg: { etiqueta: "Intervalo de envío a la nube (s)", tipo: "int", min: 10, max: 3600, defecto: 60,
    ayuda: "Cada cuánto se envía un lote a la API. Menos envíos = menos escrituras en Firestore." },
  alturaSensorCm: { etiqueta: "Distancia sensor → fondo (cm)", tipo: "num", min: 5, max: 400, defecto: 40,
    ayuda: "Distancia medida con el estanque VACÍO." },
  distanciaLlenoCm: { etiqueta: "Distancia sensor → nivel lleno (cm)", tipo: "num", min: 2.5, max: 300, defecto: 5,
    ayuda: "Distancia cuando el estanque está al 100 %. Mínimo 2,5 cm (zona ciega del HC-SR04)." },
  umbralLlenadoPct: { etiqueta: "Alerta de llenado (%)", tipo: "num", min: 1, max: 100, defecto: 80 },
  umbralTempMaxC: { etiqueta: "Alerta temperatura máxima (°C)", tipo: "num", min: -20, max: 80, defecto: 35 },
  umbralTempMinC: { etiqueta: "Alerta temperatura mínima (°C)", tipo: "num", min: -40, max: 60, defecto: 2 },
  sensorNivelActivo: { etiqueta: "Sensor de nivel (HC-SR04) activo", tipo: "bool", defecto: true },
  sensorAmbienteActivo: { etiqueta: "Sensor ambiental (DHT22) activo", tipo: "bool", defecto: true },
};

export function configPorDefecto() {
  return Object.fromEntries(Object.entries(CAMPOS_CONFIG).map(([k, c]) => [k, c.defecto]));
}

/** Valida y normaliza una configuración. Devuelve { config, errores }. */
export function validarConfig(entrada, base = configPorDefecto()) {
  const config = { ...base };
  const errores = [];
  if (!entrada || typeof entrada !== "object") return { config, errores: ["El cuerpo debe ser un objeto JSON"] };
  for (const [k, v] of Object.entries(entrada)) {
    const campo = CAMPOS_CONFIG[k];
    if (!campo) { errores.push(`Campo desconocido: ${k}`); continue; }
    if (campo.tipo === "bool") {
      if (typeof v !== "boolean") errores.push(`${k} debe ser true o false`);
      else config[k] = v;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) { errores.push(`${k} debe ser numérico`); continue; }
    if (campo.tipo === "int" && !Number.isInteger(n)) { errores.push(`${k} debe ser entero`); continue; }
    if (n < campo.min || n > campo.max) { errores.push(`${k} debe estar entre ${campo.min} y ${campo.max}`); continue; }
    config[k] = n;
  }
  if (config.distanciaLlenoCm >= config.alturaSensorCm)
    errores.push("La distancia de lleno debe ser menor que la distancia al fondo");
  if (config.umbralTempMinC >= config.umbralTempMaxC)
    errores.push("La temperatura mínima debe ser menor que la máxima");
  return { config, errores };
}

export const ESTADOS = {
  normal: { texto: "Normal", clase: "ok" },
  lleno: { texto: "Lleno", clase: "alerta" },
  temp_alta: { texto: "Temperatura alta", clase: "alerta" },
  temp_baja: { texto: "Temperatura baja", clase: "alerta" },
};

export const ROLES = { admin: "Administrador", consulta: "Consulta" };
