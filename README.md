# FARO

Centro de mando agéntico para un incendio forestal en Sierra Bermeja (Málaga):
nuestra propuesta para el reto de gestión de crisis de HappyRobot en HackSpain 2026. Un único proyecto Next.js desplegable en Vercel; el paquete npm se llama
`butterfish`. La visión de producto, el escenario y el guion de demo están en
[HackSpain 2026 · Source of Truth del proyecto.md](<HackSpain 2026 · Source of Truth del proyecto.md>)
y el contexto de diseño (modelo de datos, inventario de funcionalidades,
decisiones abiertas) en [thoughts/](thoughts/README.md).

**Estado.** El repositorio contiene dos piezas:

- El **centro de mando** (`app/`, `lib/`, `tests/`): la vertical completa
  portada desde `feat/crisis-command-center` más el gemelo digital. Es lo que
  sirve `npm run dev`: panel del operador, API HTTP, guiones que hacen avanzar
  la crisis solos, cola de acciones con aprobación humana, adaptador HappyRobot
  y gemelo digital. El estado vive en memoria del servidor.
- La **base de plataforma** (`src/`, `supabase/`): Next.js con Vercel Workflow,
  AI SDK, clientes Supabase, ingesta por lotes con deduplicación y el motor de
  escenarios de Sierra Bermeja. Sus rutas de `src/app` **no se sirven** mientras
  exista `app/` en la raíz (Next prioriza `app/` sobre `src/app`); el workflow
  y la ingesta solo se ejercitan desde los tests. Unificar ambas piezas es la
  primera tarea de [TASKS.md](TASKS.md).

El escenario (incendio en Sierra Bermeja) y el nombre están decididos; la
semilla y el guion por defecto del centro de mando todavía nombran Sierra
Morena y su cambio está pendiente. El modelo de IA, las credenciales y las
conexiones reales siguen abiertos: ver [TASKS.md](TASKS.md) y
[thoughts/open-questions.md](thoughts/open-questions.md).

Las convenciones de desarrollo y los permisos están en [PROJECT.md](PROJECT.md).
`AGENTS.md` y `CLAUDE.md` apuntan allí para evitar reglas duplicadas. Para
incorporarte al equipo, sigue [CONTRIBUTING.md](CONTRIBUTING.md). El repositorio
incluye [skills compartidas](docs/agent-skills.md) para React/Next.js,
Postgres/Supabase, accesibilidad y diseño visual. Para indexar el código tras
`npm ci`, ejecuta `npm run index:build` y consulta el mapa con
`npm run index:map`; su uso para navegar por el código es obligatorio
([guía de Graft](docs/code-index.md)).

## Arranque local

Requisitos: Node.js **22.21+ (22.x)** con el npm que incluye (**10.9+**);
`.nvmrc` fija `22.21.0`. `package.json` fija `npm@11.6.1` en `packageManager`
para quien use Corepack (`corepack enable`); no es obligatorio. Usamos npm y
`package-lock.json`.

```powershell
npm ci
npm run dev
```

Abre <http://localhost:3000>. No hace falta ninguna credencial: sin configurar
nada, el sistema arranca en modo `mock` y nada sale hacia el exterior. El
estado cuelga de `globalThis` para sobrevivir a las recargas en caliente y se
pierde al reiniciar el servidor; `POST /api/demo/reset` vuelve a la situación
inicial. Para una segunda instancia sin pelear por el directorio de build:
`NEXT_DIST_DIR=.next-dev npm run dev -- -p 3001`.

| Comando                             | Qué hace                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                       | Servidor de desarrollo en el puerto 3000.                       |
| `npm run build` / `npm start`       | Build de producción y servidor que la sirve.                    |
| `npm run lint`                      | ESLint sobre todo el repositorio.                               |
| `npm run typecheck`                 | Tipos de rutas de Next y `tsc --noEmit`.                        |
| `npm test`                          | Vitest, una pasada: `tests/`, `src/` y `scripts/`.              |
| `npm run format` / `format:check`   | Prettier: aplica o solo comprueba.                              |
| `npm run check`                     | Secretos, formato, lint, tipos, tests, build e índice de Graft. |
| `npm run env:setup`                 | Crea `.env.local` desde `.env.example` si no existe.            |
| `npm run index:build` / `index:map` | Construye y consulta el índice de Graft.                        |

