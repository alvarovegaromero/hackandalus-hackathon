# Funcionalidades construidas y cómo funcionan

Inventario de lo que se construyó en la rama `feat/crisis-command-center`
(Next 15, estado en memoria) y que hay que trasladar sobre el andamiaje de
`main` (Next 16, Supabase, Vercel Workflow, AI SDK). Cada sección dice qué hace
el módulo, qué funciones exporta, cómo está verificado y qué le falta. Está
escrito para quien tenga que reimplementarlo sin haberlo visto.

Cifras de referencia al congelar la rama: 266 tests en 10 ficheros, typecheck y
lint limpios, cero vulnerabilidades en producción, 16 módulos de dominio, 12
rutas de API, 14 componentes de interfaz.

---

## Mapa de módulos

| Módulo | Responsabilidad | Fichero | Tests |
| --- | --- | --- | --- |
| Tipos | Contrato entre módulos | `lib/types.ts` | — |
| Orquestador | Estado, replanificación, auditoría, enganches | `lib/store.ts` | `tests/store.test.ts` (12) |
| Prioridad | Qué va primero y por qué | `lib/priority.ts` | `tests/priority.test.ts` (49) |
| Recursos | Dónde van los medios y quién espera | `lib/resources.ts` | `tests/resources.test.ts` (14) |
| Contactos y escalado | A quién se avisa, por qué canal, qué se le pide | `lib/contacts.ts`, `lib/escalation.ts` | `tests/integration.test.ts` (32, compartido) |
| HappyRobot | Ejecución externa y callbacks | `lib/happyrobot.ts`, `app/api/webhooks/happyrobot/` | `tests/integration.test.ts` |
| Triaje | Actuar, verificar o descartar con probabilidad | `lib/triage.ts` | `tests/triage.test.ts` |
| Supuestos | Cuándo tirar el plan | `lib/assumptions.ts` | `tests/assumptions.test.ts` (18) |
| Autonomía | Qué hace solo y qué pide permiso; lista de espera | `lib/autonomy.ts` | `tests/autonomy.test.ts` |
| Escenario | La crisis avanza sola | `lib/scenario.ts`, `app/api/scenario/` | `tests/scenario.test.ts` (27) |
| Persistencia, historial, aprendizaje | Sobrevivir al reinicio y aprender | `lib/persistence.ts`, `lib/history.ts`, `lib/learning.ts` | `tests/persistence.test.ts` (32) |
| Validación y API | Entrada segura, errores coherentes | `lib/validation.ts`, `app/api/**` | `tests/api.test.ts` (17) |
| Interfaz | Ver, entender, intervenir | `app/page.tsx`, `app/components/` | verificación manual con navegador |

La regla que hizo posible construirlo en paralelo: **cada módulo tiene un único
propietario y `store.ts` orquesta sin decidir**. Sobre Supabase, esa regla se
traduce en "cada módulo escribe solo sus tablas".

---

## 1. Orquestador (`store.ts`)

Mantiene el estado y delega toda decisión en los módulos. Lo que sí hace por sí
mismo, porque es coordinación:

- **Replanificación** con contexto: antes de mutar captura zonas, recursos e
  integración; después llama a `buildPlan` y a `diffPlans` con el antes y el
  después, para que el diff pueda decir "Sierra Morena pasa a crítica" y no
  solo cambios de puesto.
- **Auditoría**: toda mutación deja entrada con actor
  (`system | operator | happyrobot | scenario`), tipo, resumen y versión de plan.
- **Barrido de acciones atascadas** (`sweepStalledActions`): una acción en
  curso que supera `stalledAfter` (90 s) pasa a `stalled`, libera su recurso y
  replanifica. Se ejecuta en cada sondeo (`pollSituation`).
- **Descartar revierte**: al marcar una señal como falsa se deshace su efecto
  exacto sobre la zona (riesgo, estado, necesidad) y se cancelan las acciones
  que solo existían por ella. Se compara por categoría derivada, no por el
  registro, porque solo la primera señal que introduce una necesidad la anota.
- **Guardia de recurso al aprobar**: si el recurso de la acción ya no está
  disponible, la acción pasa a `blocked` **antes** de llamar al exterior. Sin
  esto se avisaba a alguien de que iba en camino un recurso inexistente.
