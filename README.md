# Centro de Mando de Crisis

Sistema agéntico para gestionar una crisis que **cambia mientras el sistema está
en marcha**. Prototipo para el reto de HappyRobot en HackSpain 2026.

El escenario por defecto es un incendio forestal en Sierra Morena, pero el motor
es el mismo para un apagón o una inundación (los tres guiones están incluidos).

---

## El problema

En una emergencia llegan cien mensajes y solo tres cambian algo. Veinte cosas se
pueden hacer a la vez y no todas valen lo mismo. Hay tres ambulancias y cinco
sitios pidiéndolas. Y a los veinte minutos el viento gira y el plan de antes ya no
sirve.

Un sistema que ejecute una lista fija de pasos se queda atrás en el primer cambio.
Este responde, una y otra vez, a seis preguntas: qué información importa, qué va
primero, a quién se avisa y cuándo, dónde van los recursos, qué se hace ahora, y
cuándo hay que tirar el plan a la basura y hacer otro.

**Qué hace, en concreto:**

- **Se entera.** Ingiere señales por API, por webhook de HappyRobot (lo que cuenta
  una persona al teléfono entra como señal nueva) y desde un guion que avanza
  solo. Fusiona las duplicadas y separa lo confirmado de lo que está en el aire.
- **Prioriza.** Puntúa cada zona con una fórmula explícita y enseña el desglose:
  no dice solo "Sevilla primero", dice por qué.
- **Coordina.** Elige recurso, contacto y canal, monta cadenas de escalado para
  cuando el primero no contesta, y propone acciones concretas con destinatario.
- **Actúa.** Ejecuta contra HappyRobot —llamadas, mensajes, correos— con
  reintentos, timeout e idempotencia. Siempre después de que una persona apruebe.
- **Se adapta.** Cualquier cambio de estado dispara una replanificación y una
  versión nueva del plan, con el diff de lo que ha cambiado respecto al anterior.
- **Se deja supervisar.** Un panel donde se ve la situación, lo que el sistema
  está haciendo y por qué, y desde el que se aprueba, se cancela, se reintenta y
  se confirman o descartan señales.

---

## Puesta en marcha en cinco minutos

**Requisitos:** Node.js 20 o superior (18.19 funciona hoy, pero está a punto de
dejar de bastar) y npm 9+.

```bash
npm install
cp .env.example .env.local   # los valores por defecto ya sirven para la demo
npm run dev
```

Abre <http://localhost:3000>. No hace falta ninguna credencial: sin configurar
nada, el sistema arranca en **modo simulado** y no sale nada hacia el exterior.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 3000. |
| `npm run build` | Build de producción. |
| `npm start` | Sirve el build de producción. |
| `npm run lint` | ESLint sobre `app`, `lib` y `tests`. |
| `npm test` | Tests con Vitest, una pasada. |
| `npm run test:watch` | Tests en modo watch. |
| `npx tsc --noEmit` | Comprobación de tipos (no hay script propio todavía). |

La integración continua (`.github/workflows/ci.yml`) ejecuta tipos, lint, tests y
build en cada push y cada pull request.

---

## Arquitectura

```
      señales                    decisión                    ejecución
  ┌───────────────┐        ┌───────────────────┐        ┌────────────────┐
  │ POST /events  │        │ priority.ts       │        │ happyrobot.ts  │
  │ webhook       │ ─────► │ resources.ts      │ ─────► │  (único punto  │
  │ demo/inject   │        │ contacts.ts       │        │   de salida)   │
  │ scenario.ts   │        │ escalation.ts     │        └───────┬────────┘
  └───────────────┘        └─────────┬─────────┘                │
                                     │                          │ callback
                              ┌──────▼──────┐                   │
                              │  store.ts   │ ◄─────────────────┘
                              │ estado +    │
                              │ orquesta    │
                              └──────┬──────┘
                                     │
                        ┌────────────▼────────────┐
                        │ GET /api/situation      │
                        │ panel (sondeo cada 4 s) │
                        │ humano aprueba/cancela  │
                        └─────────────────────────┘
```

La regla que lo vertebra todo: **`store.ts` mantiene el estado y orquesta, pero no
decide**. Cada decisión vive en un módulo especializado con un propietario claro,
declarado en la primera línea del fichero (`// PROPIETARIO: …`). Eso permite que
varias personas y agentes trabajen a la vez sin pisarse, y que se entienda de un
vistazo dónde tocar algo.

