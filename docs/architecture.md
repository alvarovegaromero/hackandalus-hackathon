# Arquitectura y decisiones

Este documento explica **por qué** el sistema está construido así. El _qué_ está
en el README; aquí quedan las decisiones y lo que cuestan.

Contexto que condiciona todo lo demás: es un proyecto de hackathon de fin de
semana, escrito en paralelo por varios agentes, y lo que se evalúa es una demo en
directo de unos minutos. Casi todas las decisiones de abajo son un intercambio
entre "correcto a largo plazo" y "demostrable el domingo sin que se caiga".

---

## Vista general

```
      señales                    decisión                    ejecución
  ┌───────────────┐        ┌───────────────────┐        ┌────────────────┐
  │ POST /events  │        │ priority.ts       │        │ happyrobot.ts  │
  │ demo/inject   │ ─────► │ resources.ts      │ ─────► │  (único punto  │
  │ scenario.ts   │        │ contacts.ts       │        │   de salida)   │
  │ (guion)       │        │ escalation.ts     │        └───────┬────────┘
  └───────────────┘        └─────────┬─────────┘                │
                                     │                          │ webhook
                              ┌──────▼──────┐                   │
                              │  store.ts   │ ◄─────────────────┘
                              │ (estado +   │   POST /actions/:id/status
                              │  orquesta)  │
                              └──────┬──────┘
                                     │
                        ┌────────────▼────────────┐
                        │ GET /api/situation      │
                        │ app/page.tsx (sondeo)   │
                        │ humano aprueba/cancela  │
                        └─────────────────────────┘
```

Una regla vertebra el diseño: **`store.ts` mantiene el estado y orquesta, pero no
decide**. Cada decisión vive en un módulo especializado al que `store.ts` llama.

---

## Decisión 1 — El estado vive en memoria, con persistencia opcional en JSON

`lib/store.ts` guarda toda la situación (señales, zonas, recursos, contactos,
acciones, planes, auditoría) en un objeto colgado de `globalThis`. No hay base de
datos.

**Por qué.**

- Una base de datos añade un servicio que arrancar, un esquema que migrar y un
  modo de fallo más el día de la demo. Ninguna de esas tres cosas suma puntos en
  el reto.
- La crisis dura lo que dura la demo. No hay ningún requisito de conservar el
  estado entre sesiones, salvo el bonus de aprendizaje.
- El estado completo cabe holgadamente en memoria: decenas de señales, zonas,
  recursos y acciones. Reconstruir el plan entero en cada cambio es más simple y
  más rápido que mantener índices incrementales, y elimina toda una familia de
  bugs de estado desincronizado.
- `globalThis` en vez de un módulo con estado suelto porque Next recarga los
  módulos en caliente durante `npm run dev`: sin `globalThis` la situación se
  reiniciaría sola cada vez que alguien guardase un fichero, en mitad de la demo.

**Lo que cuesta.**

- El estado se pierde al reiniciar el servidor. Es aceptable: `POST /api/demo/reset`
  existe precisamente para volver al punto de partida a propósito.
- No sobrevive a varias instancias del servidor. No hay despliegue horizontal, así
  que da igual.
- Los tests comparten estado dentro de un proceso, por eso `tests/` llama a
  `resetSituation()` en `beforeEach`.

**La persistencia es opcional y está apagada por defecto.** `lib/persistence.ts`
escribe JSON plano bajo `.data/` y solo actúa si `CRISIS_PERSISTENCE=on`. Es JSON
en fichero y no SQLite para no meter dependencias nativas (compilación, binarios
por plataforma) en un proyecto que tiene que arrancar en el portátil de cualquiera
del equipo. Sus funciones no pueden lanzar nunca: un disco lleno no puede tumbar
la demo, como mucho puede hacer que se pierda el historial.

> Estado real a día de hoy: las funciones de `persistence.ts` son _stubs_
> deliberados (`loadState` devuelve `null`, `saveState` no hace nada). El contrato
> está fijado y `store.ts` ya lo llama; la implementación es trabajo pendiente del
> agente propietario de ese módulo.

---

## Decisión 2 — La prioridad es determinista, no la decide un modelo de lenguaje

`lib/priority.ts` puntúa cada zona con una fórmula explícita: riesgo base de la
zona, severidad y confianza de las señales vivas, si están confirmadas, población
en riesgo, necesidades abiertas y recursos caídos. El resultado es un número y un
desglose de factores (`PriorityFactor[]`) que la interfaz enseña tal cual.

**Por qué no un LLM.**

1. **Se puede explicar.** El reto pregunta "¿sabe qué va primero cuando todo
   parece urgente?". Un número con su desglose responde a eso delante de un
   jurado; un párrafo generado, no. La UI puede enseñar _por qué_ una zona subió
   al primer puesto, factor a factor.
2. **Se puede testear.** `tests/priority.test.ts` fija que una señal crítica y
   confirmada supera a la prioridad inicial. Con un modelo detrás, ese test sería
   inestable y habría que aflojarlo hasta dejar de comprobar nada.