- **Respuesta tardía no pisa al operador**: `approveAction` captura el
  `attempt` al despachar; si al volver la respuesta la acción ya no está en
  `running` con ese mismo intento (la cancelaron o reintentaron), la respuesta
  se descarta.
- **Cierre de ejecución** (`closeRun`): al parar el escenario o reiniciar la
  demo, guarda el `RunRecord` y recalcula pesos aprendidos. Reiniciar es lo que
  más se pulsa en una demo; sin esto se perdía todo el aprendizaje.
- **Inyectores de demo** honestos: "recurso caído" elige un recurso del que
  dependa alguna acción viva; "fallo de integración" elige una acción en vuelo,
  nunca una ya completada.

**Sobre el andamiaje**: lo que aquí es un singleton en memoria pasa a ser
transacciones sobre Supabase dentro de pasos de Workflow. La lógica de
coordinación es la misma; el "estado" es la base de datos.

---

## 2. Prioridad (`priority.ts`)

Fórmula, todo determinista y con desglose que suma exactamente la puntuación:

```
puntuación = riesgo base
           + señales vivas
           + población en riesgo
           + necesidades abiertas
           + recursos caídos
           − alivio por acciones completadas
```

Peso de una señal viva: `gravedad × credibilidad × repetición × decaimiento`.

- Gravedad: low 8, medium 28, high 70, critical 160.
- Credibilidad: confianza (0,4 / 0,75 / 1,0) multiplicada por un castigo si no
  está confirmada (0,3 / 0,6 / 0,85). Confirmada, sin castigo.
- Repetición: `min(1,8; 1 + ln(occurrences) · 0,4)`. Cinco repeticiones
  refuerzan ×1,64, no ×5.
- Decaimiento: `0,5^(edad_min / vida_media)`, con vida media 6/12/25/45 min
  según gravedad, y suelo 0,3 confirmada / 0,05 sin confirmar. Lo de las 12:00
  pesa menos a las 12:20.
- Apilado con rendimientos decrecientes por zona: la enésima señal cuenta
  `1/(1 + 0,75·n)`, techo 200.
- Alivio: 20 por acción completada, vida media 20 min, amortiguado y limitado
  al 50 % de la presión. Fallidas y pendientes no alivian.

Exporta `buildPlan`, `scoreZone`, `explainZone`, `signalWeight`,
`credibilityFactor`, `occurrenceFactor`, `decayFactor`, `liveEventsForZone`,
`defaultPriorityWeights`. `buildPlan` acepta un séptimo parámetro opcional
`{ now, weights }` para tests deterministas y pesos aprendidos.

**Medido**: ocho señales de ruido (low/low, sin confirmar) subían la zona más
tranquila del último al segundo puesto (143 puntos); ahora queda cuarta (40).
Completar una acción bajaba la puntuación 0 puntos; ahora baja 20.

**Pendiente**: incorporar multiplicador de vulnerabilidad y tiempo hasta el
daño (variables V y t de la fórmula del documento fuente). El modelo de datos
ya trae ambas columnas en `incidents`.

---

## 3. Recursos (`resources.ts`)

Puntuación 0–100 con pesos exportados como `PESOS`:

| Peso | Factor | Cómo |
| --- | --- | --- |
| 45 | Capacidad técnica | `capabilities` frente a la necesidad derivada del objetivo; cubrir la principal vale 0,7 |
| 25 | Proximidad | Distancia euclídea entre coordenadas de zonas; misma zona = 1; sin base = 0,6 |
| 15 | Suficiencia | `capacity` frente a una unidad por cada 100 personas, solo en capacidades que escalan con población |
| 10 | Disponibilidad | `available` 1, `assigned` 0, `unavailable` excluido siempre |
| 5 | Encaje de canal | Comunicaciones suman si la acción sale por un canal de mensajería |

Reglas duras: un recurso que no cubre ninguna necesidad no es candidato por
cerca que esté; `unavailable` nunca se elige; uno `assigned` solo se expropia
si no queda alternativa **y** la zona nueva es más urgente que la actual.

