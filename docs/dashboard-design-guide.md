# Guía de diseño del dashboard

Guía de referencia para construir la interfaz humana del sistema de gestión de crisis.
Responde a los requisitos de `CHALLENGE.md`: ver en dos segundos qué pasa y qué ha cambiado, entender qué hace el sistema e intervenir.
Es agnóstica del escenario: vale para incendio, inundación, apagón u otro, siempre que haya ubicaciones que pintar en un mapa.

## 1. Decisiones de partida

| Tema            | Decisión                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Audiencia       | Un operador lo usa en portátil y el mismo layout se proyecta ante el jurado.                        |
| Foco visual     | Mapa de situación en el centro.                                                                     |
| Replanificación | Resaltado temporal de lo que cambia, con decaimiento en minutos y marcas en la línea temporal.      |
| Intervención    | Aprobar o cancelar acciones, reordenar prioridades e inyectar eventos.                              |
| Métricas        | Recursos libres/asignados, estado de acciones, personas afectadas/notificadas y evolución temporal. |
| Tema            | Oscuro por defecto, claro como alternativa validada para proyectores que lavan los negros.          |
| Señal/ruido     | Feed de entrada con los relevantes explicados y los descartados plegados.                           |

## 2. Principios

1. **Todo a la vista.** Nada crítico detrás de pestañas, modales o scroll a 1440×900.
2. **Se lee de izquierda a derecha como el sistema:** entra información, se ve la situación, se decide y se actúa.
3. **El color tiene un trabajo o no aparece.** Estado, identidad de recurso o nada; nunca decoración.
4. **Nunca solo color.** Todo estado lleva icono y texto; todo recurso lleva forma e identidad textual.
5. **Simulado no es real.** Cualquier acción simulada se distingue a primera vista de una ejecutada de verdad (lo exige `PROJECT.md`).
6. **Lo que cambió se nota sin buscarlo** y se sigue notando unos minutos después.
7. **Cada decisión del agente lleva su porqué** en una línea legible.
8. **Tinta recesiva, datos protagonistas.** Rejillas y ejes en hairline, fondos neutros, marcas finas.

## 3. Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ BARRA DE ESTADO: escenario · reloj · agente · integraciones ·     │
│                  última replanificación · [+ Inyectar evento]     │
├──────────────────────────────────────────────────────────────────┤
│ KPI: Afectados │ Notificados │ Confirmados │ Peticiones sin cubrir│
├─────────────┬────────────────────────────────┬───────────────────┤
│ ENTRADA     │                                │ PRIORIDADES       │
│ relevantes  │            MAPA                │ 1. ... [✓] [✕] ↑↓ │
│ + motivo    │    incidentes + recursos       │ 2. ... [✓] [✕] ↑↓ │
│             │    + zona afectada             │ 3. ...            │
│ ▸ 97 desc.  │                                │ ESTADO ACCIONES   │
├─────────────┴────────────────┬───────────────┴───────────────────┤
│ RECURSOS libres / asignados  │ EVOLUCIÓN TEMPORAL + replanes      │
└──────────────────────────────┴───────────────────────────────────┘
```

- Rejilla CSS de tres columnas: `minmax(280px, 1fr) minmax(0, 2.2fr) minmax(320px, 1.2fr)`.
- El mapa ocupa como mínimo el 45% del ancho y el 50% del alto útil.
- Las columnas laterales hacen scroll interno; la página no hace scroll a 1440×900 o mayor.
- Por debajo de 1280px de ancho, una sola columna en este orden: estado, KPI, prioridades, mapa, entrada, recursos, evolución.
  Móvil no es objetivo; basta con que no se rompa.
- Separación entre paneles de 16px; padding interno de panel de 16px; radio de panel y tarjetas de 16px (`rounded-2xl`), elementos de navegación en 8px y CTAs estilo pill (`rounded-full`).
- **Sistema de diseño y blueprint visual:**
  - **Tipografía:** SF Pro / sistema sans con regular y medium, con letter-spacing de `-0.15px` para máxima legibilidad táctica.
  - **Escala de fuentes:** 12px (metadatos/badges), 13px (cuerpo compacto/botones), 14px (texto estándar/subtítulos) y 24px (números clave/KPIs).
  - **Jerarquía de neutros:** `#292929` (fondo de paneles secundarios y bordes oscuros), `#5D5D5D` (texto secundario/iconos neutros) y `#9E9E9E` (tinta atenuada y subtítulos).
  - **Iconos:** 14px para navegación y botones (`Button`), 20px para cabeceras de tarjeta (`CardHeader`).
  - **Primitivas UI (estilo shadcn):** `Button`, `Badge`, `Card` en `app/components/ui/` con `cn` (`clsx` + `tailwind-merge`).

