# thoughts/

Contexto de diseño para las personas y los agentes que trabajan en FARO.
Aquí no hay código: hay lo que se pensó, lo que se midió y lo que se decidió,
para que nadie tenga que redescubrirlo.

Está escrito sobre la base que hay en `main`: Next 16, Supabase con RLS,
Vercel Workflow, AI SDK y Zod. Gran parte del contenido viene de una rama
paralela (`feat/crisis-command-center`) donde se construyó y verificó el
dominio completo con estado en memoria; estos documentos son la transferencia
de ese trabajo a la base definitiva.

## Qué hay

| Documento | Para qué sirve | Léelo si… |
| --- | --- | --- |
| [data-model.md](data-model.md) | Modelo de datos completo sobre Supabase: 31 tablas con DDL y motivo campo a campo, contrato Zod, flujos, RLS, Realtime, escalabilidad y plan de migración | Vas a tocar el esquema, un repositorio o un esquema Zod |
| [features.md](features.md) | Qué se construyó, módulo a módulo: funciones, fórmulas, verificación y qué falta por enchufar | Vas a reimplementar o trasladar un módulo |
| [open-questions.md](open-questions.md) | Lo que nadie ha decidido todavía, ordenado por lo que bloquea | Quieres saber qué falta por acordar |

El documento fuente del proyecto está en la raíz del repositorio:
`HackSpain 2026 · Source of Truth del proyecto.md`. Estos documentos lo
desarrollan; si discrepan, manda el documento fuente y hay que actualizar esto.

## Cómo usarlo si eres un agente

1. Lee `AGENTS.md` y `CHALLENGE.md` primero, como siempre.
2. Antes de tocar el esquema, lee la sección 2 de `data-model.md`
   (principios) y la tabla de tu módulo. Cada módulo escribe solo sus tablas.
3. Si tu tarea es trasladar un módulo, `features.md` tiene sus funciones,
   sus fórmulas y sus cifras de referencia para comprobar que el traslado no
   cambió el comportamiento.
4. Si algo de aquí te parece mal, cámbialo, pero deja escrito el nuevo porqué
   en el mismo fichero.

## Cómo mantenerlo

- Un documento por tema. Sin duplicar lo que ya dice `README.md`, `AGENTS.md`
  o `TASKS.md`.
- Cuando algo de aquí se implemente, se actualiza el estado en `features.md`
  y se tacha en `open-questions.md`. No se borra: el porqué sigue valiendo.
- Cifras solo si se midieron. Si es una estimación, se dice.
- En español con acentos, como el resto del producto. Identificadores de código
  y SQL en inglés.