Exporta `selectResourceForAction`, `assignResource`, `releaseResource`,
`reassignAffectedActions`, `resolveResourceConflicts` (devuelve
`{ allocations, waiting, summary }`, la respuesta a "tres ambulancias y cinco
sitios"), `rankResourcesForAction` (ranking completo con motivo de descarte por
candidato), `explainUnassignable`, `necesidadesDeAccion`, `urgenciaDeZona`,
`distanciaEntreZonas`.

**Medido**: al caer la unidad sanitaria de Sevilla, antes se asignaba la
brigada forestal de Sierra Morena (primera del array). Ahora esa brigada queda
descartada por incompatibilidad y entra la unidad sanitaria de Granada con
motivo: "INFOCA Sierra Bravo está más cerca pero no cubre triaje".

**Detalle importante**: la palabra "coordina" se quitó de la tabla de
necesidades porque el orquestador redacta todos los objetivos como "Coordinar
respuesta de…", y convertía al enlace de comunicaciones en comodín universal.

---

## 4. Contactos y escalado (`contacts.ts`, `escalation.ts`)

- `rankContacts` puntúa rol adecuado a la categoría (con alias es/en y
  normalización de acentos), despliegue en la zona, `responsiveness`, y
  `contactStats` aprendidos.
- `selectChannelWithReason` combina urgencia, preferencias del contacto, sesgo
  por rol y `channelStats`. En la práctica: al coordinador se le llama, al
  voluntario o vecino se le manda SMS o WhatsApp, a la autoridad se le escribe.
- `briefingForRole` genera `headline / detail / askFor` distintos por rol. El
  `askFor` es lo que cierra el bucle: lo que responda entra como señal nueva.
- `buildEscalationChain` produce 3–4 escalones sin repetir persona: quien está
  en la zona por el canal más directo → otro rol útil → sala de coordinación →
  autoridad por escrito. `waitSeconds` 90 s urgente, 180 s normal, +15 s por
  escalón. `isStepOverdue` y `describeChain` para la interfaz.
- `canReceiveLiveAction`: `demoSafe` **y** teléfono o correo utilizable.
  `isUsableDestination` descarta marcadores como `[teléfono omitido]` que deja
  la persistencia al redactar datos personales.

**Pendiente**: las cadenas se construyen y se muestran pero **no se ejecutan
escalón a escalón**, porque no hay runtime duradero que espere y avance. Es
exactamente lo que aporta Vercel Workflow. `advanceChain`, `satisfyChain` e
`isStepOverdue` están listas.

---

## 5. HappyRobot (`happyrobot.ts`, webhook)

El contrato real no está verificado contra la documentación privada, así que
todo lo dudoso es configurable por entorno con el valor actual por defecto:
`HAPPYROBOT_ACTION_PATH`, `HAPPYROBOT_AUTH_HEADER`, `HAPPYROBOT_AUTH_SCHEME`,
`HAPPYROBOT_IDEMPOTENCY_HEADER`, `HAPPYROBOT_PAYLOAD_SHAPE` (`flat | wrapped |
trigger`), `HAPPYROBOT_RESPONSE_ID_PATH`, `HAPPYROBOT_CHANNEL_MAP`,
`HAPPYROBOT_WORKFLOW_ID`, `HAPPYROBOT_TIMEOUT_MS`, `HAPPYROBOT_MAX_ATTEMPTS`,
`HAPPYROBOT_RETRY_BASE_MS`. El día de la demo se toca `.env.local`, no código.

- `AbortController` por intento; backoff exponencial **solo** en 5xx, red y
  timeout; un 4xx nunca se reintenta; una respuesta 2xx ilegible no se da por
  buena.
- `HappyRobotError.kind`: `missing-credentials | timeout | client-error |
  server-error | network | unreadable-response`, con mensaje útil para el
  operador.
- **Salvaguarda**: aun en modo `happyrobot`, solo se llama de verdad si
  `canReceiveLiveAction(contact)`. Si no, degrada a simulación con
  `externalActionId = mock-no-aprobado-<id>` y lo explica. Los seis contactos
  semilla tienen `demoSafe: false` y sin datos: hoy es imposible que salga
  nada al exterior, y hay un test que lo comprueba.