## 4. Zonas

### 4.1 Barra de estado

Responde a "¿el sistema funciona y qué está haciendo?".

- Nombre del escenario y reloj de la simulación o real, con indicación explícita de cuál es.
- Estado del agente: `Activo`, `Replanificando`, `En espera de aprobación`, cada uno con icono.
- Salud de integraciones (HappyRobot y resto): `Conectada`, `Degradada`, `Caída`, con color de estado + icono + texto.
  Si una integración cae, la barra lo dice aunque nadie mire otra zona.
- Última replanificación: hora y causa en una línea, por ejemplo `12:20 · Replan por: carretera N-340 cortada`.
- Botón `Inyectar evento` que abre un formulario con resumen, severidad, origen y ubicación.
- Si hay datos simulados en pantalla, una etiqueta `DATOS SIMULADOS` permanente en la barra.

### 4.2 Fila de KPI

Cuatro stat tiles, no gráficos: aquí el número es el gráfico.

| Tile                  | Valor                                 | Contexto                                                |
| --------------------- | ------------------------------------- | ------------------------------------------------------- |
| Afectados             | Personas afectadas estimadas          | Delta en los últimos 5 min (`+50 en 5 min`)             |
| Notificados           | Personas avisadas                     | `de N afectados` y porcentaje                           |
| Confirmados           | Personas que han confirmado recepción | `de N notificados`                                      |
| Peticiones sin cubrir | Solicitudes de recurso sin asignar    | En estado crítico (icono + color) cuando es mayor que 0 |

- Valor en 40px peso 600 en portátil; etiqueta en 14px tinta secundaria encima.
- El delta usa tinta de texto, no color de serie, con flecha como indicador de dirección.
- Estimaciones marcadas con `≈` y la palabra `estimado`; el sistema nunca tiene todos los datos y debe decirlo.
- Sin sparkline en los tiles: la evolución vive en su propio panel.

### 4.3 Entrada (señal y ruido)

Responde a "qué información importa".

- Lista cronológica inversa de mensajes relevantes: hora, icono de origen (llamada, mensaje, sensor, operador, webhook), resumen de una línea y el motivo en tinta secundaria, por ejemplo `Motivo: sube prioridad de Barrio Norte`.
- Los descartados se agrupan al final en `▸ 97 descartados`, desplegable, cada uno con su motivo corto (`duplicado`, `sin ubicación`, `no cambia nada`).
- Al pasar el ratón o enfocar un mensaje, su incidente se resalta en el mapa y en prioridades.
- Los eventos inyectados por el operador llevan la etiqueta `Operador`.

### 4.4 Mapa de situación

Responde a "qué pasa y dónde".

