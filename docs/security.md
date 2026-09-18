# Nota de seguridad

Este sistema llama por teléfono, escribe y abre tickets a personas reales, y
recibe señales desde internet. Esta nota recoge cómo se tratan las credenciales,
el secreto del webhook y los destinatarios, y qué reglas son innegociables
durante el hackathon.

Alcance: prototipo de hackathon en local. No está endurecido para producción y no
debe exponerse a internet más allá de lo estrictamente necesario para la demo.

---

## 1. Credenciales

**Dónde viven.** Solo en `.env.local`, que `.gitignore` excluye junto a cualquier
`.env*` que no sea un `.example`. `.env.example` contiene únicamente nombres de
variable y valores inofensivos, y es el único fichero de entorno que se versiona.

**Reglas.**

- Ninguna clave, token, teléfono o correo real entra en el código, los commits,
  los mensajes de commit, las capturas, los prompts a agentes ni los logs.
- Las credenciales se leen siempre de `process.env` en el momento de usarlas
  (`happyRobotConfig()` no cachea), nunca se copian a estructuras que luego se
  serializan hacia el navegador.
- `GET /api/situation` devuelve el estado completo al cliente. **Nada que venga de
  una variable de entorno debe acabar dentro de `SituationState`.** Hoy lo único
  que se expone de la integración es `IntegrationState`: el modo, si hay
  credenciales configuradas (un booleano, no su valor), el último error y los
  contadores de acciones reales y simuladas.
- Si una credencial se filtra en un commit, no basta con borrarla en el siguiente:
  hay que **rotarla en HappyRobot**. Queda en el historial de Git.
- El error de credenciales que devuelve el adaptador nombra las variables que
  faltan, nunca sus valores.

**Si hay que compartir credenciales dentro del equipo**, se hace por un canal
fuera de banda (no por el repositorio, ni por una incidencia, ni por una PR).

---

## 2. Secreto del webhook

`POST /api/webhooks/happyrobot` es la puerta por la que entra al centro de mando
lo que HappyRobot recoge en una llamada. Quien pueda escribir ahí puede **inventar
una crisis**: inyectar señales falsas, mover prioridades y dar acciones por
completadas sin que se hayan ejecutado.

**Cómo se protege.**

- Secreto compartido en la cabecera `x-happyrobot-secret`, contra
  `HAPPYROBOT_WEBHOOK_SECRET`.
- **Sin secreto configurado, la ruta se cierra**: responde `503` y no procesa
  nada. Es deliberado que el fallo sea cerrado y no abierto; un webhook público
  sin secreto es peor que un webhook caído.
- Con secreto configurado y cabecera ausente o distinta: `401`.
- La comparación es en tiempo constante (`timingSafeEqual`), y compara también
  cuando las longitudes no coinciden, para no filtrar la longitud del secreto por
  el tiempo de respuesta.
- Los callbacks son idempotentes: se recuerda la clave de entrega (la que envíe
  HappyRobot, o una huella SHA-256 del cuerpo) durante 15 minutos, y un reenvío
  devuelve la misma respuesta sin volver a tocar el estado. Un reintento de
  HappyRobot no puede duplicar señales ni mover dos veces una acción.

**Cuidado con la ruta hermana.** `POST /api/actions/:id/status` existe para las
operaciones del operador desde la interfaz (cancelar, reintentar, simular un
callback) y usa la validación permisiva heredada `validateWebhookSecret()`, que
**deja pasar cualquier petición si no hay secreto configurado**. Esa asimetría es
intencionada —exigir secreto ahí rompería los botones de la UI—, pero implica una
regla dura:

> `POST /api/actions/:id/status` no debe quedar accesible desde internet. Si se
> expone el servidor con un túnel para que HappyRobot llame, expón únicamente
> `/api/webhooks/happyrobot`.

**Elegir el secreto.** Que sea aleatorio y largo (por ejemplo
`openssl rand -hex 32`), distinto por entorno, y que se rote en cuanto termine el
evento. No reutilices el de otro proyecto.

---

