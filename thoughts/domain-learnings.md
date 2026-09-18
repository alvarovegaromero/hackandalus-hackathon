# Lo que aprendimos construyendo el dominio

Fallos reales encontrados ejecutando código, cómo se arreglaron, y las
invariantes que conviene no romper al reimplementar sobre Supabase y Workflow.
Todo lo de aquí se midió; nada es hipótesis.

---

## Los once fallos del prototipo original

| # | Fallo | Causa | Arreglo |
| --- | --- | --- | --- |
| 1 | Descartar una señal no revertía nada: la zona seguía en crítico, con el riesgo subido y una llamada propuesta | La señal mutaba la zona al llegar y nadie deshacía la mutación | Anotar en la señal el efecto exacto aplicado y revertirlo al descartar. En el modelo nuevo: no mutar, derivar la presión de las señales vivas |
| 2 | El ruido ganaba a la señal: ocho avisos low/low sin confirmar subían la zona más tranquila al segundo puesto | Suma sin tope, sin decaimiento, confianza como sumando fijo, cada categoría añadía una necesidad perpetua | Credibilidad multiplicativa, decaimiento por antigüedad, apilado con rendimientos decrecientes, techo por zona |
| 3 | Los recursos nunca se asignaban y el primero libre del array servía para todo | Stub que devolvía `find(status === "available")` | Puntuación por capacidad, distancia, suficiencia y estado; `unavailable` excluido siempre |
| 4 | Completar una acción no bajaba nunca la prioridad de su zona | El motor ignoraba el estado de las acciones | Factor de alivio con decaimiento, amortiguado y limitado al 50 % |
| 5 | "Recurso caído" tumbaba un recurso del que nada dependía y el plan saltaba dos versiones | Elegía el primero no caído; `addEvent` replanificaba y luego se replanificaba otra vez | Elegir un recurso con acciones vivas; una sola replanificación |
| 6 | "Fallo de integración" marcaba como fallida una acción ya completada | Elegía la primera no cancelada sin mirar el estado | Elegir una en `running`, si no en `approved` o `pending` |
| 7 | Cancelar durante una llamada en vuelo se perdía: al volver la respuesta, el estado se sobrescribía | Nada comprobaba el estado tras el `await` | Capturar el intento al despachar; si al volver la acción no está en `running` con ese intento, descartar la respuesta |
| 8 | Con el secreto del webhook definido, los botones de cancelar y reintentar devolvían 401 | La misma ruta atendía el callback externo y las operaciones del operador | Ruta de webhook separada con secreto obligatorio; la de estado sin secreto |
| 9 | JSON malformado devolvía 500; una zona inexistente se aceptaba y se guardaba sin aparecer en ningún plan | Casteo de TypeScript sin validación en tiempo de ejecución | Zod estricto en todas las rutas, referencias comprobadas contra el estado vivo |
| 10 | Los marcadores del mapa eran botones sin manejador | Interfaz a medio hacer | Detalle de zona con desglose de la puntuación |
| 11 | Una acción en curso podía quedarse así para siempre | Sin vigilante | Estado `stalled` explícito, barrido en cada sondeo, recurso liberado |

Y uno que encontró un test recién escrito sobre el propio arreglo del fallo 1:
al descartar una señal se borraba una necesidad que otra señal viva seguía
pidiendo, porque solo la primera señal que introduce una necesidad la anota.
Se compara ahora por categoría derivada. Moraleja: **cada arreglo con test
permanente, no con prueba desechable.**

---

## Invariantes que no hay que romper

1. **Descartar es excluir, no revertir.** Sobre Supabase, la presión de un
   incidente se calcula desde sus señales vivas. Nunca guardar el efecto de
   una señal como mutación de otra tabla.

2. **Idempotencia por intento.** `idempotency_key = "<id>:<attempt>"`. El
   reintento del operador estrena clave; el reintento interno del adaptador la
   reutiliza. Los webhooks de entrada se deduplican aparte, por id de entrega
   o hash del cuerpo.

3. **Una respuesta tardía nunca pisa una decisión humana.** Comparar estado e
   intento antes de aplicar cualquier resultado externo. En Workflow, el paso
   que recibe el webhook debe leer el estado actual de la acción, no el que
   tenía al despachar.

4. **Nada sale al exterior sin destinatario aprobado.** `demo_safe` y dato de
   contacto utilizable, comprobados en el adaptador, no solo en la interfaz.
   Degradar a simulación y explicarlo; nunca fallar en silencio ni fingir
   éxito.

