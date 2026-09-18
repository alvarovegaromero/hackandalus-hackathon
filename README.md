# Butterfish

Scaffolding TypeScript para el reto de gestión de crisis de HappyRobot en
HackSpain 2026. Un único proyecto Next.js desplegable en Vercel.

## Arranque local

Requisitos: Node.js **22.21+ (22.x)** y **npm 11.6.1**. Usamos npm y
`package-lock.json`; para una instalación reproducible:

```powershell
npm ci
npm run dev
```

Abre http://localhost:3000. No necesitas claves para el panel de simulación.
Puedes inyectar eventos, cambiar la severidad, cancelar propuestas y pausar
acciones simuladas. Los datos viven en memoria del navegador y se pierden al
recargar. Cada evento sustituye las propuestas pendientes. No es todavía un
planificador de crisis real ni ejecuta comunicaciones.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm start` sirve el build de producción; ejecútalo después de `npm run build`.
`package.json` fija dos dependencias indirectas de Workflow mediante `overrides`
(`nanoid` y `undici`) a versiones corregidas dentro de sus respectivas versiones
mayores. Revisa si siguen siendo necesarios cuando actualices Workflow.

## Arquitectura

| Ruta | Responsabilidad |
| --- | --- |
| `src/app`, `src/components` | Panel React y endpoints Next.js App Router |
| `src/lib/domain.ts` | Eventos y planes validados con Zod; tipos compartidos |
| `src/lib/agents/coordinator.ts` | Planificación estructurada con Vercel AI SDK |
| `src/workflows/crisis.ts` | Workflow persistente con pasos de planificación y preparación |
| `src/lib/supabase` | Clientes servidor/navegador y suscripción Realtime preparada |
| `supabase/migrations` | Esquema inicial de incidentes, eventos, recursos, planes, acciones y resultados |
| `src/lib/integrations/happyrobot.ts` | Límite de integración: devuelve `blocked` hasta concretar la API |

El panel funciona como una demo independiente: **no llama al workflow ni a
Supabase**. El workflow es un ejemplo ejecutable de planificación por evento;
no carga todavía el contexto histórico, asigna recursos ni guarda en Supabase.
La separación permite desarrollar las conexiones sin necesitar credenciales
para arrancar. No hay workers separados, Convex, Python ni Supabase Queues.

## Configuración opcional

Copia `.env.example` a `.env.local` y completa únicamente lo que vayas a usar.
Nunca subas claves al repositorio.

| Variable | Uso |
| --- | --- |
| `CRISIS_API_TOKEN` | Token aleatorio privado para los endpoints de workflows |
| `AI_GATEWAY_API_KEY` | Credencial de Vercel AI Gateway |
| `AI_MODEL` | Identificador `proveedor/modelo`, a elegir por el equipo |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública del proyecto |
| `SUPABASE_SECRET_KEY` | Clave secreta, solo servidor |
| `HAPPYROBOT_API_KEY`, `HAPPYROBOT_WORKFLOW_ID` | Reservadas; aún no habilitan comunicaciones |

Las claves de Supabase se obtienen en la configuración API del proyecto.
La de AI Gateway se crea en Vercel AI Gateway. HappyRobot requiere concretar
con el equipo las operaciones, autenticación, destinatarios y callbacks.

Sin modelo ni clave, el workflow usa una decisión determinista marcada como
`simulation`. Con ambos valores usa AI SDK y devuelve `ai`; si falta uno,
falla explícitamente. Los resultados de acciones permanecen `blocked` en ambos
casos: no se presenta una propuesta como una comunicación enviada.

## Probar el workflow local

Configura `CRISIS_API_TOKEN`, reinicia `npm run dev` y usa el mismo token en
`Authorization: Bearer …`. No lo incluyas en código del navegador.

`POST /api/events` acepta este cuerpo:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "incidentId": "22222222-2222-4222-8222-222222222222",
  "summary": "Se ha cortado el acceso a la zona afectada",
  "severity": "high",
  "source": "operator"
}
```

Devuelve `202` y `{ "runId": "…" }`. Consulta `GET /api/runs/<runId>` con
la misma autorización para obtener estado y resultado al completar. Sin token
configurado la API responde `503`; una credencial incorrecta obtiene `401`.
Cada POST inicia un workflow nuevo: la deduplicación de eventos y de acciones
externas debe conectarse a PostgreSQL antes de habilitar comunicaciones reales.
Workflow administra la persistencia de sus pasos localmente y en Vercel;
no representa todavía la persistencia de negocio en Supabase.

## Supabase y Realtime

La migración SQL está preparada para aplicarla manualmente a un proyecto de
desarrollo desde el SQL Editor de Supabase. **No se aplica automáticamente**.
Las seis tablas tienen RLS activado y no permiten acceso anónimo ni autenticado
desde el navegador por defecto. Solo el servidor con clave secreta tiene acceso.

Antes de conectar el panel, añade autenticación de operadores, membresía de
incidentes y políticas de lectura/escritura específicas. Después habilita los
permisos de lectura correspondientes; la suscripción preparada escucha eventos
del incidente y respeta RLS. La publicación Realtime incluye `events`; las demás
tablas necesitarán suscripciones/publicación cuando el panel las consuma.

## Vercel

Importa el repositorio como proyecto Next.js, selecciona Node.js 22.x y usa
`npm ci` / `npm run build`. `withWorkflow` está configurado en `next.config.ts`.
Añade las variables necesarias en Vercel y despliega cuando el equipo lo
autorice. No se ha creado ni publicado ningún recurso externo desde este repo.

## Próxima vertical funcional

- Elegir escenario y modelo; definir recursos y reglas de priorización.
- Conectar eventos, planes y resultados a Supabase con deduplicación.
- Conectar el panel al backend, Auth y Realtime; persistir la intervención humana.
- Añadir herramientas/subagentes a AI SDK según las operaciones reales.
- Implementar HappyRobot, callbacks autenticados, esperas y reintentos seguros.
- Ensayar cambios durante la ejecución y fallos usando destinatarios de demo
  aprobados. Este scaffolding aún no cumple el requisito de interacción real.

Referencias: [AI SDK](https://ai-sdk.dev/docs),
[Workflow](https://workflow.dev/docs),
[Supabase + Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs).
