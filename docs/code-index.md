# Índice de código con Graft

Usamos [Graft](https://github.com/trailhq/Graft) para localizar funciones,
relaciones y archivos antes de leer código. La versión `0.10.1` está fijada en
`devDependencies` y `package-lock.json`; todos usan la misma mediante npm.

## Preparación

Desde la raíz del repositorio, con Git, Node.js y npm según PROJECT.md:

```sh
npm ci
npm run index:build
npm run index:map
```

Cada clon o worktree genera su propio `graft/`. No se sube a Git ni se comparte
entre ramas o máquinas. El índice estructural funciona sin claves de modelos.
No hace falta instalar Graft globalmente ni ejecutar `graft init`: AGENTS.md y
CLAUDE.md ya remiten al flujo común de PROJECT.md, igual que las reglas de los
otros agentes. Si una herramienta no carga las instrucciones, pídele que lea
PROJECT.md antes de empezar.

El uso de Graft para navegar por el código es obligatorio para el equipo y
sus agentes. Consulta el mapa o una búsqueda relevante antes de explorar o
modificar código. Si falla o no cubre lo que necesitas, documenta el motivo
al recurrir a búsquedas directas.

Los hooks de commit y push ejecutan `npm run index:verify`: construyen o
actualizan el índice y después comprueban su frescura. Si falla, bloquean la
operación. Pre-commit lo ejecuta al final; pre-push lo ejecuta como último paso
de `npm run check`. No desactives los hooks para evitar la comprobación.
Son controles locales: no impiden que un usuario desactive sus hooks ni prueban
que haya consultado el grafo. El checklist de PR exige confirmar el uso.

La indexación no forma parte de `npm ci`, el build directo de Next.js o el
despliegue. Con `npm ci --omit=dev`, Graft no se instala.
Si tu configuración npm desactiva scripts de instalación, el setup local
verificado también pudo construir el índice; para los hooks del proyecto sigue
siendo necesario ejecutar `npm run prepare`, como indica CONTRIBUTING.md.

## Consultas

```sh
npm run index:map
npm run graft -- ask "event validation"
npm run graft -- skeleton src/lib/domain.ts
npm run graft -- callers simulatePlan
npm run graft -- callers simulatePlan --direction out
npm run graft -- grep "crisisEventSchema"
npm run index:check
npm run index:verify
```

Usa `ask` para localizar código relacionado con una tarea, `skeleton` para ver
firmas, `callers` para relaciones y `grep` para buscar texto dentro de archivos
indexados. Abre el código original para comprobar los resultados antes de editar.

Las consultas refrescan el grafo estructural por defecto. `index:check` informa
si está actualizado; si falla o cambias de rama, ejecuta `index:build`.
Que `check` indique que la capa «deep» no está construida es normal: este setup
solo usa el índice estructural. `--deep` añade procesamiento con modelos y no
forma parte de los comandos configurados.

## Alcance y límites

- En esta revisión se indexaron 23 archivos JS/TS/TSX, con 22 símbolos y 84
  relaciones. Las cifras cambiarán al añadir código.
- Graft omite directorios ocultos y dependencias/builds, y respeta la selección
  de archivos de Git. Los archivos ya versionados pueden seguir entrando aunque
  coincidan con una regla de ignore; `next-env.d.ts` aparece en este índice.
- SQL, CSS y Markdown no aparecen en el índice comprobado. Usa `rg` sobre
  `supabase/migrations`, `src` o `docs` para consultar esos contenidos.
- Algunos valores exportados no son nodos: `callers crisisEventSchema` no
  encuentra el símbolo, mientras que `grep crisisEventSchema` sí encuentra sus
  usos. Las relaciones dinámicas tampoco deben considerarse exhaustivas.
- `graft/` está excluido de Git, Prettier y el escaneo de secretos generado.
  `.ignore` permite a ripgrep consultar sus tarjetas, pero excluye `.graph/`
  y `.cache/`. Para buscar solo fuente, limita las rutas (`rg ... src scripts`).
- No configura MCP, hooks de editores, servicios ni ajustes globales. Los
  agentes usan la CLI mediante los comandos npm compartidos.

Se verificaron construcción, reconstrucción, mapa, búsqueda, firmas,
referencias y frescura en Windows. Los comandos no usan rutas absolutas ni
sintaxis específica de shell; macOS y Linux son plataformas previstas, pero
no se han probado en esta tarea.

Para actualizar Graft, cambia la versión exacta con npm, revisa el lockfile y
repite estas consultas y `npm run check`. Si las respuestas son incompletas o
la herramienta falla, continúa con búsquedas acotadas y lectura directa.
