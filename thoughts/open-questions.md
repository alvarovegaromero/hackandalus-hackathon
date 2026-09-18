# Decisiones abiertas

Lo que nadie ha decidido todavía, ordenado por lo que bloquea.

## Bloquean la fusión

- [ ] **Node 22 en todas las máquinas.** `main` exige 22.21 y hay máquinas en
  18.19. Sin esto no se puede ni instalar.
- [ ] **Hasta dónde se lleva la fusión antes de congelar.** Opción A: todo el
  dominio sobre Workflow y Supabase. Opción B: núcleo determinista tal cual
  (TypeScript puro) y solo el ciclo de acción en Workflow, persistencia en
  Supabase detrás del puerto existente. La B es la que cabe en un fin de
  semana.

## Cambian el producto

- [ ] **Fórmula de prioridad.** Multiplicativa del documento
  (`G · log10(1+N) · V · 1/(1+t/15) · C`, fácil de contar en una frase) o
  aditiva de la rama de dominio (49 tests, decaimiento probado). El modelo de
  datos admite las dos con `formula_version`.
- [ ] **Escenario en Sierra Bermeja.** Confirmado en el documento; no hecho en
  código. Toca semillas y varios tests. Mantener los identificadores estables
  (`slug`) y cambiar solo nombres, coordenadas y puntos vulnerables reduce el
  impacto.
- [ ] **Modelo de IA principal** para coordinador y subagentes.
- [ ] **Tickets como acciones o como tabla propia.** Hoy son `actions` con
  `kind = 'ticket'`. Si hace falta responsable y vencimiento, se saca a tabla.

## Pendientes de contrato externo

- [ ] **Endpoint, autenticación, cabecera de idempotencia y forma del cuerpo de
  HappyRobot.** Todo es configurable por entorno; falta confirmarlo con la
  documentación privada.
- [ ] **Canales activos en la cuenta del hackathon** (voz, SMS, WhatsApp,
  email) y si se puede llamar a móviles españoles del jurado.
- [ ] **Cómo llegan los resultados**: webhook, API de ejecuciones, ambos.
- [ ] **Límites de Jev** por minuto en la cuenta.

## Seguridad y datos

- [ ] **Cifrado de `contact_channels.address`** con Supabase Vault antes de
  cargar el número del jurado.
- [ ] **Tiempo real en fase 1**: Server-Sent Events desde el servidor, o abrir
  ya políticas de lectura para `authenticated` con un login mínimo.
- [ ] **Licencia.** Quedó MIT a nombre de "hackandalus-hackathon contributors"
  en la rama de dominio. Confirmar o cambiar.

## Interfaz

- [ ] **Distribución de seis zonas** del documento fuente. Cuatro componentes
  escritos sin conectar: `AgentStrip`, `ChaosBar`, `ContextPanel`,
  `PriorityBoard`.
- [ ] **Rutas que la interfaz ya llama y no existen**: asignar recurso a una
  acción, pausar autonomía, aceptar o rechazar lecciones.
- [ ] **Steering en lenguaje natural**: la caja existe en el diseño; falta el
  intérprete (AI SDK con `interpretedDirectiveSchema`).

## Ruido del escenario

- [ ] Generar el aluvión de cuarenta mensajes al disparar el beat, o
  pregenerarlo como señales con `received_at` futuro para poder inspeccionarlo
  antes de la demo.