`package.json` fija dos dependencias indirectas de Workflow mediante `overrides`
(`nanoid` y `undici`) a versiones corregidas. Revisa si siguen siendo necesarias
cuando actualices Workflow.

## Formato y hooks locales

`npm ci` instala los hooks de Husky mediante `prepare`. Necesitas Git y
Node/npm en el PATH; en Windows, Git for Windows proporciona el intérprete.

- **Pre-commit:** bloquea commits en ramas protegidas y archivos privados como
  `.env.local` o claves. `lint-staged` comprueba secretos, aplica Prettier y
  ejecuta ESLint (sin avisos) sobre los archivos staged. Después ejecuta
  TypeScript, los tests y `npm run index:verify`.
- **Pre-push:** bloquea cualquier actualización de `main`, `master` y `develop`
  y ejecuta `npm run check`, incluido el build.
- **Before creating a PR:** use `npm run pr:create -- --title "..." --body-file <file>`.
  Its local `pr:check` prehook runs `npm run check` and blocks creation on
  failure. Requires authenticated GitHub CLI (`gh`), a clean working tree and
  an already published feature branch; the command targets `main` and does not push.
- **No CI:** GitHub Actions is removed and will not be used because the team has
  no Actions minutes. Validation is local. All contributors and agents must use
  the PR command; GitHub's UI and direct `gh pr create` bypass the local hook.
  Include check results and the tested OS in the PR.

Compartimos UTF-8, finales LF, dos espacios, comillas dobles, punto y coma y
comas finales mediante `.prettierrc.json`, `.editorconfig` y `.gitattributes`.
Nombres: camelCase para variables y funciones, PascalCase para componentes y
tipos, kebab-case para archivos de aplicación y UPPER_SNAKE_CASE para variables
de entorno. Los mensajes de commit se escriben en inglés.

Secretlint detecta formatos conocidos de credenciales y oculta los valores en la
salida. Las plantillas `.env.example` también se analizan: solo valores vacíos o
placeholders inocuos. Ningún detector reconoce todos los secretos.

## Arquitectura

### Centro de mando (lo que se sirve)

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

`lib/store.ts` mantiene el estado y orquesta, pero no decide: cada decisión
vive en un módulo con un propietario declarado en su primera línea
(`// PROPIETARIO: …`). La prioridad la calcula una fórmula explicable, no un
modelo de lenguaje.