- **Implementación técnica:** Renderizado mediante **React Leaflet** (`app/components/LeafletMap.tsx`) cargado dinámicamente (`next/dynamic` sin SSR) junto a un selector para alternar con el esquema regional SVG (`app/components/OperationsMap.tsx`).
- **Capa base cartográfica:** **OpenStreetMap** (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`), sin dependencia de API keys externas ni cuotas restrictivas.
- **Foco operativo:** Centrado en **Sierra Bermeja / Serranía de Ronda** (`[36.525, -5.185]`), con foco térmico dinámico y radio de 2.2 km.
- **Vías de comunicación críticas:** Trazado explícito de la **carretera A-397** (corte crítico) y ruta alternativa **MA-8301**.
- **Incidentes:** marcador interactivo compacto mediante `L.divIcon` con rango de prioridad, nombre de zona, severidad e indicador de pulso en zonas críticas.
- **Recursos:** marcadores con forma distinta a la de los incidentes (cuadrado o icono del tipo de recurso) y color categórico por tipo de recurso.
  Máximo tres colores de recurso en el mapa (ver sección 5); a partir del cuarto tipo, se distinguen por icono en tinta neutra.
- **Asignaciones:** línea de 2px del recurso al incidente, en tinta secundaria; discontinua solo si la acción es simulada o está pendiente de aprobación.
- **Zona afectada:** un único polígono con contorno de 2px en estado crítico y relleno al 12% de opacidad.
  Si hay previsión (avance del frente, crecida), contorno discontinuo y la etiqueta `previsto`.
- **Carreteras o accesos cortados:** icono de corte y trazo en estado crítico, con etiqueta.
- Etiquetas directas solo en los tres incidentes de mayor prioridad; el resto por tooltip.
- Tooltip al pasar el ratón con nombre, severidad, recursos asignados, última actualización y prioridad actual.
- Clic en un elemento del mapa selecciona su tarjeta en prioridades, y viceversa.
- Leyenda compacta fija en una esquina: severidades, tipos de recurso y significado de trazo discontinuo.

### 4.5 Prioridades y acciones

Responde a "qué va primero, por qué y qué se está haciendo".

Cada tarjeta de prioridad muestra:

1. Rango (`1`, `2`, `3`) en grande.
2. Severidad como badge con icono y texto.
3. Título del incidente y zona.
4. Porqué en una línea, redactado por el agente (`Hospital sin suministro; 2 de 3 ambulancias ya comprometidas`).
5. Siguiente acción concreta, con canal y responsable (`Llamada a Protección Civil vía HappyRobot`).
6. Estado de la acción (sección 5.3).
7. Controles: `Aprobar`, `Cancelar`, `↑`, `↓`.

Reglas:

- Las acciones de alto impacto nacen en `Pendiente de aprobación` y muestran `Aprobar` como botón principal.
- El resto se ejecutan solas y muestran solo `Cancelar` mientras es posible cancelarlas.
- `Cancelar` y `Aprobar` sobre acciones externas piden confirmación en línea (no modal), con el texto de lo que se va a hacer.
- Cuando el operador reordena, la tarjeta muestra `Fijado por operador` y el agente replanifica respetando esa posición.
- Bajo la cola, una barra apilada horizontal única con el recuento de acciones por estado y leyenda con cifras.

### 4.6 Recursos

Responde a "dónde van los recursos".

- Una fila por tipo de recurso con barra horizontal: tramo relleno = asignados, tramo con solo contorno = libres, sobre una pista de capacidad total.
- Etiqueta directa a la derecha: `3 / 5 asignadas · 2 libres`.
- Si hay peticiones sin cubrir para ese tipo, se añade a la derecha `⚠ 2 sin cubrir` en estado crítico con icono.
  No se dibuja como tramo de la barra porque no es capacidad.
- Barras ordenadas por escasez (menor proporción libre arriba), orden estable entre actualizaciones salvo cambio real.
- El color de cada fila es el del tipo de recurso en el mapa: el color sigue a la entidad.

### 4.7 Evolución temporal

Responde a "cómo va esto y cuándo cambió el plan".

- Small multiples apilados que comparten eje X (tiempo): `Incidentes abiertos` y `Recursos libres`.
  Nunca doble eje Y.
- Línea de 2px, un solo color por gráfico (tinta de serie 1), área sin relleno.
- Cada replanificación es una línea vertical hairline que atraviesa ambos gráficos, con una etiqueta corta arriba (`Replan 3 · carretera cortada`).
  Esto conserva el rastro de la adaptación cuando el resaltado temporal ya ha desaparecido.
- Crosshair y tooltip con los valores de ambas series en ese instante.
- Ventana por defecto: última hora o desde el inicio del escenario si es más corto.

## 5. Color

Todos los valores vienen de la paleta de referencia de la skill `dataviz` y se han validado con su script.
Se definen como variables CSS por rol en `:root` y se redefinen para oscuro; el código de componentes nunca usa hex directos.

### 5.1 Superficies y tinta

| Rol                              | Claro                 | Oscuro                   |
| -------------------------------- | --------------------- | ------------------------ |
| Plano de página                  | `#f9f9f7`             | `#0d0d0d`                |
| Superficie de panel              | `#fcfcfb`             | `#1a1a19`                |
| Tinta primaria                   | `#0b0b0b`             | `#ffffff`                |
| Tinta secundaria                 | `#52514e`             | `#c3c2b7`                |
| Tinta atenuada (ejes, metadatos) | `#898781`             | `#898781`                |
| Rejilla                          | `#e1e0d9`             | `#2c2c2a`                |
| Eje / línea base                 | `#c3c2b7`             | `#383835`                |
| Borde hairline                   | `rgba(11,11,11,0.10)` | `rgba(255,255,255,0.10)` |

El texto siempre usa tinta, nunca el color de una serie o de un estado.
El color de estado va en el icono, el punto o el borde junto al texto.

### 5.2 Severidad (estado)

| Severidad  | Color                    | Icono sugerido    |
| ---------- | ------------------------ | ----------------- |
| `critical` | `#d03b3b`                | octógono con `!`  |
| `high`     | `#ec835a`                | triángulo con `!` |
| `medium`   | `#fab219`                | círculo con `!`   |
| `low`      | tinta atenuada `#898781` | círculo con `i`   |

- Los colores de estado son fijos en claro y oscuro y no se usan para nada más.
- `high` y `medium` están a ΔE 13,6 entre sí (por debajo del umbral de 15): sin icono y texto no se distinguen de forma fiable.
  El icono y la etiqueta son obligatorios, también en el mapa.
- En claro, `medium` y `high` tienen contraste inferior a 3:1 con la superficie; por eso el icono lleva borde de tinta primaria.

### 5.3 Estado de acciones

| Estado                  | Tratamiento                                                     |
| ----------------------- | --------------------------------------------------------------- |
| Completada              | `#0ca30c` + check                                               |
| En curso                | serie 1 (`#2a78d6` / `#3987e5`) + spinner estático o reloj      |
| Pendiente de aprobación | `#fab219` + mano o candado                                      |
| Fallida                 | `#d03b3b` + aspa, con el motivo del fallo visible               |
| Cancelada               | tinta atenuada + tachado del título                             |
| Simulada                | textura de líneas a 45° en tinta atenuada + etiqueta `SIMULADA` |

Una acción no pasa a `Completada` hasta que el resultado de la integración lo confirma.

### 5.4 Tipos de recurso (categórico)

| Slot           | Claro     | Oscuro    |
| -------------- | --------- | --------- |
| 1 · azul       | `#2a78d6` | `#3987e5` |
| 2 · naranja    | `#eb6834` | `#d95926` |
| 3 · aguamarina | `#1baf7a` | `#199e70` |

- Resultado del validador en modo todos-los-pares (el mapa es disperso, todos los pares pueden coincidir):
  claro, CVD peor ΔE 9,2 y visión normal peor ΔE 24,0; oscuro, CVD peor ΔE 9,4 y visión normal peor ΔE 20,9.
- En claro, el aguamarina tiene contraste 2,74:1: obliga a etiqueta directa o icono, que ya exige el principio 4.
- Asignación fija por tipo de recurso, definida una vez en código; filtrar o quitar un tipo nunca repinta los demás.
- Más de tres tipos: los adicionales van en tinta neutra con icono propio, nunca con un color generado.
- El naranja de recurso convive con el naranja de `high`: se distinguen por forma (recurso cuadrado o icono, incidente circular), nunca solo por color.

### 5.5 Comando de validación

Cualquier cambio de paleta se valida antes de fusionarse, en ambos modos:

```bash
node <dataviz-skill>/scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --pairs all
```

```bash
node <dataviz-skill>/scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark --pairs all
```

## 6. Cambios y replanificación

El operador debe ver qué ha cambiado sin buscarlo.

- Todo elemento nuevo o modificado (mensaje, incidente, prioridad, acción, recurso) recibe una marca `Nuevo` o `Cambiado · hace 2 min`.
- La marca es un anillo o borde izquierdo de 2px en tinta primaria más el texto; no usa colores de estado ni de serie.
- La marca permanece 5 minutos y se atenúa en el último minuto; después desaparece.
- En el mapa, el marcador cambiado emite como máximo tres pulsos al aparecer y luego conserva el anillo estático.
- Las tarjetas de prioridad que cambian de posición se animan hasta su nueva posición en 300ms y muestran `↑ desde 4` o `↓ desde 1`.
- Las acciones canceladas por una replanificación no desaparecen al instante: quedan tachadas con `Cancelada por replan` durante los 5 minutos de la marca.
- Con `prefers-reduced-motion`, sin pulsos ni animaciones de posición; solo la marca estática.
- La traza permanente de cada replanificación vive en la barra de estado (la última) y en la evolución temporal (todas).

## 7. Tipografía y proyección

- Fuente del sistema: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- Escala en `rem` para que el zoom del navegador escale todo de forma uniforme.
  Para proyectar basta con zoom al 125-150%; no hace falta un modo presentación aparte.

| Uso                      | Tamaño                                 | Peso      |
| ------------------------ | -------------------------------------- | --------- |
| Valor KPI                | 2.5rem                                 | 600       |
| Rango de prioridad       | 1.5rem                                 | 600       |
| Título de panel          | 0.875rem, mayúsculas, espaciado 0.04em | 600       |
| Texto de tarjeta         | 1rem                                   | 400 / 500 |
| Metadatos, motivos, ejes | 0.8125rem                              | 400       |

- Nada por debajo de 0.8125rem (13px).
- Cifras alineadas en tablas y ejes con `font-variant-numeric: tabular-nums`; los KPI con cifras proporcionales.
- Horas en formato 24h `HH:MM`; tiempos relativos (`hace 2 min`) solo para la marca de cambio.
- Números con separador de miles del locale `es-ES`.

## 8. Marcas y anatomía de gráficos

- Barras de 12-16px de alto con extremo redondeado de 4px en el lado del dato, anclado a la base.
- Hueco de 2px del color de superficie entre tramos de barras apiladas; sin bordes alrededor de las marcas.
- Líneas de 2px; marcadores de al menos 8px.
- Rejilla y ejes en hairline continuo, nunca discontinuo.
  El trazo discontinuo queda reservado para lo previsto, lo pendiente y lo simulado.
- Etiquetas directas selectivas: el último valor, el extremo o lo que importa; nunca un número en cada punto.
- Leyenda siempre presente cuando hay dos o más series.
- Los objetivos de hover y clic son mayores que la marca (mínimo 24×24px).

## 9. Interacción e intervención

- Tooltip en todos los gráficos y en el mapa, en superficie de panel con tinta primaria.
- Selección cruzada: seleccionar un incidente en entrada, mapa o prioridades lo resalta en las tres zonas.
- Cada panel de datos ofrece `Ver como tabla` (recursos, evolución, estado de acciones) para accesibilidad y para cuando el color no basta.
- Toda acción del operador queda registrada en la entrada con la etiqueta `Operador` y provoca una replanificación visible.
- Los controles son botones nativos con foco visible; todo se puede operar con teclado.
- Los errores de integración se muestran en la tarjeta afectada con el motivo y la opción `Reintentar`, que no duplica la acción si ya se ejecutó.

## 10. Accesibilidad

- Contraste de texto AA (4.5:1) en ambos temas.
- Ningún significado solo por color: icono + texto para estados, forma + etiqueta para recursos.
- Textura disponible para simulado y para `forced-colors`.
- `prefers-reduced-motion` respetado (sección 6).
- Regiones con `aria-live="polite"` para la barra de estado y la cola de prioridades, de modo que los cambios se anuncien sin interrumpir.
- El tema oscuro es una selección propia de colores validada contra su superficie, no una inversión automática.

## 11. Anti-patrones a evitar

- Doble eje Y en la evolución temporal.
- Donut o gauge para recursos libres/asignados.
- Colores generados para un cuarto tipo de recurso.
- Color de estado usado como color de serie, o al revés.
- Recolorear recursos al filtrar.
- Rejillas gruesas, bloques grandes saturados o mapa base a todo color.
- Números en cada punto o segmento.
- Acciones simuladas con el mismo aspecto que las reales.
- Replanificaciones que solo se notan si estabas mirando en ese segundo.
- Información crítica oculta en pestañas o modales.

## 12. Checklist de aceptación

- [ ] A 1440×900 todas las zonas son visibles sin scroll de página.
- [ ] Proyectado al 125-150% de zoom, los KPI y el rango de prioridades se leen a 5 metros.
- [ ] Al inyectar un evento, en menos de 5 segundos cambian mapa, prioridades y barra de estado, y todos los cambios llevan marca.
- [ ] Cinco minutos después, la replanificación sigue visible en la evolución temporal.
- [ ] Una integración caída se ve en la barra de estado y en la acción afectada.
- [ ] Ninguna acción simulada puede confundirse con una ejecutada.
- [ ] El validador de paleta pasa en claro y oscuro.
- [ ] En escala de grises (simulación de acromatopsia) se siguen distinguiendo severidades, estados y tipos de recurso.
- [ ] Todo se puede operar con teclado y el foco es siempre visible.
- [ ] Ambos temas revisados con captura de pantalla antes de cerrar la tarea.