| Fichero | De qué responde |
|---|---|
| `lib/types.ts` | Los tipos compartidos. Es el contrato entre módulos. |
| `lib/store.ts` | Estado de la crisis y orquestación del ciclo completo. |
| `lib/validation.ts` | Validación de los cuerpos con zod y forma única de error. |
| `lib/priority.ts` | Puntuación de zonas y construcción del plan. |
| `lib/resources.ts` | Elección, asignación y liberación de recursos. |
| `lib/contacts.ts` | A quién se avisa, por qué canal y con qué briefing. |
| `lib/escalation.ts` | Cadenas de escalado cuando el primer contacto no responde. |
| `lib/happyrobot.ts` | Adaptador a HappyRobot. Lo único que habla con el exterior. |
| `lib/scenario.ts` | Los guiones que hacen que la crisis cambie sola. |
| `lib/history.ts` | Historial de planes, diferencias entre versiones y auditoría. |
| `lib/learning.ts` | Estadísticas aprendidas de ejecuciones anteriores (bonus). |
| `lib/persistence.ts` | Guardado opcional en JSON. |
| `lib/seed.ts` | Situación inicial: zonas, recursos, contactos y guiones. |
| `app/page.tsx`, `app/components/` | El panel del operador. |
| `app/api/` | La superficie HTTP. |

**El estado vive en memoria** (colgado de `globalThis`, para sobrevivir a las
recargas en caliente de Next) y se pierde al reiniciar el servidor. Es deliberado:
una base de datos añadiría un servicio que arrancar y un modo de fallo más el día
de la demo, sin sumar nada al reto. `POST /api/demo/reset` vuelve al estado
inicial cuando interesa.

**La prioridad la calcula una fórmula, no un modelo de lenguaje**: se puede
explicar factor a factor delante de un jurado, se puede testear, y da el mismo
resultado en el ensayo y en la presentación.

El porqué completo de estas decisiones, con lo que cuesta cada una, está en
[`docs/architecture.md`](docs/architecture.md).

---

## La demo

1. **Arranca** con `npm run dev` y abre el panel.
2. **Pon la crisis en marcha**: `POST /api/scenario/start`. El guion empieza a
   soltar acontecimientos solo —el frente avanza, el viento gira, una carretera se
   corta, un recurso cae— sin que nadie toque nada. Se puede acelerar
   (`{"speed": 4}`) y pausar (`POST /api/scenario/stop`) sin perder el punto.
3. **Mira replanificar.** Cada señal que entra sube la versión del plan y cambia
   el orden de prioridades. El panel enseña qué ha cambiado respecto al plan
   anterior y por qué.
4. **Rompe algo a mano.** Los botones de la franja de demo inyectan un incidente
   nuevo, una carretera cortada, un recurso caído o un fallo de integración, en el
   momento exacto en que el jurado pregunte "¿y si…?".
5. **Interviene.** Aprueba una acción de la cola: solo entonces se ejecuta.
   Cancela otra, reintenta una fallida, y confirma o descarta una señal dudosa
   para ver cómo se mueven las prioridades.
6. **Cierra el bucle.** Simula un callback de HappyRobot con
   `POST /api/webhooks/happyrobot`: la acción cambia de estado y lo que "ha
   contado" la persona entra como señal nueva, que vuelve a replanificar. Ese es
   el bucle completo: el sistema llama, escucha, y rehace el plan con lo que oye.
7. **Reinicia** con `POST /api/demo/reset` antes del siguiente pase.

```bash
# Arrancar el guion de inundación al cuádruple de velocidad
curl -X POST localhost:3000/api/scenario/start \
  -H 'content-type: application/json' \
  -d '{"scriptId":"flood-guadalquivir","speed":4}'
```

---

## Superficie de API

Todas las respuestas son JSON y no se cachean. Los errores tienen siempre la misma
forma: `{ "error": "…", "code": "…", "detalles": [{ "campo": "…", "mensaje": "…" }] }`,
con códigos estables (`cuerpo_invalido`, `referencia_desconocida`, `no_encontrado`,
`conflicto`, `no_autorizado`, `metodo_no_permitido`, `error_interno`, …). Cualquier
método no soportado responde `405` con la cabecera `Allow`.

### Situación

| Endpoint | Qué hace |
|---|---|
| `GET /api/situation` | Devuelve el `SituationState` completo: señales, zonas, recursos, contactos, cadenas, acciones, plan vivo, historial de planes, auditoría, escenario, aprendizaje e integración. Es lo que sondea el panel cada 4 segundos, y de paso hace avanzar el guion y barre las acciones atascadas. |

### Señales

| Endpoint | Cuerpo | Qué hace |
|---|---|---|
| `POST /api/events` | `{ source?, title?, description?, zoneId?, category?, severity?, confidence?, confirmed? }` | Ingiere una señal. Valida contra el estado vivo (una zona inexistente se rechaza) y fusiona las equivalentes: si es duplicada responde `200` con `duplicate: true`, si es nueva `201`. |
| `POST /api/events/:id/mark` | `{ confirmed: boolean }` | Confirma o descarta una señal. Descartarla revierte el efecto que tuvo sobre su zona y replanifica. |

