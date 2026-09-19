# Tareas del proyecto

## Fase 1 · Estructura base completada

- [x] Repositorio TypeScript con Next.js App Router y React.
- [x] npm, lockfile y comandos de desarrollo, build, lint, tipos y tests.
- [x] Esquemas compartidos de eventos y planes con Zod.
- [x] Coordinador preparado con Vercel AI SDK y modelo configurable.
- [x] Workflow de ejemplo con pasos persistentes y API protegida por token.
- [x] Panel local sin claves: eventos, revisión de propuestas, pausa y cancelación.
- [x] Clientes Supabase de servidor y navegador; helper de suscripción Realtime.
- [x] Migración inicial para incidentes, eventos, recursos, planes, acciones y resultados.
- [x] RLS activado por defecto en el esquema, sin acceso público a los datos.
- [x] Límite de integración HappyRobot que devuelve `blocked` explícitamente.
- [x] `.env.example`, README e instrucciones de agentes actualizados.
- [x] Verificar build, lint, TypeScript y tests (7 tests en 2 archivos: dominio y guardas de hooks).
- [x] Probar el workflow local hasta completarlo en simulación y validar errores 401/400.
- [x] Revisar dependencias: auditoría sin vulnerabilidades tras los ajustes.

El panel es una simulación en memoria del navegador y está separado del
workflow. La migración está escrita, pero no aplicada; los clientes Supabase y
el helper Realtime están preparados, pero no conectados al panel. No se han
probado llamadas a modelos ni comunicaciones reales.

## Preparación local del código

- [x] Remove GitHub Actions CI: no Actions minutes are available and CI is not planned.
- [x] Require local validation before PR creation via `npm run pr:create` and its
      local `pr:check` prehook (`npm run check`); document the workflow for contributors and agents.
- [x] Prettier compartido, EditorConfig y finales LF en Git para macOS, Windows y Linux.
- [x] Husky instalado automáticamente al instalar dependencias de desarrollo.
- [x] Pre-commit con Secretlint, Prettier y ESLint sobre archivos staged, más TypeScript y tests.
- [x] Pre-push con verificación completa y build.
- [x] Bloqueo de archivos privados y detección de formatos conocidos de claves/tokens.
- [x] PROJECT.md como fuente de verdad, referenciada por AGENTS.md y CLAUDE.md.
- [x] Bloqueo local de commits y pushes a ramas protegidas.
- [x] Documentar nomenclatura y comandos de formato y verificación.
- [x] Unificar ramas y PR hacia main; los agentes pueden hacer merge por indicación explícita del usuario.
- [x] Guía CONTRIBUTING.md, plantilla de PR y configuración compartida de editor.
- [x] Referencias a PROJECT.md desde Codex/AGENTS, Claude, Cursor y otros agentes.

## Skills de desarrollo compartidas

- [x] Fijar Graft como dependencia de desarrollo y documentar el índice local y sus consultas.
- [x] Exigir Graft en las instrucciones de agentes y el checklist de PR; generar y verificar el índice en los hooks de commit y push.

- [x] Incluir las cuatro skills de React/Next.js, Postgres/Supabase, revisión de UI y diseño visual.
- [x] Registrar revisiones upstream, referencias, licencias y guía de uso para el equipo.
- [x] Enlazar las skills desde PROJECT.md para agentes sin descubrimiento automático.

## Fase 2 · Decisiones y configuración, para más adelante

- [x] Elegir el escenario de crisis y los cambios que se inyectarán durante la demo:
      incendio en Sierra Bermeja con tres eventos de caos (giro del viento, corte de la
      A-397, caída del SMS). Detalle en el documento fuente y en `thoughts/open-questions.md`.
- [ ] Definir recursos disponibles y reglas de prioridad y asignación.
- [ ] Elegir proveedor/modelo y configurar las credenciales de AI Gateway.
- [ ] Configurar el proyecto Supabase y aplicar la migración en desarrollo.
- [ ] Concretar operaciones, autenticación y callbacks de HappyRobot.
- [ ] Acordar destinatarios y recursos de demo para las pruebas externas.

Las decisiones aún abiertas no bloquean la estructura base y no deben
resolverse con credenciales inventadas. La lista completa, ordenada por la fase
que bloquea, está en [thoughts/open-questions.md](thoughts/open-questions.md);
las fases de construcción (contratos, punta a punta mínimo, decisión completa,
ejecución robusta, aprendizaje y ensayo) están en el documento fuente.

## Fase 3 · Primera vertical conectada

- [x] Ingesta por lotes con deduplicación de eventos (Hito A de
      `docs/input-architecture.md`), guardado en Supabase si está configurado.
