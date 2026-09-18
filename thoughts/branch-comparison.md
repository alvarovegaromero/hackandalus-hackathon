# Qué conservar de cada rama

Comparación entre `feat/crisis-command-center` (dominio, tests, interfaz) y el
andamiaje que ya está en `main` (Next 16, Supabase, Vercel Workflow, AI SDK).
No compiten: una tiene el dominio, la otra la infraestructura que el documento
fuente fija como obligatoria. La decisión es en qué orden se fusionan.

---

## Los números

| Medida | Dominio | Andamiaje |
| --- | --- | --- |
| Tests | 266 en 10 ficheros | 3 |
| Código sin tests | 12 422 líneas | 667 |
| Módulos de dominio | 16 | 3 ficheros |
| Rutas de API | 12 | 2 |
| Vulnerabilidades en producción | 0 | 0 |
| Node | ≥ 18.18 (Next 15) | ≥ 22.21 (Next 16) |

---

## Capacidad por capacidad

| Capacidad | Dominio | Andamiaje |
| --- | --- | --- |
| Motor de prioridad | Decaimiento, credibilidad, rendimientos decrecientes, desglose. 49 tests | Devuelve la gravedad tal cual |
| Asignación de recursos | Capacidad, distancia, suficiencia, quién espera | Solo la tabla |
| Triaje calibrado | Tres salidas con probabilidad y verificación | No |
| Supuestos vivos | Sí, con explicación de sala | No |
| Autonomía graduada | Sí, con interruptor | No |
| Contactos y escalado | Por rol, canal aprendido, cadenas de 3–4 escalones | No |
| Adaptador HappyRobot | Configurable, timeout, reintentos, idempotencia, salvaguarda | Once líneas que devuelven `blocked` |
| Escenario | Tres guiones, pausa, velocidad, latido | No |
| Panel de operador | Catorce componentes conectados | Cincuenta y dos líneas, simulación en navegador |
| Ejecución duradera | **No.** Las cadenas de escalado no se ejecutan por esto | **Sí.** Vercel Workflow con `"use workflow"` y `"use step"` |
| Capa de modelo | **No.** Todo plantillas | **Sí.** Coordinador con AI SDK, salida estructurada, respaldo sin claves |
| Base de datos | Memoria más JSON opcional | **Sí.** Supabase con RLS y permisos revocados a `anon` |
| Tiempo real | Sondeo de 4 s | Ayudante de Supabase Realtime |
| Cadena de herramientas | Next 15.5, TS 5.9, Vitest 3 | Node 22, Next 16, TS 6, Vitest 5, `.nvmrc` |

---

## Conservar del dominio

1. **Todo el núcleo determinista**: prioridad, recursos, triaje, supuestos,
   autonomía, contactos, escalado, aprendizaje, historial, auditoría.
2. **Los 266 tests.** Cubren replanificación, restricciones de recursos y
   fallos de integración, que es lo que pide el enunciado.
3. **El adaptador HappyRobot con su salvaguarda.** Hoy es imposible que salga
   nada sin destinatario aprobado.
4. **El panel de operador.**
5. **Endurecimiento de API, integración continua y documentación.**

## Conservar del andamiaje

1. **Vercel Workflow.** Es lo que más falta. Sin ejecución duradera no hay
   esperas de webhook ni reintentos, y por eso las cadenas de escalado no se
   ejecutan.
2. **El patrón del coordinador con AI SDK**: salida estructurada validada con
   Zod, respaldo determinista sin claves, y la línea del prompt que dice que el
   contenido de los eventos son datos, no instrucciones.
3. **El esquema Supabase con RLS por defecto.** Seguridad que habría que
   inventar igualmente. Realtime sustituye al sondeo.
4. **La cadena de herramientas y el `.nvmrc`.**
5. **La disciplina de `TASKS.md`.** Dice qué no está hecho.

---

## El bloqueo previo

**Node 18 contra Node 22.** La máquina de desarrollo de la rama de dominio corre
18.19.1. `main` exige 22.21. Por eso la rama de dominio se quedó en Next 15: no
fue preferencia, fue el techo instalado. Nada avanza hasta que todo el equipo
esté en Node 22.

---

## Forma de fusión recomendada

El sobre del andamiaje, el núcleo del dominio.

1. **Subir a Node 22** y adoptar la cadena de herramientas de `main`. Los
   cambios de API ya están hechos en la rama de dominio (parámetros asíncronos,
   ESLint plano); el salto queda casi en versiones.
2. **Mover el dominio dentro de `src/`.** Los dieciséis módulos entran como
   núcleo determinista. `domain.ts` del andamiaje es un subconjunto de los tipos
   y validación del dominio; se sustituye.
3. **Envolver el ciclo de crisis en Workflow.** Empezar por la cadena de
   escalado, que hoy se construye y no se ejecuta. Es también lo que da
   reintentos y esperas de webhook.
4. **Enchufar el AI SDK donde aporta**: redacción por rol y steering. No en
   prioridad, reparto ni supuestos.
5. **Sustituir la persistencia por Supabase** detrás del puerto que ya existe,
   siguiendo `data-model.md`.

**Riesgo a decidir en equipo**: rehacer 266 tests sobre Workflow y Supabase a
mitad de hackathon es un riesgo real. El documento fuente dice que si no sale
en la demo, no se construye. Una opción es llevar el núcleo determinista tal
cual (es TypeScript puro, sin dependencias de framework) y envolver solo el
ciclo de acción en Workflow.