- Webhook `POST /api/webhooks/happyrobot`: secreto obligatorio con
  `timingSafeEqual`; sin secreto configurado responde 503. Acepta
  `externalActionId, localActionId, status, summary, newInformation[]`. Cada
  `newInformation` entra como señal (`source: happyrobot`) y replanifica.
  Idempotencia por `x-happyrobot-delivery-id` o SHA-256 del cuerpo, caché 15
  min: un reenvío devuelve lo mismo con `duplicate: true`.

**Activar ejecución real**: confirmar contrato → credenciales en `.env.local` →
`HAPPYROBOT_WEBHOOK_SECRET` compartido con HappyRobot → dar de alta un
contacto `demoSafe: true` con permiso explícito → solo entonces
`ACTION_EXECUTION_MODE=happyrobot`.

---

## 6. Triaje calibrado (`triage.ts`)

Tres salidas con umbrales configurables (0,85 y 0,5 por defecto):

- p alta → `act`.
- p intermedia → `verify`: genera una acción de verificación con dos o tres
  preguntas cerradas (`buildVerificationRequest`). Verificar es actuar, no
  esperar.
- p baja → `discard`, con motivo guardado.

`assessSignal` deriva `pRelevant`, `pTruthful`, `urgency` y `confidence` de
severidad, confianza declarada, fuente y su fiabilidad, confirmación,
repeticiones y coherencia con otras señales de la zona. `fuseConfidence`
aplica `C = 1 − ∏(1 − p_i · r_i)` solo entre fuentes **independientes**: dos
señales de la misma fuente no multiplican. `updateSourceReliability` aprende
con mínimo de muestras y movimiento acotado.

Interfaz `SignalAssessor` con el motor determinista como implementación por
defecto y hueco para Jev y para un LLM con salida estructurada. El acceso a Jev
está confirmado; el determinista sigue siendo el respaldo siempre disponible.

**Pendiente**: enganchar en la entrada de señales del orquestador. El módulo
está completo; nadie lo llama todavía.

---

## 7. Supuestos vivos (`assumptions.ts`)

- `deriveAssumptions(plan, zones, resources, world, actions)`: entre tres y
  seis supuestos que salen de decisiones reales del plan. Si un recurso cruza
  una carretera, el supuesto es que sigue abierta; si una acción sale por SMS,
  que el SMS funciona; si se prioriza por viento, la dirección del viento.
- `checkAssumptions(assumptions, world, event?)`: qué sigue en pie, qué se
  rompió y por qué. Un supuesto roto no se rompe dos veces ni resucita solo.
  Usa `unknown` cuando deja de haber dato, en vez de fingir que sigue bien.
- `applyEventToWorld(world, event)`: una señal `route-blocked` añade la
  carretera a `blockedRoads`; un cambio de viento actualiza `windDirection`.
  Pura, sin mutar.
- `explainInvalidation`: texto de sala de operaciones. Ejemplo real: "El plan
  v3 ya no vale: daba por hecho que el viento seguiría del nordeste sobre
  Sierra Morena, y acaba de girar. El orden de prioridades ya no se sostiene…"
- `consequencesOfBreak`: qué acciones dejan de tener sentido.

**Pendiente**: enganchar en la replanificación. Es el clímax de la demo (el
jurado gira el viento, el plan se pone en rojo) y está construido pero no
conectado.

---

## 8. Autonomía graduada y coste de oportunidad (`autonomy.ts`)

| Tipo de acción | Reversibilidad | Nivel |
| --- | --- | --- |
| Verificar un dato | reversible | automática |
| Avisar a un responsable | reversible | automática con aviso |
| Asignar o mover un recurso | reversible | automática con aviso, deshacible |
| Aviso masivo a la población | parcial | automática solo con confianza ≥ 0,9; si no, aprobación |
| Ordenar evacuación | irreversible | siempre aprobación |
| Pedir refuerzos externos | irreversible | siempre aprobación |

- `classifyAction` deduce el tipo a partir del objetivo (la categoría es la
  señal útil).