3. **Es reproducible en la demo.** El mismo guion da el mismo orden las veces que
   haga falta ensayarlo. Un modelo puede cambiar de opinión entre el ensayo y la
   presentación.
4. **No añade latencia ni una dependencia que pueda caerse.** La replanificación
   es síncrona y ocurre en cada cambio de estado: una llamada a un modelo en ese
   camino significaría esperas de segundos y un modo de fallo nuevo cada vez que
   entra una señal.
5. **Coste cero por replanificación.** El escenario replanifica decenas de veces
   en una demo de cinco minutos.

**Dónde sí encaja un modelo:** en los bordes, no en el núcleo de la decisión.
Clasificar texto libre de una llamada en `{zona, categoría, severidad}`, o
redactar el briefing que se le lee a un contacto. Es decir, en convertir lenguaje
en estructura, no en decidir a quién se salva primero.

**Lo que cuesta.** Los pesos están ajustados a mano y son opinables. Se mitiga
enseñando el desglose: si el jurado no está de acuerdo con la prioridad, al menos
ve exactamente qué la produjo y puede discutirla.

---

## Decisión 3 — Toda acción externa pasa por aprobación humana

Ninguna acción sale del sistema por sí sola. El ciclo es:

1. El sistema **propone**: la acción nace en estado `pending` y aparece en la cola
   de la interfaz con su objetivo, su destinatario, su zona y el motivo.
2. Una persona **aprueba** (`POST /api/actions/:id/approve`).
3. Solo entonces `happyrobot.ts` ejecuta, y la acción pasa a `running`.
4. El resultado vuelve —por la respuesta o por el webhook de estado— y la acción
   termina en `succeeded`, `failed`, `blocked` o `stalled`.

**Por qué.**

- El reto exige "una pantalla donde entender la situación, ver lo que hace el
  sistema e intervenir cuando haga falta". Un botón de aprobar es la forma más
  directa de que esa intervención sea real y no decorativa.
- Las acciones reales llaman por teléfono, escriben y abren tickets a personas.
  En una crisis simulada durante un hackathon, equivocarse de destinatario es un
  incidente de verdad, no un bug.
- La aprobación es el punto natural donde el estado se convierte en irreversible.
  Concentrar ahí la comprobación deja una única frontera que auditar.

**Salvaguardas encadenadas** (todas tienen que dar permiso para que salga algo):

| Salvaguarda           | Dónde                                                | Qué hace                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modo de ejecución     | `getExecutionMode()`                                 | Con `ACTION_EXECUTION_MODE` distinto de `happyrobot`, nada sale del proceso. Es el valor por defecto.                                                                          |
| Credenciales          | `isHappyRobotConfigured()`                           | Sin clave, URL base y agente, la ejecución real falla con un error explícito en vez de intentarlo a medias.                                                                    |
| Destinatario aprobado | `canReceiveLiveAction()` / `liveActionBlockReason()` | Un contacto sin `demoSafe` **degrada la acción a simulación** y explica por qué. En la semilla actual todos los contactos están marcados como no aptos.                        |
| Aprobación humana     | `approveAction()`                                    | Sin aprobación no se ejecuta nada.                                                                                                                                             |
| Idempotencia          | `idempotencyKey = "<id>:<intento>"`                  | Evita duplicar el aviso al reintentar o al recibir el mismo evento dos veces.                                                                                                  |
| Honestidad en la UI   | `IntegrationState`, `simulated`, ids `mock-…`        | Se cuentan por separado las acciones reales y las simuladas, y lo simulado lleva el prefijo escrito en el propio identificador para que ni un log pueda presentarlo como real. |

**Lo que cuesta.** El sistema no es completamente autónomo, y eso roza el criterio
de "decide y actúa por su cuenta". Se compensa con el resto: el sistema decide,
prioriza, asigna recursos, elige contacto y canal, y replanifica solo; lo único
que pide es el visto bueno antes de tocar el mundo real. Ese es además el diseño
que una sala de crisis de verdad querría.

---

## Decisión 4 — Módulos con un propietario claro

`lib/` está partido por responsabilidad y cada fichero declara su dueño en la
primera línea:

```ts
// PROPIETARIO: agente del motor de prioridad.
```

| Módulo           | Responsabilidad                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `types.ts`       | Frontera entre módulos. Los tipos compartidos y nada más.                                             |
| `validation.ts`  | Validación de entrada con zod y forma única de error para toda la API.                                |
| `store.ts`       | Estado y orquestación. Coordinación; no lo editan los agentes de módulo.                              |
| `priority.ts`    | Puntuar zonas y construir el plan.                                                                    |
| `resources.ts`   | Elegir, asignar y liberar recursos.                                                                   |
| `contacts.ts`    | A quién se avisa, por qué canal y con qué briefing.                                                   |
| `escalation.ts`  | Cadenas de escalado: qué pasa si el primero no contesta.                                              |
| `digitalTwin.ts` | Gemelo digital: estado percibido desde señales, divergencias y precisión frente a la verdad simulada. |
| `happyrobot.ts`  | Único punto de salida al exterior.                                                                    |
| `scenario.ts`    | El guion que hace que la situación cambie sola.                                                       |
| `history.ts`     | Historial de planes, diferencias entre versiones y auditoría.                                         |
| `learning.ts`    | Pesos aprendidos de ejecuciones anteriores (bonus).                                                   |
| `persistence.ts` | Guardar y restaurar, opcional.                                                                        |
| `seed.ts`        | Situación inicial y beats del guion.                                                                  |