### Acciones

| Endpoint | Cuerpo | Qué hace |
|---|---|---|
| `POST /api/actions` | `{ channel, target, objective, reason, zoneId, resourceId?, contactId? }` | Crea una acción a mano. Nace en `pending`; si no se indica recurso, el sistema elige uno. |
| `POST /api/actions/:id/approve` | — | **Aprobación humana.** Único camino por el que una acción llega a ejecutarse. |
| `POST /api/actions/:id/status` | `{ operation?: "cancel" \| "retry", status?, externalActionId?, localActionId?, error? }` | Operaciones del operador desde el panel: cancelar, reintentar o fijar estado. Devuelve `409` si la operación no tiene sentido para el estado actual (cancelar algo ya terminado, reintentar algo en curso). **No es el callback de HappyRobot.** |

Canales: `call`, `sms`, `email`, `ticket`, `webhook`, `whatsapp`, `slack`.
Estados: `pending`, `approved`, `running`, `succeeded`, `failed`, `blocked`,
`cancelled`, `stalled`.

### Webhook de HappyRobot

| Endpoint | Qué hace |
|---|---|
| `POST /api/webhooks/happyrobot` | Entrada de callbacks. **Exige** la cabecera `x-happyrobot-secret`; sin `HAPPYROBOT_WEBHOOK_SECRET` configurado responde `503` y no procesa nada. Acepta `{ status?, summary?, error?, localActionId?, externalActionId?, deliveryId?, newInformation?: [...] }`: mueve el estado de la acción **y** convierte lo que se haya recogido en la conversación en señales nuevas. Es idempotente durante 15 minutos: un reenvío devuelve la misma respuesta sin volver a tocar nada. |

### Escenario

| Endpoint | Cuerpo | Qué hace |
|---|---|---|
| `POST /api/scenario/start` | `{ scriptId?, speed?, restart? }` | Arranca o reanuda el guion. `speed` entre 0.25 y 10, aplicable en caliente. Guiones: `wildfire-andalucia`, `blackout-guadalquivir`, `flood-guadalquivir`. |
| `POST /api/scenario/stop` | — | Pausa. No reinicia: conserva el tiempo consumido. |
| `POST /api/scenario/tick` | — | Empuje manual del guion. Útil para el presentador o para un cron externo. |
| `GET /api/scenario/tick` | — | Lectura sin efectos del estado del guion. |

### Demo

Estas dos rutas manipulan el estado de la crisis, así que están protegidas: ver
`DEMO_API_TOKEN` más abajo.

| Endpoint | Cuerpo | Qué hace |
|---|---|---|
| `POST /api/demo/inject` | `{ kind?: "incident" \| "resource-down" \| "route-blocked" \| "integration-failure" }` | Inyecta una avería concreta en el momento que se quiera. |
| `POST /api/demo/reset` | — | Vuelve al estado inicial. |

---

## Variables de entorno

Todo va en `.env.local` (ignorado por Git). `.env.example` tiene la lista completa
y comentada; esto es el resumen.

### Lo mínimo

| Variable | Por defecto | Para qué |
|---|---|---|
| `ACTION_EXECUTION_MODE` | `mock` | `mock`: nada sale del proceso. `happyrobot`: ejecución real. |

### Credenciales de HappyRobot (solo para ejecución real)

| Variable | Para qué |
|---|---|
| `HAPPYROBOT_API_KEY` | Clave de la API. Sin ella la ejecución real falla con un error explícito. |
| `HAPPYROBOT_BASE_URL` | URL base. Por defecto `https://api.happyrobot.ai`. |
| `HAPPYROBOT_AGENT_ID` | Agente que ejecuta la acción. |
| `HAPPYROBOT_WORKFLOW_ID` | Workflow a disparar, si el contrato real lo pide. |

### Contrato con HappyRobot (pendiente de confirmar)

La documentación privada de HappyRobot está restringida, así que la ruta y la
forma del cuerpo **no están verificadas** contra el contrato real (ver
[`docs/happyDocumentation.md`](docs/happyDocumentation.md)). Todo lo que podría
cambiar es configurable, para poder corregirlo el día de la demo tocando
`.env.local` y no el código: `HAPPYROBOT_ACTION_PATH`, `HAPPYROBOT_AUTH_HEADER`,
`HAPPYROBOT_AUTH_SCHEME`, `HAPPYROBOT_IDEMPOTENCY_HEADER`,
`HAPPYROBOT_PAYLOAD_SHAPE` (`flat` | `wrapped` | `trigger`),
`HAPPYROBOT_RESPONSE_ID_PATH` y `HAPPYROBOT_CHANNEL_MAP`.