- `decideAutonomy` devuelve nivel y motivo; ante la duda, el más conservador;
  una acción sin clasificar cae en aprobación; `autonomyPaused` fuerza
  aprobación en todo.
- `canAutoDispatch`: el guardián de una línea que se consulta antes de ejecutar
  sin preguntar. Si falta información, `false`.
- `buildWaitingList(actions, resources, zones)`: envuelve
  `resolveResourceConflicts` y devuelve `WaitingDemand[]` con espera estimada.

**Pendiente**: enganchar el despacho automático en el orquestador y publicar la
lista de espera en el estado (`waiting` existe en el tipo, se inicializa vacía).

---

## 9. Escenario (`scenario.ts`, `app/api/scenario/*`)

- Reloj por tiempo real transcurrido: sondear más no acelera, sondear menos no
  retrasa.
- **Un beat por tick como máximo.** Antes, 60 s sin sondeo disparaban todos los
  atrasados de golpe. Los beats con más de 60 s de retraso y otro posterior
  también vencido se omiten y quedan trazados en `skippedBeatIds`; el más
  reciente nunca se omite. Tras tres minutos sin mirar, el sistema salta al
  presente en vez de reproducir historia.
- Pausa y reanudación reales; velocidad 0,25×–10× en caliente; orden
  determinista.
- Latido en servidor (`ensureHeartbeat`, 5 s): la crisis avanza aunque nadie
  mire la pantalla. Handle en `globalThis` que limpia el anterior, `unref()`,
  apagado en tests y con `SCENARIO_AUTOTICK=0`. Sin disparos duplicados.
- Tres guiones: `wildfire-andalucia` (predeterminado, 6 beats a 20/55/90/125/
  160/200 s), `blackout-guadalquivir`, `flood-guadalquivir`. Se eligen con
  `POST /api/scenario/start { scriptId, speed, restart }`.

**Pendiente**: trasladar el guion a Sierra Bermeja (Estepona, Jubrique,
Genalguacil, Benahavís, Los Pinares) y añadir el beat de ruido (cuarenta
mensajes, tres relevantes). Sobre Supabase, los beats disparados van a
`scenario_beats` y el latido a un cron de Vercel o a un paso de Workflow con
espera.

---

## 10. Persistencia, historial y aprendizaje

**Persistencia** (`persistence.ts`, `CRISIS_PERSISTENCE=on`): ficheros JSON en
`.data/` con sobre `{ schemaVersion, savedAt, payload }`, escritura atómica
(temporal + rename), diferida (500 ms de silencio, máximo 4 s), volcado final
en `process.on("exit")`. Descarta el fichero entero ante JSON inválido,
truncado, versión de esquema distinta o forma incorrecta, y arranca con la
semilla. `sanitizeState` pone teléfonos y correos a `null` y filtra texto
libre. Probado con dos procesos reales.

**Historial** (`history.ts`): `diffPlans(previous, next, context)` detecta los
siete tipos de `PlanChangeKind` y redacta para pantalla: "Costa del Sol
adelanta a Sevilla Hub y Sierra Morena", "La integración con HappyRobot está
fallando", "Sierra Morena pasa a crítica". Ordenados por importancia,
recortados a 12.

