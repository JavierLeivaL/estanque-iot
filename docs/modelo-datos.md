# Modelo de datos (Cloud Firestore)

El modelo se diseñó a partir de **las consultas que hace la plataforma** y del **volumen esperado**, para mantenerse dentro de la capa gratuita (50.000 lecturas, 20.000 escrituras y 20.000 eliminaciones diarias; 1 GiB almacenado).

## Colecciones

```
orgs/{orgId}                                  organización
  └─ alertas/{deviceId_t_tipo}                eventos de umbral (id determinista)
devices/{deviceId}                            dispositivo + estado actual + configuración
  └─ horas/{AAAAMMDDHH}                       1 documento por HORA con hasta 60 resúmenes por minuto
users/{uid}                                   correo, orgId y rol (para listar usuarios)
```

### `devices/{deviceId}`
| Campo | Tipo | Uso |
|---|---|---|
| `orgId` | string | Aislamiento por organización (Security Rules y consultas) |
| `nombre`, `ubicacion`, `tipo` | string | Datos de presentación |
| `config` | map | Configuración remota (muestreo, envío, geometría, umbrales, sensores activos) |
| `configVersion` | number | El dispositivo compara su versión y aplica la nueva sin reiniciarse |
| `tokenHash` | string | SHA-256 del secreto del token (el token completo nunca se guarda) |
| `tokenRevocado`, `tokenCreadoEn` | bool, timestamp | Revocación del token |
| `ultimoContacto` | timestamp | Estado de conexión (en línea si < 3 intervalos de envío) |
| `ultimaLectura` | map | Último resumen: lo usa el dashboard en tiempo real sin leer históricos |
| `salud` | map | Estado de los microservicios, CPU, RAM, temperatura de la placa |
| `pendientes` | number | Registros que quedan en el buffer local de la Raspberry |

### `devices/{deviceId}/horas/{AAAAMMDDHH}` (UTC)
```json
{ "orgId": "org-norte", "deviceId": "8fK2...", "hora": "2026-10-22T14:00:00Z",
  "m": { "00": {"d":21.4,"nv":18.6,"p":53.1,"tc":22.9,"hr":64.0,"hl":5.2,"nd":12,"na":12,"e":"normal"},
         "01": { ... }, "59": { ... } } }
```
| Clave | Significado |
|---|---|
| `d` | distancia sensor→superficie (cm, compensada por temperatura) |
| `nv` | altura del contenido (cm) |
| `p` | llenado (%) |
| `tc`, `hr` | temperatura (°C) y humedad (%) promedio del minuto |
| `hl` | horas estimadas hasta llenarse (regresión de los últimos 30 min) |
| `nd`, `na` | cantidad de lecturas válidas de cada sensor en el minuto |
| `e` | estado: `normal`, `lleno`, `temp_alta`, `temp_baja` |

**Sin duplicados:** cada minuto ocupa una clave fija (`m.MM`). Si la Raspberry reenvía un lote después de una desconexión, se sobrescribe el mismo valor.

### `orgs/{orgId}/alertas/{deviceId_t_tipo}`
`{ tipo, mensaje, valor, umbral, ts, deviceId, deviceNombre, orgId, reconocida, reconocidaPor, reconocidaEn }`

## Consultas e índices

| Consulta (quién) | Implementación | Índice | Costo |
|---|---|---|---|
| Dashboard en tiempo real (navegador) | `devices where orgId == X` + `onSnapshot` | Automático de campo único (`orgId`) | 1 lectura por dispositivo y por actualización |
| Detalle en tiempo real (navegador) | `onSnapshot(devices/{id})` | — (lectura por id) | 1 lectura por actualización |
| Histórico por rango (API) | `devices/{id}/horas where hora >= A and hora <= B orderBy hora` | Automático de campo único (`hora`) | **1 lectura por hora** del rango (24/día) |
| Alertas (navegador y API) | `orgs/{org}/alertas orderBy ts desc limit 100` | Automático de campo único (`ts`) | ≤ 100 lecturas |
| Autenticar dispositivo (API) | `get devices/{id}` | — | 1 lectura por lote |

- **No se necesitan índices compuestos**: las alertas son subcolección de la organización (no hace falta filtrar por `orgId`) y el histórico se consulta dentro de la subcolección del dispositivo.
- **Exención de índice** en `horas.m` (`firebase/firestore.indexes.json`): Firestore indexa por defecto cada campo de cada mapa (60 minutos × 9 campos = 540 entradas por documento). Como nunca se filtra por esos campos, se desactiva su indexación y se reduce el almacenamiento.

## Por qué un documento por hora (y no uno por lectura)

| Diseño | Escrituras/día (1 disp.) | Lecturas histórico 24 h | Almacenamiento/año |
|---|---|---|---|
| A: 1 documento por lectura cruda (2 sensores cada 5 s) | 34.560 (**supera** el límite de 20.000) | 34.560 por consulta | ~3 GB |
| B: 1 documento por minuto | 1.440 + estado | 1.440 por consulta | ~0,2 GB |
| **C (elegido): 1 documento por hora + envío cada 60 s** | 1.440 (bucket) + 1.440 (estado) = 2.880 | **24** por consulta | ~0,2 GB |

Los valores reales se medirán durante los 7 días de operación (ver informe de evaluación de uso).