- [x] Enviar los avisos del motor de escenarios al workflow del agente y mostrar
      sus planes en el panel.
- [ ] Persistir planes, acciones y resultados en Supabase.
- [x] Evitar acciones externas duplicadas durante reintentos: el adaptador de
      `lib/happyrobot.ts` envía una clave de idempotencia por despacho e intento y
      el webhook recuerda las entregas ya procesadas.
- [ ] Incorporar historial y disponibilidad real de recursos a las decisiones.
- [ ] Añadir autenticación de operadores y políticas RLS por incidente.
- [ ] Conectar el panel al backend y a Realtime.
- [ ] Persistir pausa, cancelación e intervención humana y respetarlas en la ejecución.
- [ ] Añadir herramientas y subagentes de AI SDK según las operaciones acordadas.
- [x] Adaptador HappyRobot con timeout, reintentos y webhook autenticado por
      secreto compartido (`lib/happyrobot.ts`, `app/api/webhooks/happyrobot`).
      El contrato real sigue sin verificar: ver `docs/happyDocumentation.md`.
- [ ] Verificar el contrato real de HappyRobot y validar una acción con
      destinatarios de demo aprobados.
- [ ] Incorporar esperas, reintentos y recuperación de fallos al workflow.
- [x] Demostrar replanificación al cambiar la situación durante la ejecución:
      guiones que avanzan solos, inyección de averías y diff entre versiones del
      plan en el centro de mando.
- [x] Gemelo digital, primera entrega: `lib/digitalTwin.ts` reconstruye el
      mundo percibido a partir de las señales y mide su precisión contra la
      verdad simulada; `app/components/DigitalTwinPanel.tsx` lo muestra.
- [ ] Gemelo digital, segunda entrega: simular variantes (viento, accesos
      cortados, pérdida de recursos) sobre una copia del estado, comparar
      alternativas por resultado y mostrar la recomendada antes de actuar.
- [x] Probar restricciones de recursos, fallos y control humano (`tests/`).
- [ ] Configurar y desplegar en Vercel cuando se autorice.

## Fase 4 · Consolidación tras fusionar el centro de mando

- [ ] Unificar los dos árboles. Next sirve `app/` y por tanto ignora `src/app`:
      la ingesta por lotes (`/api/events` con deduplicación y Supabase),
      `/api/runs/<runId>`, `/api/scenario/signals`, el workflow de
      `src/workflows/crisis.ts` y el panel de `src/components` solo se
      ejercitan en tests. Decidir qué se porta a `app/`/`lib/` y qué se retira.
- [ ] Renombrar la semilla y el guion por defecto a Sierra Bermeja
      (`lib/seed.ts`, `lib/scenario.ts` usan "Sierra Morena" y
      `wildfire-andalucia`) y el título de `app/layout.tsx` a FARO.
- [ ] Explicar los cambios de zonas y recursos entre planes: el helper
      `capturePlanContext` de `lib/store.ts` nunca se llegó a llamar y se retiró
      en la limpieza; `diffPlans` compara hoy el estado actual consigo mismo.
      Hay que capturar la foto antes de cada mutación que replanifica.
- [ ] Acotar la ruta de `.data/` en `lib/persistence.ts` para que Turbopack no
      trace todo el proyecto (aviso en `npm run build`).
- [ ] Conectar el centro de mando a Supabase siguiendo `docs/data-model.md`.

## Ideas

- [ ] Ampliar el gemelo digital como campo de pruebas para comparar alternativas
      antes de ejecutar acciones reales (ver Fase 3 y 4).

## Referencias

- [README.md](README.md): instalación, comandos y límites actuales.
- [PROJECT.md](PROJECT.md): convenciones de desarrollo, comandos y verificaciones.
- [HackSpain 2026 · Source of Truth del proyecto.md](<HackSpain 2026 · Source of Truth del proyecto.md>):
  visión de producto, escenario, guion de demo y fases.
- [thoughts/](thoughts/README.md): modelo de datos, inventario de
  funcionalidades por portar y decisiones abiertas.
- [CHALLENGE.md](CHALLENGE.md): requisitos originales del reto.
- [docs/architecture.md](docs/architecture.md) y [docs/security.md](docs/security.md):
  decisiones y reglas de seguridad del centro de mando.
- [docs/input-architecture.md](docs/input-architecture.md): diseño y guía de
  implementación de la ingesta de eventos (Hito A síncrono con procesamiento de
  lotes concurrente; Hito B async/topic aplazado). Empezar por el Hito A para
  las tareas de ingesta de la Fase 3 (persistir y deduplicar eventos).