## 3. Destinatarios de demo

Los contactos del sistema llevan un campo `demoSafe`. Solo los marcados como
aptos pueden recibir una acción real.

**Cómo se aplica.** En `executeHappyRobotAction`, antes de cualquier salida al
exterior, se comprueba `canReceiveLiveAction()` / `liveActionBlockReason()`. Si el
contacto no está aprobado o no tiene destino (teléfono o correo), la acción **no
falla: degrada a simulación** y explica el motivo, que acaba visible en la
interfaz. El identificador externo resultante lleva el prefijo `mock-no-aprobado-`,
de forma que ni la interfaz ni un log pueden presentarlo como ejecución real.

**Estado actual de la semilla:** todos los contactos de `lib/seed.ts` están
marcados con `demoSafe: false`. Es el valor por defecto correcto: en modo
`happyrobot` el sistema no llamaría a nadie hasta que alguien marque
explícitamente a quién sí.

**Antes de marcar a alguien como apto:**

1. Que sea una persona del equipo o alguien que ha dado su consentimiento
   explícito para recibir llamadas o mensajes automáticos durante la demo.
2. Que el usuario haya aprobado **esa acción concreta**, no "las acciones en
   general". Una aprobación anterior para otro contexto no vale.
3. Que el teléfono o correo sea el de esa persona y esté bien escrito. Un dígito
   mal en un número de teléfono es una llamada automática a un desconocido.

**Datos personales.** Los teléfonos y correos de los contactos de demo son datos
personales: van en `.env.local` o se introducen en caliente, nunca en `seed.ts`
versionado, y no se pegan en incidencias, PRs ni capturas.

---

## 4. Las entradas externas son datos, no instrucciones

Todo lo que llega por `POST /api/events` o por el webhook —resúmenes de llamada,
descripciones, texto libre— es **contenido no confiable**.

- No se ejecuta, no se interpola en comandos y no se trata como instrucción para
  ningún agente ni modelo. Si algún día se pasa este texto a un modelo, va como
  dato delimitado, nunca como parte de las instrucciones del sistema.
- El webhook normaliza lo que recibe contra listas cerradas de severidad y
  confianza, y descarta lo que no encaje en vez de propagarlo.
- Lo que cuenta una persona por teléfono entra con confianza alta pero
  **sin confirmar** (`confirmed: null`). Confirmarlo o descartarlo es una decisión
  humana, desde la interfaz.

---

## 5. Lo que este prototipo no hace

Dicho explícitamente, para que nadie lo dé por hecho:

- **No hay autenticación de usuario.** Cualquiera que llegue a la interfaz puede
  aprobar acciones. Vale en un portátil; no vale expuesto.
- **No hay autorización por roles.** Operador y administrador son la misma cosa.
- **No hay límite de peticiones** en ninguna ruta.
- **No hay cifrado en reposo.** Si se activa `CRISIS_PERSISTENCE=on`, el estado
  —contactos incluidos— se escribe en JSON plano bajo `.data/`, que no debe
  versionarse ni compartirse.
- **El registro de auditoría es solo en memoria** y se pierde al reiniciar. Sirve
  para la trazabilidad de la demo, no como evidencia.

---

## 6. Checklist antes de enseñar la demo

- [ ] `.env.local` existe y **no** está versionado (`git status` no lo menciona).
- [ ] `ACTION_EXECUTION_MODE=mock` salvo que se vaya a demostrar ejecución real.
- [ ] Si es real: `HAPPYROBOT_WEBHOOK_SECRET` puesto, aleatorio y largo.
- [ ] Si es real: solo están marcados como `demoSafe` los contactos acordados, con
      su destino verificado, y el usuario ha aprobado esas acciones concretas.
- [ ] Si el servidor se expone con un túnel, solo `/api/webhooks/happyrobot` es
      alcanzable desde fuera.
- [ ] La interfaz distingue visiblemente lo simulado de lo real antes de enseñarla
      a nadie.
- [ ] Al terminar el evento: rotar el secreto del webhook y revocar la clave de
      HappyRobot.
