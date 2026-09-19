# Contribuir a Butterfish

Lee [PROJECT.md](PROJECT.md): es la fuente de verdad sobre el proyecto, las
convenciones y los permisos. [README.md](README.md) explica el funcionamiento;
[TASKS.md](TASKS.md) contiene las tareas completadas y pendientes.

## Preparar el entorno

Necesitas Git y Node.js 22.21+ (22.x) con el npm que incluye (10.9+); si usas
Corepack, `corepack enable` activa el npm 11.6.1 fijado en `package.json`. En
Windows instala Git for Windows; los hooks usan su intérprete. En macOS y Linux
basta con Git y Node en el PATH. Usa npm y el lockfile del repositorio.

```sh
git clone https://github.com/alvarovegaromero/hackandalus-hackathon.git
cd hackandalus-hackathon
npm ci
npm run dev
```

Abre http://localhost:3000. La simulación arranca sin claves. `npm ci` instala
los hooks locales; si instalaste sin scripts, ejecuta `npm run prepare`.
VS Code y Cursor pueden usar la configuración y extensiones recomendadas en
`.vscode`; otros editores deben respetar Prettier y EditorConfig.

## Crear una contribución

Con el directorio de trabajo limpio, crea la rama desde el último `main` remoto:

```sh
git fetch origin
git switch -c feat/short-description origin/main
```

Usa `feat/`, `fix/` o `chore/` según corresponda. Si ya tienes cambios,
consérvalos antes de cambiar de rama.

```sh
npm run format
npm run check
git add <archivos-revisados>
git commit -m "feat: describe the change in English"
```

El pre-commit revisa secretos y archivos privados, aplica Prettier y ESLint a
los archivos staged, y ejecuta tipos y tests. Revisa las modificaciones de
formato. El pre-push ejecuta la comprobación completa con build. No saltes hooks
para ocultar fallos. Las reglas de nomenclatura están en PROJECT.md.

After committing and publishing your feature branch, create a PR targeting
`main` with the repository template and an authenticated GitHub CLI (`gh`):

```sh
npm run pr:create -- --title "chore: describe the change" --body-file pr-body.md
```

Use a body file outside the repository (or an ignored local file) to keep the
working tree clean. `pr:create` explicitly runs `pr:check`, which blocks protected
branches and runs the full `npm run check` before PR creation. A failed check
stops the command. The command requires a clean working tree and uses the already
published branch without pushing. Record results and the tested OS in the PR.
Run it again after code changes. All contributors and agents must use this entry
point: GitHub's UI and direct `gh pr create` bypass the local gate. The explicit
command chain also runs validation when npm lifecycle hooks are disabled.

We will not use GitHub Actions CI: the team has no Actions minutes. Checks stay
local; adding CI is not deferred work.

Los agentes necesitan permiso explícito para hacer push y pueden hacer merge
cuando el usuario se lo indique, respetando checks y protección de ramas.
Los pushes directos a `main` están
bloqueados. Indica en la PR qué probaste y cualquier comprobación omitida.

## Trabajar con agentes

Codex y herramientas compatibles entran por [AGENTS.md](AGENTS.md); Claude Code
usa [CLAUDE.md](CLAUDE.md); Cursor usa `.cursor/rules/project.mdc`; Gemini y
Antigravity también tienen referencias al mismo PROJECT.md. Usa el modelo que
prefieras, manteniendo las mismas reglas. Si tu herramienta no carga esas
instrucciones, pídele que lea AGENTS.md y PROJECT.md antes de empezar.

No subas preferencias personales ni claves de las herramientas. Coordina los
archivos que modifica cada persona o agente para evitar pisar cambios.

## Índice local de código

Su uso es obligatorio para navegar por el código, también para los agentes.
Consulta el mapa o una búsqueda relevante antes de explorar o modificar código.
Indica en la PR si necesitas recurrir a búsquedas directas por fallos o falta
de cobertura. El checklist de la PR incluye esta comprobación.