**Aprendizaje** (`learning.ts`): `buildRunRecord` resume la ejecución desde el
estado (idempotente); `weightsFromRuns` reconstruye pesos desde cero sumando
ejecuciones. Mínimos de muestra: canal 5 intentos, contacto 4 avisos,
`unconfirmedPenalty` 3 ejecuciones y 8 señales verificadas. Lo que no llega al
mínimo ni se publica. `explainWeights` devuelve `LearningInsight[]` en
castellano, incluido lo que **aún no** se aplica y por qué ("hacen falta 3
ejecuciones y solo hay 2").

**Sobre el andamiaje**: la persistencia en ficheros desaparece; historial y
aprendizaje leen `domain_events`, `decisions` y `action_results`. La lógica de
mínimos y explicación se conserva tal cual.

---

## 11. Validación y API (`validation.ts`, `app/api/**`)

Esquema de error único:

```json
{ "error": "La zona \"zone-nope\" no existe…", "code": "referencia_desconocida",
  "detalles": [{ "campo": "zoneId", "mensaje": "…" }] }
```

Códigos: `cuerpo_invalido` 400, `json_invalido` 400, `cuerpo_vacio` 400,
`referencia_desconocida` 400, `tipo_contenido_no_soportado` 415,
`cuerpo_demasiado_grande` 413 (32 KB), `no_autorizado` 401, `no_encontrado`
404, `conflicto` 409, `metodo_no_permitido` 405 con `Allow`, `error_interno`
500. Todo con `cache-control: no-store`. Esquemas Zod estrictos: un campo mal
escrito devuelve 400 en vez de perderse.

Rutas: `GET /api/situation` (usa `pollSituation`), `POST /api/events`,
`POST /api/events/:id/mark`, `POST /api/actions`, `POST /api/actions/:id/approve`,
`POST /api/actions/:id/status` (operaciones del operador, **sin** secreto),
`POST /api/demo/inject`, `POST /api/demo/reset` (con `DEMO_API_TOKEN`),
`POST /api/scenario/{start,stop,tick}`, `POST /api/webhooks/happyrobot`.

`DEMO_API_TOKEN`: sin definir en desarrollo, abierto; definido, cabecera
`x-demo-token`, `Bearer` o `?token=`; sin definir en producción, rutas
desactivadas.

Helpers reutilizables: `apiOk`, `apiError`, `apiErrorFromThrown`,
`methodNotAllowed`, `parseJsonBody`, `validarReferencias`, `autorizarRutaDemo`.

**Pendiente**: `POST /api/actions/:id/assign`, `POST /api/autonomy`, rutas de
aceptar y rechazar lecciones. La interfaz ya los llama y avisa si no existen.

---

## 12. Interfaz (`app/page.tsx`, `app/components/`)

Jerarquía: cabecera con versión del plan e insignia simulado/real → banners →
hero de tres bloques (prioridad ahora, qué ha cambiado, 6 KPI) → barra de
escenario con estado del mundo e hitos → inyectores → mapa con marcadores vivos
que abren el detalle de zona → plan con diff y versiones anteriores → pestañas
(acciones, señales, recursos, contactos y escalado, auditoría).

Lo que puede hacer el operador: aprobar, reintentar, cancelar, confirmar o
descartar señales, crear acción a mano, reasignar recurso contra el ranking
completo con motivos de descarte, arrancar, parar y acelerar el guion, parar la
autonomía en caliente. Franja permanente de honestidad: "Acciones reales
ejecutadas: 0 · simuladas: N".

Técnica: sondeo de 4 s con huella JSON para no repintar sin cambios; estado de
interfaz fuera del objeto `situation` para no perder pestaña ni scroll;
`aria-label`, `role=tablist`, `aria-live`, `focus-visible`,
`prefers-reduced-motion`; cortes en 980 y 640 px.

Componentes: `ActionQueue`, `AuditPanel`, `ChangeBar`, `ContactsPanel`,
`HeroSummary`, `NewActionForm`, `OperationsMap`, `PlanChanges`,
`ResourcePicker`, `ResourcesPanel`, `ScenarioBar`, `SignalsPanel`,
`ZoneDetail`. Cuatro más escritos pero **sin conectar**, para la distribución
de seis zonas del documento fuente: `AgentStrip`, `ChaosBar`, `ContextPanel`,
`PriorityBoard`.

---

## Estado de integración al congelar

| Pieza | Estado |
| --- | --- |
| Prioridad, recursos, contactos, escalado, HappyRobot, escenario, persistencia, API, interfaz | Construido, enchufado y verificado |
| Triaje calibrado | Construido y testado; **no enchufado** en la entrada de señales |
| Supuestos vivos | Construido y testado; **no enchufado** en la replanificación |
| Autonomía y lista de espera | Construido y testado; **no enchufado** en el despacho |
| Ejecución de cadenas de escalado | Funciones listas; sin runtime que las avance |
| Rutas `assign`, `autonomy`, lecciones | No existen; la interfaz las llama y avisa |
| Escenario en Sierra Bermeja | No hecho; sigue en zonas abstractas de Andalucía |
| Cuatro componentes de la distribución nueva | Escritos, sin importar |