5. **Una acción bloqueada por recurso se bloquea antes de la llamada externa.**
   El orden es: comprobar recurso → si falta, `blocked` y salir → si no,
   despachar. Al revés se avisa de un recurso que no va a llegar.

6. **Lo simulado se etiqueta en el dato, no en la interfaz.** `execution_mode`
   es columna de la acción. El contador de reales frente a simuladas se
   calcula desde ahí.

7. **El aprendizaje tiene mínimos de muestra.** Canal 5, contacto 4, castigo a
   señales sin confirmar 3 ejecuciones y 8 señales. Por debajo, el peso no se
   publica. Un sistema que sobrerreacciona a una llamada fallida es peor que
   uno que no aprende.

8. **Categorías, capacidades y necesidades son claves, no texto.** Sin
   acentos, en `kebab-case`, estables. Los nombres para pantalla van aparte.
   Acentuar una clave rompe el emparejamiento de recursos y contactos.

9. **Un beat por tick, y los atrasados se omiten con traza.** Reproducir tres
   minutos de historia de golpe arruina el diff y la auditoría. El beat vencido
   más reciente nunca se omite.

10. **Cada decisión deja motivo legible.** Si una función no puede rellenar
    `reason`, la decisión no está bien definida.

---

## Trampas concretas

- **"Coordinar" como comodín.** El orquestador redactaba todos los objetivos
  como "Coordinar respuesta de X en Y"; la palabra "coordina" en la tabla de
  necesidades convertía al enlace de comunicaciones en candidato universal,
  capaz de apagar un incendio. La necesidad real es la categoría.

- **Deduplicación que rejuvenece.** Fusionar una señal repetida actualiza su
  `received_at`, lo que la mantiene fresca frente al decaimiento. Es
  intencionado (una señal que se repite vuelve a ser noticia) y está contenido
  por el apilado amortiguado, pero si alguien amplía la ventana de dedupe (5
  min) conviene revisarlo.

- **Doble contabilidad entre módulos.** En la rama de dominio, el orquestador
  subía el riesgo de la zona por cada señal y el motor de prioridad lo
  descontaba para recontarlo con decaimiento. Funcionaba con un contrato
  documentado y frágil. El modelo de datos nuevo lo elimina: `areas.base_risk`
  es riesgo estructural puro.

- **La misma ruta para el callback externo y los botones.** Cualquier
  autenticación que se ponga al callback rompe la interfaz. Separar siempre.

- **Servidor de desarrollo obsoleto.** Un `next dev` levantado antes de una
  migración de framework sigue sirviendo el binario viejo y devuelve 500 en
  todo. Reiniciarlo tras cualquier cambio de dependencias.

- **Techo de Node.** Next 16 exige Node 20.9; el andamiaje de `main` pide
  Node 22.21. Una máquina en Node 18 no puede ni instalar. Subir Node en todas
  las máquinas antes de tocar nada.

- **`git commit` commitea el índice entero.** Con varios agentes trabajando en
  el mismo árbol, `git add fichero && git commit` arrastra lo que otro haya
  dejado preparado. Comprobar `git diff --cached --stat` antes de cada commit.

- **Reformatear con Prettier mientras otros escriben** destruye su trabajo.
  Pasada única en un commit aislado, cuando nadie más edita.

---

## Números de referencia

| Medida | Prototipo original | Al congelar |
| --- | --- | --- |
| Tests | 9 | 266 |
| Ranking con ocho señales de ruido en la zona más tranquila | 2.ª de 5, 143 puntos | 4.ª de 5, 40 puntos |
| Puntuación de la zona al completar su acción | sin cambio | baja 20 |
| Asignación al caer la unidad sanitaria de Sevilla | brigada forestal de otra zona | unidad sanitaria de Granada, con motivo |
| Acciones invalidadas al caer un recurso en la demo | ninguna | las que dependían de él |
| Vulnerabilidades en producción | 2 críticas | 0 |
| Acciones reales que pueden salir sin aprobación | indefinido | 0, con test |

---

## Cómo se trabajó en paralelo sin colisiones

Ocho agentes a la vez sobre el mismo árbol, cada uno con lista cerrada de
ficheros propios y lista de ficheros prohibidos. `types.ts` como contrato
compartido, escrito primero por una sola persona con stubs que compilaban y
pasaban los tests existentes. `store.ts` como orquestador de un único
propietario que aplicaba los enganches que los demás pedían en su informe.
Ficheros de test también por propietario. Funcionó: cero conflictos de edición
en toda la sesión. Sobre Supabase, la misma regla se traduce en módulos que
escriben solo sus tablas.
