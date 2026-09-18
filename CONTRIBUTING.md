# Contribuir a Butterfish

Lee [PROJECT.md](PROJECT.md): es la fuente de verdad sobre el proyecto, las
convenciones y los permisos. [README.md](README.md) explica el funcionamiento;
[TASKS.md](TASKS.md) contiene las tareas completadas y pendientes.

## Preparar el entorno

Necesitas Git, Node.js 22.21+ (22.x) y npm 11.6.1. En Windows instala Git for
Windows; los hooks usan su intérprete. En macOS y Linux basta con Git y Node
en el PATH. Usa npm y el lockfile del repositorio.

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

Usa `feat/`, `fix/` o `chore/` según corresponda. No uses la antigua rama
`integration`. Si ya tienes cambios, consérvalos antes de cambiar de rama.

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

Publica tu rama y abre una PR **siempre hacia `main`**, usando la plantilla.
Los agentes necesitan permiso explícito para hacer push. El propietario hace
el merge final; ningún agente debe hacerlo. Los pushes directos a `main` están
bloqueados. Indica en la PR qué probaste y cualquier comprobación omitida.

## Trabajar con agentes

Codex y herramientas compatibles entran por [AGENTS.md](AGENTS.md); Claude Code
usa [CLAUDE.md](CLAUDE.md); Cursor usa `.cursor/rules/project.mdc`; Gemini y
Antigravity también tienen referencias al mismo PROJECT.md. Usa el modelo que
prefieras, manteniendo las mismas reglas. Si tu herramienta no carga esas
instrucciones, pídele que lea AGENTS.md y PROJECT.md antes de empezar.

No subas preferencias personales ni claves de las herramientas. Coordina los
archivos que modifica cada persona o agente para evitar pisar cambios.

## Claves y servicios

Copia `.env.example` a `.env.local` solo cuando necesites integrar servicios;
no sobrescribas un archivo local existente. Comparte secretos mediante un canal
privado acordado, nunca en commits, PRs, chats de agentes o capturas.

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
