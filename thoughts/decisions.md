# Decisiones de arquitectura y por qué

Cada decisión con su motivo y lo que cuesta. Si alguna deja de tener sentido,
cambiarla es legítimo; cambiarla sin saber por qué se tomó, no.

---

## 1. El núcleo de decisión es determinista; el modelo propone y el código valida

Prioridad, reparto de recursos, comprobación de supuestos, autonomía y
aprendizaje son código puro con tests. El AI SDK entra donde aporta: redactar
el mensaje por rol, interpretar una orden en lenguaje natural, proponer un plan
que después valida Zod y contrasta el código determinista.

**Por qué**: es reproducible, explicable en una línea al jurado, no depende de
la red en el momento de la demo, y coincide con la tabla de riesgos del
documento fuente ("reglas deterministas por encima del LLM").
**Coste**: menos "magia" visible. Se compensa enseñando el desglose de cada
decisión.

## 2. Verificar es una acción, no una espera

La banda intermedia del triaje (0,5–0,85) genera una llamada de verificación
con preguntas cerradas. No se queda pendiente.

**Por qué**: responde literalmente a "decidir sin tener todos los datos", y
convierte la incertidumbre en interacción real con HappyRobot, que es lo que
puntúa.
**Coste**: más llamadas. Se acota con el umbral configurable y el aprendizaje.

## 3. Los planes declaran supuestos y se invalidan, no se "actualizan"

Cada versión del plan lista de qué depende. Un cambio del mundo que rompe un
supuesto pone el plan en inválido y fuerza uno nuevo con diff.

**Por qué**: responde a "cuándo tirar el plan" de forma visible. Es el momento
más fuerte de la demo.
**Coste**: hay que derivar supuestos de verdad, no genéricos. Tres a seis por
plan.

## 4. Autonomía graduada por reversibilidad

Reversible, automático; parcialmente reversible, automático solo con confianza
alta; irreversible, siempre una persona. Interruptor general para pararlo todo.

**Por qué**: un sistema que pide permiso para todo no es agéntico; uno que no
lo pide para nada no es supervisable. Los dos son criterios de evaluación.
**Coste**: hay que clasificar cada acción. Ante la duda, aprobación.

## 5. Nada sale al exterior sin destinatario aprobado explícitamente

`demo_safe` con nota de consentimiento, comprobado en el adaptador. Sin eso,
degrada a simulación y lo dice.

**Por qué**: `AGENTS.md` lo exige, y una llamada equivocada delante del jurado
es irrecuperable.
**Coste**: dar de alta a mano los destinatarios de la demo. Es trabajo de
cinco minutos que evita un desastre.

## 6. Lo simulado se etiqueta en el dato

`execution_mode` es columna, y la interfaz enseña el contador de reales frente
a simuladas en todo momento.

**Por qué**: "¿qué es real y qué simulado?" es pregunta segura del jurado, y
decirlo sin rodeos da credibilidad.
**Coste**: ninguno.

## 7. Módulos con un único propietario que escriben solo sus tablas

**Por qué**: es lo que permitió que ocho agentes trabajaran a la vez sin un
solo conflicto, y es lo que permite que cuatro personas lo hagan.
**Coste**: a veces un cambio pequeño exige pedirle el enganche a otro. Se
resuelve con el informe de "cambios que necesito fuera de mis ficheros".

## 8. Log de eventos inmutable como fuente de verdad

`domain_events` es append-only; el resto son proyecciones. Se escriben en la
misma transacción.

**Por qué**: reproducir una ejecución, auditar y aprender salen gratis.
**Coste**: volumen. Se mitiga con identidad `bigint`, índices parciales y
particionado por ejecución cuando haga falta.

## 9. El escenario avanza por reloj con latido en servidor

Un beat por tick, los atrasados se omiten con traza, hay latido de 5 s en el
servidor acotado contra fugas.

**Por qué**: "la situación cambia mientras el sistema corre" es requisito
obligatorio; que solo avance si alguien mira la pantalla es falso y frágil.
**Coste**: cuidado con los intervalos en desarrollo (recarga de módulos). Está
resuelto con handle en `globalThis` y `unref()`.

## 10. Jev detrás de una interfaz, con determinista como respaldo

`SignalAssessor` con tres implementaciones posibles: Jev, LLM con salida
estructurada, determinista. El determinista siempre está.

**Por qué**: el acceso a Jev está confirmado, pero los límites de uso o una
caída durante la demo son riesgo real según el propio documento.
**Coste**: mantener dos caminos. El determinista ya existe y está testado.

## 11. Zod como contrato único, SQL lo materializa con `check`

**Por qué**: frontend, route handlers, workflows y agentes ven una sola
definición. `check` en vez de enums de Postgres porque añadir valores en un
hackathon es diario y los enums lo hacen incómodo.
**Coste**: mantener Zod y migración en el mismo commit.

## 12. Datos personales en una sola columna, cifrable, nunca en semillas

`contact_channels.address` y nada más. Semillas con `null`.

**Por qué**: `AGENTS.md` y sentido común.
**Coste**: cargar a mano el número del jurado antes de la demo.

## 13. Node 22 y Next 16 como base

**Por qué**: es lo que hay en `main` y lo que exige Vercel. La rama de dominio
se quedó en Next 15 solo porque la máquina de desarrollo tenía Node 18.
**Coste**: subir Node en todas las máquinas antes de fusionar nada.

## 14. Sondeo en la demo, Realtime cuando haya autenticación

Fase 1: el navegador habla con route handlers; tiempo real por Server-Sent
Events reemitidos desde el servidor. Fase 2: políticas de lectura por
pertenencia a la ejecución y suscripción directa a Supabase Realtime.

**Por qué**: abrir la base de datos al navegador sin autenticación de
operadores es un agujero, y la demo no necesita más que un flujo por servidor.
**Coste**: una pieza pequeña de reemisión. Se tira cuando llegue la fase 2.

---

## Decisiones que se descartaron, y por qué

- **Rehacer el stack en Python o cambiar de framework**: había 266 tests en
  verde sobre TypeScript y Next. El documento fuente eligió también el
  monolito TypeScript.
- **SQLite o dependencias nativas para persistir**: una compilación nativa
  fallida el día de la demo es un desastre. Se hizo en JSON; sobre `main` es
  Supabase.
- **Enums de Postgres**: ver decisión 11.
- **Que el LLM reparta recursos**: no es reproducible ni explicable, y la
  tabla de riesgos del documento lo desaconseja.
- **Todo por aprobación humana**: no es agéntico. Ver decisión 4.
- **Toda Andalucía en el mapa**: no se entiende en dos segundos. Una comarca.