| Fichero                                                   | De qué responde                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lib/types.ts`                                            | Tipos compartidos; el contrato entre módulos.                                        |
| `lib/store.ts`                                            | Estado de la crisis y orquestación del ciclo completo.                               |
| `lib/validation.ts`                                       | Validación de cuerpos con Zod y forma única de error.                                |
| `lib/priority.ts`, `lib/triage.ts`                        | Puntuación de zonas, triaje calibrado y construcción del plan.                       |
| `lib/resources.ts`                                        | Elección, asignación y liberación de recursos.                                       |
| `lib/contacts.ts`, `lib/escalation.ts`                    | A quién se avisa, por qué canal y cadenas de escalado.                               |
| `lib/autonomy.ts`, `lib/assumptions.ts`                   | Autonomía graduada y supuestos vivos del plan.                                       |
| `lib/digitalTwin.ts`                                      | Gemelo digital: mundo percibido desde señales y precisión contra la verdad simulada. |
| `lib/happyrobot.ts`                                       | Adaptador a HappyRobot; lo único que habla con el exterior.                          |
| `lib/scenario.ts`, `lib/seed.ts`                          | Guiones que hacen cambiar la crisis y situación inicial.                             |
| `lib/history.ts`, `lib/learning.ts`, `lib/persistence.ts` | Historial y diff de planes, estadísticas aprendidas, guardado JSON opcional.         |
| `app/page.tsx`, `app/components/`                         | El panel del operador.                                                               |
| `app/api/`                                                | La superficie HTTP.                                                                  |

El porqué de estas decisiones está en [docs/architecture.md](docs/architecture.md).

### Base de plataforma (`src/`)

| Ruta                                      | Responsabilidad                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `src/app`, `src/components`               | Panel y endpoints del scaffolding (no servidos mientras exista `app/`) |
| `src/lib/domain.ts`                       | Eventos y planes validados con Zod                                     |
| `src/lib/ingest.ts`, `ingest-server.ts`   | Ingesta por lotes con deduplicación y guardado opcional en Supabase    |
| `src/lib/scenario`, `src/lib/signals`     | Motor de escenarios de Sierra Bermeja y esquema de avisos              |
| `src/lib/agents/coordinator.ts`           | Planificación estructurada con Vercel AI SDK                           |
| `src/workflows/crisis.ts`                 | Workflow persistente de planificación                                  |
| `src/lib/supabase`, `supabase/migrations` | Clientes, suscripción Realtime y esquema con RLS por defecto           |

El alias `@/` resuelve primero contra la raíz y después contra `src/`, tanto en
TypeScript como en Vitest. El diseño de la ingesta está en
[docs/input-architecture.md](docs/input-architecture.md) y el modelo de datos
propuesto en [docs/data-model.md](docs/data-model.md).

## La demo

1. Arranca con `npm run dev` y abre el panel.
2. Pon la crisis en marcha con `POST /api/scenario/start`. El guion suelta
   acontecimientos solo: el frente avanza, el viento gira, una carretera se
   corta, un recurso cae. Se puede acelerar (`{"speed": 4}`) y pausar
   (`POST /api/scenario/stop`) sin perder el punto.
3. Mira replanificar: cada señal sube la versión del plan y el panel enseña qué
   ha cambiado respecto al anterior y por qué.
4. Rompe algo a mano con los botones de la franja de demo (incidente nuevo,
   carretera cortada, recurso caído, fallo de integración).
5. Interviene: aprueba una acción de la cola (solo entonces se ejecuta),
   cancela otra, reintenta una fallida, confirma o descarta una señal dudosa.
6. Cierra el bucle simulando un callback con `POST /api/webhooks/happyrobot`:
   la acción cambia de estado y lo que "ha contado" la persona entra como señal
   nueva que vuelve a replanificar.
7. Reinicia con `POST /api/demo/reset` antes del siguiente pase.

El guion por defecto es `wildfire-andalucia` y su semilla nombra Sierra Morena;
renombrarlo a Sierra Bermeja está pendiente en [TASKS.md](TASKS.md).

## Superficie de API

Respuestas JSON sin caché. Los errores tienen siempre la forma
`{ "error", "code", "detalles": [{ "campo", "mensaje" }] }` con códigos
estables (`cuerpo_invalido`, `referencia_desconocida`, `no_encontrado`,
`conflicto`, `no_autorizado`, `metodo_no_permitido`, `error_interno`). Un
método no soportado responde `405` con la cabecera `Allow`.

| Endpoint                          | Cuerpo                                                                                      | Qué hace                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/situation`              | —                                                                                           | Estado completo: señales, zonas, recursos, plan, historia                        |
| `POST /api/events`                | `{ source?, title?, description?, zoneId?, category?, severity?, confidence?, confirmed? }` | Ingiere una señal y replanifica                                                  |
| `POST /api/events/:id/mark`       | `{ confirmed }`                                                                             | Confirma o descarta una señal                                                    |
| `POST /api/actions`               | `{ channel, target, objective, reason, zoneId, resourceId?, contactId? }`                   | Crea una acción pendiente de aprobación                                          |
| `POST /api/actions/:id/approve`   | —                                                                                           | Aprobación humana; solo entonces se ejecuta                                      |
| `POST /api/actions/:id/status`    | `{ operation?: "cancel" \| "retry", status?, externalActionId?, error? }`                   | Cancela, reintenta o actualiza el estado                                         |
| `POST /api/webhooks/happyrobot`   | callback                                                                                    | Exige `x-happyrobot-secret`; `503` sin secreto configurado, `401` si no coincide |
| `POST /api/scenario/start`        | `{ scriptId?, speed?, restart? }`                                                           | Arranca o reanuda el guion (`speed` entre 0.25 y 10)                             |
| `POST /api/scenario/stop`         | —                                                                                           | Pausa conservando el tiempo consumido                                            |
| `POST` / `GET /api/scenario/tick` | —                                                                                           | Empuje manual del guion / lectura sin efectos                                    |
| `POST /api/demo/inject`           | `{ kind?: "incident" \| "resource-down" \| "route-blocked" \| "integration-failure" }`      | Inyecta una avería                                                               |
| `POST /api/demo/reset`            | —                                                                                           | Vuelve al estado inicial                                                         |