### Robustez de la llamada saliente

| Variable | Por defecto | Para qué |
|---|---|---|
| `HAPPYROBOT_TIMEOUT_MS` | `8000` | Tope por intento. Una llamada colgada no puede bloquear el centro de mando. |
| `HAPPYROBOT_MAX_ATTEMPTS` | `3` | Intentos por despacho. Solo se reintentan 5xx, red y timeout; un 4xx nunca. |
| `HAPPYROBOT_RETRY_BASE_MS` | `400` | Base del backoff exponencial. |

### Entrada y acceso

| Variable | Para qué |
|---|---|
| `HAPPYROBOT_WEBHOOK_SECRET` | Secreto compartido del webhook (`x-happyrobot-secret`). Sin él, `/api/webhooks/happyrobot` se cierra con `503`. |
| `DEMO_API_TOKEN` | Protege `/api/demo/*`. Si está definido hay que enviarlo (`x-demo-token`, `Authorization: Bearer …` o `?token=`). Si está vacío: abierto en local, y **desactivado en producción**. |
| `CRISIS_PERSISTENCE` | `on` activa el guardado en JSON bajo `.data/`. Apagado por defecto. |

---

## Ejecución real contra HappyRobot

Por defecto **nada sale del sistema**. Para que una acción llegue de verdad a una
persona tienen que darse **todas** estas condiciones a la vez:

1. `ACTION_EXECUTION_MODE=happyrobot`.
2. `HAPPYROBOT_API_KEY`, `HAPPYROBOT_BASE_URL` y `HAPPYROBOT_AGENT_ID` presentes.
   Si falta alguna, el adaptador falla con un error que nombra las que faltan, en
   vez de intentarlo a medias.
3. El destinatario está marcado como apto para demo (`demoSafe`) y tiene teléfono
   o correo. **En la semilla actual ningún contacto lo está**: hay que marcarlo a
   propósito.
4. Una persona ha aprobado esa acción concreta desde el panel.

### Salvaguardas

- **Degradación en vez de accidente.** Si el destinatario no está aprobado, la
  acción no falla: se ejecuta en simulado y explica por qué, y el motivo aparece
  en el panel.
- **Lo simulado se nota.** El identificador externo de una acción simulada lleva
  el prefijo escrito dentro (`mock-simulado-…`, `mock-no-aprobado-…`), y el estado
  de integración cuenta por separado las acciones reales y las simuladas. Nada
  mock se presenta como ejecución real.
- **Idempotencia en las dos direcciones.** Hacia fuera, cada despacho lleva una
  clave `«<id de acción>:<intento>»`, de forma que un reintento interno no duplica
  el aviso. Hacia dentro, el webhook recuerda las entregas ya procesadas durante
  15 minutos.
- **Timeout y reintentos clasificados.** Un 4xx es culpa nuestra y no se
  reintenta; 5xx, red y timeout se reintentan con backoff exponencial.
- **Nada bloquea el panel.** Si HappyRobot no responde, la acción queda en
  `failed` con el motivo y el sistema replanifica contando con ese fallo.

Antes de lanzar nada real, lee la [nota de seguridad](docs/security.md) —en
particular el trato de los destinatarios de demo— y **pide aprobación explícita
para las acciones concretas** que vas a ejecutar.

---

## Tests

```bash
npm test
```

`tests/priority.test.ts` cubre las decisiones: que una señal crítica y confirmada
suba por encima de la prioridad de partida, que las señales equivalentes se
fusionen, y que un recurso caído cambie la replanificación.
`tests/api.test.ts` cubre las rutas: alta de señal, aprobación a través del
adaptador simulado, fallo de ejecución y callbacks de estado.

Los tests comparten proceso, así que llaman a `resetSituation()` en `beforeEach`.

---

## Documentación

| Documento | Qué contiene |
|---|---|
| [`CHALLENGE.md`](CHALLENGE.md) | El brief del reto y los criterios de puntuación. |
| [`docs/architecture.md`](docs/architecture.md) | Las decisiones de diseño y lo que cuesta cada una. |
| [`docs/security.md`](docs/security.md) | Credenciales, secreto del webhook, destinatarios de demo y lo que este prototipo **no** hace. |
| [`docs/happyDocumentation.md`](docs/happyDocumentation.md) | Notas sobre la plataforma HappyRobot y qué partes del contrato están sin verificar. |
| [`AGENTS.md`](AGENTS.md) | Convenciones para todo el que trabaje aquí, persona o agente. |

---

## Licencia

MIT. Ver [`LICENSE`](LICENSE).