Graft se instala con las dependencias de desarrollo de `npm ci`. En cada clon
o worktree, ejecuta `npm run index:build` y después `npm run index:map`.
Para buscar una tarea: `npm run graft -- ask "event validation"`.
Los agentes encuentran estas instrucciones a través de PROJECT.md.

El índice `graft/` es local y está ignorado por Git; cada persona genera el suyo.
No hacen falta claves ni instalación global. Usa la
[guía de Graft](docs/code-index.md) para consultas, actualización y límites.
Los hooks de commit y push ejecutan `npm run index:verify`: generan o actualizan
el índice y validan su frescura. Si falla, corrige el problema antes de continuar;
no omitas los hooks. Son comprobaciones locales, no protección remota.

## Skills compartidas

Las cuatro skills del equipo están versionadas en `.agents/skills/` y llegan
con el clone o pull de la rama que las contiene. No ejecutes una instalación
global ni copies las skills a cada editor. Sigue la
[guía de uso y actualización](docs/agent-skills.md); PROJECT.md enlaza cada
`SKILL.md` para que cualquier agente pueda leerlo aunque no lo detecte solo.

Si una sesión ya estaba abierta, inicia una nueva o pide al agente que lea el
archivo de la skill correspondiente. Las instrucciones de proyecto siguen
siendo prioritarias y las skills no conceden permisos para publicar o desplegar.

## Claves y servicios

Ejecuta `npm run env:setup` para copiar `.env.example` a `.env.local` con valores
vacíos. El comando conserva el archivo si ya existe, sin leerlo ni sobrescribirlo.
Rellena los valores localmente cuando necesites integrar servicios.

- **GitHub:** solo `.env.example`, con nombres de variables y valores vacíos.
  Nunca subas `.env`, `.env.local` o claves reales, aunque el repositorio sea privado.
- **Equipo:** comparte credenciales de desarrollo mediante un gestor de contraseñas
  compartido o un enlace privado con caducidad. No uses issues, PRs, comentarios,
  chats de agentes ni capturas para transmitirlas.
- **Vercel:** configura las variables en el proyecto, separadas por Development,
  Preview y Production. Evita usar claves de producción en desarrollo o previews.
- **GitHub Actions Secrets:** unused because this project does not run Actions;
  they are not a mechanism for sharing `.env` files with the team.
- **Exposición accidental:** revoca o rota la clave en su proveedor inmediatamente;
  borrarla del último archivo o commit no elimina las copias ni el historial.

Solo las variables `NEXT_PUBLIC_*` pueden llegar al navegador y deben contener
datos públicos. Nunca pongas ahí `SUPABASE_SECRET_KEY`, `AI_GATEWAY_API_KEY`,
`CRISIS_API_TOKEN` ni credenciales de HappyRobot. Los hooks reducen errores, pero
no sustituyen esta separación.

| Funcionalidad          | Configuración necesaria                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Panel de simulación    | Ninguna clave                                                                                            |
| API local de workflows | `CRISIS_API_TOKEN`: token privado aleatorio generado por el equipo                                       |
| Planificación real     | `AI_GATEWAY_API_KEY` y `AI_MODEL` (`proveedor/modelo`)                                                   |
| Supabase               | URL, clave publicable y clave secreta de servidor indicadas en `.env.example`                            |
| HappyRobot             | Credenciales y workflow acordados; las variables actuales están reservadas y aún no ejecutan llamadas    |
| Despliegue             | Proyecto Vercel, acceso del equipo y variables por entorno; no requiere una clave de Vercel en el código |

Poner claves no conecta automáticamente el panel ni implementa los adaptadores.
Quedan pendientes la persistencia, autenticación/RLS de operadores, Realtime,
contrato de HappyRobot, verificación de callbacks y destinatarios de demo.
También hay que elegir escenario/modelo y autorizar las pruebas reales.

Para colaborar, el propietario debe conceder acceso al repositorio; los accesos
a Vercel, Supabase y HappyRobot se conceden cuando se usen. No hace falta decidir
ni añadir una licencia para esta tarea de preparación del hackathon.
