# Contributing to Butterfish

Read [PROJECT.md](PROJECT.md): it is the single source of truth for project conventions and permissions. [README.md](README.md) explains how the system works; [TASKS.md](TASKS.md) tracks completed and deferred tasks.

## Environment Setup

You need Git and Node.js 22.21+ (22.x) with its bundled npm (10.9+); if you use Corepack, `corepack enable` activates npm 11.6.1 pinned in `package.json`. On Windows, install Git for Windows; hooks use its shell. On macOS and Linux, Git and Node on your PATH are sufficient. Use npm and the repository lockfile.

```sh
git clone https://github.com/alvarovegaromero/hackandalus-hackathon.git
cd hackandalus-hackathon
npm ci
npm run dev
```

Open http://localhost:3000. The simulation starts without credentials. `npm ci` installs local hooks; if you installed without scripts, run `npm run prepare`. VS Code and Cursor can use the recommended configuration and extensions in `.vscode`; other editors must respect Prettier and EditorConfig.

## Creating a Contribution

With a clean working tree, branch from the latest remote `main`:

```sh
git fetch origin
git switch -c feat/short-description origin/main
```

Use `feat/`, `fix/`, or `chore/` as appropriate. If you already have changes, save them before switching branches.

```sh
npm run format
npm run check
git add <reviewed-files>
git commit -m "feat: describe the change in English"
```

Pre-commit is intentionally disabled for the 24-hour hackathon. Do not add or run
automated tests by default; existing tests are available manually on request.
Pre-push and PR validation run `npm run check`, which includes build but excludes
tests. Branch and credential rules still apply. See PROJECT.md for the shared policy.

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