**Por qué.**

- Varios agentes escriben a la vez. Sin fronteras de fichero, dos de ellos editan
  la misma función y el resultado es un conflicto o, peor, una fusión silenciosa
  que rompe algo. Un fichero con un dueño hace imposible ese choque.
- `types.ts` como contrato permite que un módulo se escriba contra la _forma_ de
  otro sin esperar a que esté implementado. Por eso `persistence.ts` puede ser
  hoy un conjunto de stubs sin bloquear a nadie.
- Concentrar la orquestación en `store.ts` deja un único sitio donde entender el
  ciclo completo. Cuando alguien pregunta "¿qué pasa cuando llega una señal?", la
  respuesta está en un fichero.
- Aísla el riesgo: si un módulo se rompe, se ve dónde y no contamina al resto.

**Lo que cuesta.** `store.ts` es el fichero más grande y es un cuello de botella
para los cambios que cruzan módulos. Es un intercambio consciente: preferimos un
punto de coordinación grande y explícito a tener la coordinación repartida y
que nadie sepa quién manda.

---

## Decisión 5 — Sondeo desde el navegador, no websockets

`app/page.tsx` pide `GET /api/situation` periódicamente y repinta. El visor
independiente `/telemetry` consume `GET /api/telemetry` por SSE de solo lectura;
ver [event-telemetry.md](event-telemetry.md). No sustituye el sondeo del centro
de mando ni comparte sus efectos laterales.

**Por qué.** El estado es pequeño, el servidor es local y una demo no nota la
diferencia entre un sondeo de un segundo y un push. Un websocket añadiría gestión
de conexión, reconexión y un modo de fallo visible en pantalla justo cuando más
importa. El sondeo, además, se autorrepara solo: si una petición falla, la
siguiente vuelve a traer la verdad entera.

**Efecto lateral que el diseño busca:** el sondeo es el reloj del sistema.
`GET /api/situation` llama a `pollSituation()`, que antes de devolver el estado
avanza el guion (`scenario.ts`) y barre las acciones atascadas. El navegador, al
preguntar, hace avanzar el tiempo.

Como eso ataría el guion a que alguien tenga la pestaña abierta, `scenario.ts`
mantiene además un latido de servidor (`ensureHeartbeat`) mientras el guion está
en marcha, y `POST /api/scenario/tick` permite empujarlo a mano desde fuera. Tres
relojes para el mismo motor, porque el que no puede fallar es el de la demo.

---

## Decisión 6 — El escenario está guionizado, pero se puede tocar a mano

`lib/scenario.ts` reproduce guiones formados por _beats_ con marca de tiempo —hay
tres: incendio, apagón e inundación—: el frente avanza, el viento gira, una
carretera se corta, un recurso cae. Se arrancan, se pausan y se aceleran desde
`/api/scenario/*`. Además, los botones de la interfaz permiten inyectar a mano
cualquiera de esas averías en el momento que haga falta.

**Por qué las dos cosas.** El guion demuestra que el sistema se adapta sin que
nadie lo empuje —el criterio de "entorno que cambia solo"—; los botones permiten
provocar exactamente el cambio que el jurado acaba de preguntar. Ensayo
reproducible y demo interactiva con el mismo motor detrás.

---

## Qué está implementado y qué no

| Pieza                                                                 | Estado                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Estado en memoria, replanificación, auditoría                         | Implementado                                                                                                     |
| Motor de prioridad determinista con desglose                          | Implementado                                                                                                     |
| Asignación de recursos, contactos, escalado                           | Implementado                                                                                                     |
| Adaptador HappyRobot con reintentos, timeout e idempotencia           | Implementado (ruta y cuerpo **sin verificar** contra la documentación privada; ver `docs/happyDocumentation.md`) |
| Aprobación humana y cola de acciones                                  | Implementado                                                                                                     |
| Validación de entrada y errores homogéneos en toda la API             | Implementado                                                                                                     |
| Guion que avanza solo, con tres escenarios y velocidad ajustable      | Implementado                                                                                                     |
| Gemelo digital con métricas de precisión, divergencia e incertidumbre | Implementado                                                                                                     |
| Persistencia en JSON                                                  | Contrato definido, implementación pendiente                                                                      |
| Aprendizaje entre ejecuciones                                         | Contrato definido, acumula estadísticas en memoria; no influye todavía en la puntuación                          |
