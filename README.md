# Butterfish

Scaffolding TypeScript para el reto de gestión de crisis de HappyRobot en
HackSpain 2026. Un único proyecto Next.js desplegable en Vercel.

**Estado: estructura base completada.** El modelo de IA, el escenario, las
credenciales y las conexiones reales se concretarán en la siguiente fase.
Consulta [TASKS.md](TASKS.md) para ver lo terminado y las tareas pendientes.
La fuente de verdad del proyecto y sus convenciones es [PROJECT.md](PROJECT.md).
`AGENTS.md` y `CLAUDE.md` apuntan allí para evitar reglas duplicadas.
Para incorporarte al equipo, sigue [CONTRIBUTING.md](CONTRIBUTING.md).

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

## Formato y hooks locales

`npm ci` instala automáticamente los hooks de Husky mediante `prepare` en
desarrollo. Necesitas Git y Node/npm en el PATH; en Windows, Git for Windows
proporciona el intérprete que utiliza Husky. No necesitas GitHub Actions ni un
plan de pago para ejecutar estas comprobaciones.

```powershell
npm run format
npm run check
```

- `npm run format` aplica Prettier; `npm run format:check` comprueba sin modificar.
- **Pre-commit:** bloquea commits en ramas protegidas o HEAD separado y archivos
  privados como `.env.local` y claves privadas. `lint-staged` comprueba secretos,
  aplica Prettier y ejecuta ESLint sobre los archivos preparados para commit.
  Oculta temporalmente los cambios no preparados de archivos parcialmente
  añadidos; las tareas se ejecutan en serie. Después ejecuta TypeScript y tests
  sobre el proyecto. Si algo falla, el commit se detiene.
- **Pre-push:** bloquea cualquier actualización o eliminación de las ramas
  protegidas, incluso `git push origin HEAD:main`, y ejecuta `npm run check`,
  incluyendo el build. No hace falta compilar en cada commit.
- Si instalaste dependencias sin scripts, ejecuta `npm run prepare` para activar
  los hooks. En despliegues o CI se omite su instalación.

Compartimos UTF-8, finales LF, dos espacios, comillas dobles, punto y coma y
comas finales mediante `.prettierrc.json`, `.editorconfig` y `.gitattributes`.
Esto mantiene el mismo formato en macOS, Windows y Linux. Prettier formatea los
archivos que soporta; SQL y hooks shell conservan las reglas de EditorConfig/Git.
Los archivos generados y las credenciales quedan fuera del formateador.

Nombres: camelCase para variables y funciones, PascalCase para componentes y
tipos, kebab-case para archivos de aplicación y UPPER_SNAKE_CASE para variables
de entorno. Se respetan nombres impuestos por el framework. Los mensajes de
commit se escriben en inglés. Estas convenciones de nombres e idioma se revisan
en código; Prettier no las valida.

Los hooks funcionan en cada clon tras instalar las dependencias. No sustituyen
la protección remota: clientes que omitan hooks pueden saltarse controles locales.

Secretlint detecta formatos conocidos de credenciales con el preset recomendado
y oculta los valores detectados en la salida. Las plantillas `.env.example`
están permitidas, pero también se analizan: deben contener valores vacíos o
placeholders inocuos. Ningún detector reconoce todos los secretos; no añadas
credenciales reales aunque no generen una alerta. `npm run secrets:check`
comprueba los archivos versionados; los `.env.local` privados no se publican.

## Arquitectura

| Ruta                                 | Responsabilidad                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `src/app`, `src/components`          | Panel React y endpoints Next.js App Router                                      |
| `src/lib/domain.ts`                  | Eventos y planes validados con Zod; tipos compartidos                           |
| `src/lib/agents/coordinator.ts`      | Planificación estructurada con Vercel AI SDK                                    |
| `src/workflows/crisis.ts`            | Workflow persistente con pasos de planificación y preparación                   |
| `src/lib/supabase`                   | Clientes servidor/navegador y suscripción Realtime preparada                    |
| `supabase/migrations`                | Esquema inicial de incidentes, eventos, recursos, planes, acciones y resultados |
| `src/lib/integrations/happyrobot.ts` | Límite de integración: devuelve `blocked` hasta concretar la API                |

El panel funciona como una demo independiente: **no llama al workflow ni a
Supabase**. El workflow es un ejemplo ejecutable de planificación por evento;
no carga todavía el contexto histórico, asigna recursos ni guarda en Supabase.
La separación permite desarrollar las conexiones sin necesitar credenciales
para arrancar. No hay workers separados, Convex, Python ni Supabase Queues.

## Configuración opcional

Ejecuta `npm run env:setup` para crear `.env.local` sin sobrescribir archivos
existentes y completa únicamente lo que vayas a usar. Nunca subas claves al
repositorio; consulta [CONTRIBUTING.md](CONTRIBUTING.md) para compartirlas y
configurarlas por entorno.

| Variable                                       | Uso                                                      |
| ---------------------------------------------- | -------------------------------------------------------- |
| `CRISIS_API_TOKEN`                             | Token aleatorio privado para los endpoints de workflows  |
| `AI_GATEWAY_API_KEY`                           | Credencial de Vercel AI Gateway                          |
| `AI_MODEL`                                     | Identificador `proveedor/modelo`, a elegir por el equipo |
| `NEXT_PUBLIC_SUPABASE_URL`                     | URL del proyecto Supabase                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`         | Clave pública del proyecto                               |
| `SUPABASE_SECRET_KEY`                          | Clave secreta, solo servidor                             |
| `HAPPYROBOT_API_KEY`, `HAPPYROBOT_WORKFLOW_ID` | Reservadas; aún no habilitan comunicaciones              |

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
autorice. Este scaffolding no incluye un despliegue ni la creación de recursos
en Vercel, Supabase o HappyRobot.

## Próxima vertical funcional

Las tareas se mantienen en [TASKS.md](TASKS.md). Se abordarán después de esta
entrega de estructura base; no es necesario configurar ahora el modelo ni las
integraciones. Este scaffolding aún no cumple el requisito de interacción real
del reto.

Referencias: [AI SDK](https://ai-sdk.dev/docs),
[Workflow](https://workflow.dev/docs),
[Supabase + Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs).
