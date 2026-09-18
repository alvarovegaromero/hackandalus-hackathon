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
- [x] Verificar build, lint, TypeScript y 3 tests.
- [x] Probar el workflow local hasta completarlo en simulación y validar errores 401/400.
- [x] Revisar dependencias: auditoría sin vulnerabilidades tras los ajustes.

El panel es una simulación en memoria del navegador y está separado del
workflow. La migración está escrita, pero no aplicada; los clientes Supabase y
el helper Realtime están preparados, pero no conectados al panel. No se han
probado llamadas a modelos ni comunicaciones reales.

## Fase 2 · Decisiones y configuración, para más adelante

- [ ] Elegir el escenario de crisis y los cambios que se inyectarán durante la demo.
- [ ] Definir recursos disponibles y reglas de prioridad y asignación.
- [ ] Elegir proveedor/modelo y configurar las credenciales de AI Gateway.
- [ ] Configurar el proyecto Supabase y aplicar la migración en desarrollo.
- [ ] Concretar operaciones, autenticación y callbacks de HappyRobot.
- [ ] Acordar destinatarios y recursos de demo para las pruebas externas.

Estas decisiones quedan aplazadas expresamente. No bloquean la entrega de la
estructura base y no deben resolverse con credenciales o escenarios inventados.

## Fase 3 · Primera vertical conectada

- [ ] Persistir eventos, planes, acciones y resultados en Supabase.
- [ ] Deduplicar eventos y evitar acciones externas duplicadas durante reintentos.
- [ ] Incorporar historial y disponibilidad real de recursos a las decisiones.
- [ ] Añadir autenticación de operadores y políticas RLS por incidente.
- [ ] Conectar el panel al backend y a Realtime.
- [ ] Persistir pausa, cancelación e intervención humana y respetarlas en la ejecución.
- [ ] Añadir herramientas y subagentes de AI SDK según las operaciones acordadas.
- [ ] Implementar llamadas reales a HappyRobot y procesar resultados autenticados.
- [ ] Incorporar esperas, reintentos y recuperación de fallos al workflow.
- [ ] Demostrar replanificación al cambiar la situación durante la ejecución.
- [ ] Probar restricciones de recursos, fallos y control humano.
- [ ] Configurar y desplegar en Vercel cuando se autorice.
- [ ] Validar una interacción real con destinatarios de demo aprobados.

## Ideas

- [ ] Gemelo digital de la incidencia: además del mapa base, representar la
  incidencia en un gemelo digital que sirva como campo de pruebas. Permitiría
  simular escenarios de forma proactiva (p. ej. cambios de viento, cortes de
  acceso, pérdida de recursos) y comparar alternativas para proponer la mejor
  antes de ejecutar acciones reales.

## Referencias

- [README.md](README.md): instalación, comandos y límites actuales.
- [AGENTS.md](AGENTS.md): convenciones de desarrollo y verificaciones.
- [CHALLENGE.md](CHALLENGE.md): requisitos originales del reto.