Canales: `call`, `sms`, `email`, `ticket`, `webhook`, `whatsapp`, `slack`.
Estados de acción: `pending`, `approved`, `running`, `succeeded`, `failed`,
`blocked`, `cancelled`, `stalled`. Las rutas `/api/demo/*` se protegen con
`DEMO_API_TOKEN` (cabecera `x-demo-token`, `Authorization: Bearer …` o
`?token=`); sin token están abiertas en desarrollo y desactivadas en producción.

## Variables de entorno

Todo va en `.env.local` (ignorado por Git); `npm run env:setup` lo crea desde
`.env.example`, que tiene la lista completa comentada. Nunca subas claves al
repositorio; consulta [CONTRIBUTING.md](CONTRIBUTING.md) para compartirlas.

| Variable                                                                                                                               | Para qué                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTION_EXECUTION_MODE`                                                                                                                | `mock` (por defecto): nada sale del proceso. `happyrobot`: ejecución real.                                                                             |
| `HAPPYROBOT_API_KEY`, `HAPPYROBOT_BASE_URL`, `HAPPYROBOT_AGENT_ID`, `HAPPYROBOT_WORKFLOW_ID`                                           | Credenciales para la ejecución real.                                                                                                                   |
| `HAPPYROBOT_ACTION_PATH`, `_AUTH_HEADER`, `_AUTH_SCHEME`, `_IDEMPOTENCY_HEADER`, `_PAYLOAD_SHAPE`, `_RESPONSE_ID_PATH`, `_CHANNEL_MAP` | Contrato configurable, sin verificar contra la API real ([docs/happyDocumentation.md](docs/happyDocumentation.md)).                                    |
| `HAPPYROBOT_TIMEOUT_MS`, `HAPPYROBOT_MAX_ATTEMPTS`, `HAPPYROBOT_RETRY_BASE_MS`                                                         | Timeout por intento, intentos (solo 5xx, red y timeout) y backoff.                                                                                     |
| `HAPPYROBOT_WEBHOOK_SECRET`                                                                                                            | Secreto compartido del webhook de callbacks.                                                                                                           |
| `DEMO_API_TOKEN`                                                                                                                       | Protege `/api/demo/*`.                                                                                                                                 |
| `CRISIS_PERSISTENCE`                                                                                                                   | `on` guarda el estado en JSON bajo `.data/`. Apagado por defecto.                                                                                      |
| `CRISIS_API_TOKEN`, `AI_GATEWAY_API_KEY`, `AI_MODEL`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, `SCENARIO_AGENT_ENABLED`        | Base de plataforma (`src/`): API de workflows, AI Gateway, Supabase y puente escenario→agente. Solo tienen efecto en tests hasta unificar los árboles. |

Sin modelo ni clave, el coordinador de `src/` usa una decisión determinista
marcada como `simulation`; con ambos valores usa AI SDK. Si falta uno, falla
explícitamente.

## Ejecución real contra HappyRobot

Por defecto nada sale del sistema. Para que una acción llegue a una persona
tienen que darse todas estas condiciones a la vez:

1. `ACTION_EXECUTION_MODE=happyrobot`.
2. `HAPPYROBOT_API_KEY`, `HAPPYROBOT_BASE_URL` y `HAPPYROBOT_AGENT_ID`
   presentes; si falta alguna, el adaptador falla nombrando las que faltan.
3. El destinatario está marcado como apto para demo (`demoSafe`) y tiene
   teléfono o correo. En la semilla actual ningún contacto lo está.
4. Una persona ha aprobado esa acción concreta desde el panel.

Salvaguardas: si el destinatario no está aprobado, la acción se ejecuta en
simulado y explica por qué; los identificadores externos simulados llevan el
prefijo `mock-…` y el estado de integración cuenta por separado lo real y lo
simulado; cada despacho lleva una clave de idempotencia `<acción>:<intento>` y
el webhook recuerda las entregas ya procesadas durante 15 minutos; un 4xx no se
reintenta; si HappyRobot no responde, la acción queda en `failed` y el sistema
replanifica contando con ese fallo. Antes de lanzar nada real, lee
[docs/security.md](docs/security.md) y pide aprobación explícita para las
acciones concretas que vas a ejecutar.

## Supabase y Vercel

La migración de `supabase/migrations` está preparada para aplicarla manualmente
desde el SQL Editor de un proyecto de desarrollo; no se aplica automáticamente.
Las tablas tienen RLS activado y no permiten acceso desde el navegador por
defecto. Antes de conectar el panel hacen falta autenticación de operadores y
políticas por incidente. El modelo completo está en
[docs/data-model.md](docs/data-model.md).

Para desplegar, importa el repositorio en Vercel como proyecto Next.js con
Node.js 22.x y `npm ci` / `npm run build`; `withWorkflow` está configurado en
`next.config.ts`. Añade las variables necesarias en Vercel y despliega cuando el
equipo lo autorice.

## Tests

`npm test` ejecuta 16 archivos: `tests/` cubre el centro de mando (prioridad,
recursos, triaje, autonomía, supuestos, persistencia, gemelo digital, rutas y
callbacks del adaptador simulado), `src/` la ingesta y el motor de escenarios,
y `scripts/hooks.test.ts` las guardas de los hooks. Los tests del centro de
mando comparten proceso y llaman a `resetSituation()` en `beforeEach`.

## Documentación

| Documento                                                                              | Qué contiene                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [CHALLENGE.md](CHALLENGE.md)                                                           | El brief del reto y los criterios de puntuación.                         |
| [PROJECT.md](PROJECT.md)                                                               | Convenciones, permisos y mapa del repositorio.                           |
| [TASKS.md](TASKS.md)                                                                   | Lo hecho y lo pendiente, incluida la unificación de los árboles.         |
| [docs/architecture.md](docs/architecture.md)                                           | Decisiones de diseño del centro de mando y lo que cuesta cada una.       |
| [docs/security.md](docs/security.md)                                                   | Credenciales, secreto del webhook y destinatarios de demo.               |
| [docs/happyDocumentation.md](docs/happyDocumentation.md)                               | Notas sobre HappyRobot y qué partes del contrato están sin verificar.    |
| [docs/data-model.md](docs/data-model.md), [thoughts/](thoughts/README.md)              | Modelo de datos en Supabase, inventario de funcionalidades y decisiones. |
| [docs/input-architecture.md](docs/input-architecture.md)                               | Ingesta de eventos por lotes.                                            |
| [docs/dashboard-design-guide.md](docs/dashboard-design-guide.md)                       | Guía visual del panel.                                                   |
| [docs/code-index.md](docs/code-index.md), [docs/agent-skills.md](docs/agent-skills.md) | Graft y skills compartidas para agentes.                                 |

## Licencia

MIT. Ver [LICENSE](LICENSE).

## Planned report intake

The [confirmed input contract](docs/input-contract.md) accepts text and optional
GPS or textual location, distinguishes reporter from incident location, and
normalizes all channels before triage. The server supplies crisis identity and
provenance. Receipt waits for persistence and durable scheduling; interpretation
runs asynchronously. This contract is not implemented yet; the current API and
route-tree limitations above still apply. Luis's scenario engine and batch
orchestration are retained through adapter migration.
