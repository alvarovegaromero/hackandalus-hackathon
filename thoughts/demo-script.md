# Guion de la demo

Lo que se enseña, en qué orden, y qué criterio de evaluación demuestra cada
momento. Basado en el guion del documento fuente y en cómo se comporta el motor
de escenario construido. Cinco minutos, la mayor parte con el sistema
funcionando y no con diapositivas.

---

## Antes de empezar

- Pedir el número de un miembro del jurado para que haga de alcalde. Plan B:
  el número de un compañero en el público. Darlo de alta como contacto
  `demo_safe` con nota de consentimiento.
- Ejecutar el escenario una vez completo (`kind: drill`) para que haya
  lecciones cargadas.
- Arrancar con `ACTION_EXECUTION_MODE=happyrobot` **solo** si los pasos de
  activación real están hechos; si no, en simulación y decirlo.
- Vídeo de respaldo grabado. Proyectar siempre el panel; nunca la terminal.
- Ensayar con `speed: 4` (todo el guion en ~50 s) y presentar a `speed: 1`.

## Minuto a minuto

| Tiempo | Qué pasa | Quién habla | Criterio |
| --- | --- | --- | --- |
| 0:00–0:30 | Gancho: "Son las 16:05, entran cuarenta mensajes. Solo tres importan. ¿Cuáles?" Pantalla con el aluvión. | Presentador | Problema |
| 0:30–1:15 | Triaje en vivo: un bulo descartado con motivo, duplicados fusionados, una señal al 62 % que dispara una llamada de verificación. Se oye la llamada. | Presentador y audio | Decisión |
| 1:15–2:00 | Ranking con desglose visible. Tres ambulancias, cinco peticiones: se ve quién espera y por qué. **Suena el móvil del jurado**: el sistema le llama como alcalde y le pide abrir el pabellón. | Jurado responde | Prioridad, Coordinación, Ejecución |
| 2:00–3:15 | "Elegid qué rompemos." El jurado pulsa girar el viento. El supuesto del viento se pone en rojo, el plan pasa a inválido, aparece el v2 con diff. La evacuación de la residencia entra en la cola de aprobación. Se aprueba. | Jurado y operador | Adaptación, Control |
| 3:15–3:45 | Segundo caos: cae el SMS. El sistema pasa a voz sin intervención y lo anota. | Operador | Adaptación, Ejecución |
| 3:45–4:15 | Panel de lecciones de la ejecución anterior. En el feed, una acción etiquetada "SMS en vez de llamada · lección #3". | Presentador | Aprendizaje |
| 4:15–5:00 | Cierre con métricas: señales triadas, llamadas, confirmaciones, tiempo medio de replanificación, coste del triaje. Frase final. | Presentador | Creatividad, impacto |

**Frase de cierre**: "En la DANA y en los grandes incendios el problema no fue
la falta de datos, sino decidir y avisar a tiempo con datos incompletos. FARO
está hecho para ese minuto."

## Dos golpes que el motor permite sin miedo

- **Parar y reanudar.** Pulsar parar sobre el 1:30, hablar treinta segundos de
  arquitectura, pulsar arrancar. Reanuda en 1:30; no reinicia.
- **Dejar de mirar.** Si alguien se distrae y el sondeo se interrumpe, el
  sistema salta al presente en vez de reproducir la historia atrasada. Los
  beats omitidos quedan en pantalla como omitidos.

## Los cuatro botones de caos

Grandes, claros, para que los pulse el jurado. Todos están también programados
en el guion por si nadie pulsa; el orden puede cambiar sin romper nada.

| Botón | Qué rompe | Qué debe verse |
| --- | --- | --- |
| Girar el viento | Supuesto `wind.direction` | Plan en rojo, residencia a prioridad 1, evacuación en cola de aprobación |
| Cortar la carretera | Supuesto `roads.A-397` | Autobuses reasignados por la MA-8301, ETA recalculada |
| Tumbar el SMS | Supuesto `channels.sms` | Las acciones por SMS pasan a voz; el fallo de integración queda visible, no oculto |
| +50 personas | `people_exposed` del camping | Reprioriza y muestra quién queda esperando |

## Preguntas probables y respuesta corta

- **¿Qué pasa si el modelo se equivoca?** Las acciones irreversibles siempre
  pasan por una persona; todo queda registrado con su confianza y su entrada.
- **¿Escala a una crisis real?** El triaje cuesta céntimos por señal;
  HappyRobot mueve miles de interacciones al día.
- **¿Qué es real y qué simulado?** Llamadas, SMS y tickets son reales; el
  mundo (fuego, sensores) es simulado. El contador de la pantalla lo dice en
  todo momento.
- **¿Por qué no eligió el recurso más cercano?** El motivo de la asignación lo
  dice: "está más cerca pero no cubre triaje".

## Congelación

Código congelado antes de los ensayos finales. A partir de ahí, solo ensayos
con cronómetro.
