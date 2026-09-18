# Qué cambia

<!-- Una o dos frases: qué hace este cambio y por qué. Si arregla una incidencia, enlázala con "Closes #N". -->

## Tipo de cambio

- [ ] `feat` — funcionalidad nueva
- [ ] `fix` — corrección
- [ ] `chore` / `docs` — tooling, documentación, mantenimiento
- [ ] `refactor` — reorganización sin cambio de comportamiento

## Rama

- [ ] Parte de la rama base correcta y la PR apunta a ella (ver `AGENTS.md` → *Working with this repo*).
- [ ] No es un commit directo a `main`.

## Alcance y propiedad de ficheros

Varios agentes y personas trabajan en paralelo sobre módulos distintos.

- [ ] Solo toco los ficheros de mi módulo (ver cabecera `// PROPIETARIO:` en `lib/**`).
- [ ] Si he tenido que tocar un fichero de otro módulo, lo explico aquí abajo.

<!-- Ficheros ajenos tocados y motivo: -->

## Verificación

Comandos ejecutados en local (marca lo que hayas corrido de verdad):

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Probado a mano en `npm run dev` (describe el flujo abajo)

<!-- Qué has probado a mano y qué has visto: -->

## Acciones externas y credenciales

- [ ] No introduce credenciales, teléfonos, correos ni datos de interacciones reales en el código, los logs o los commits.
- [ ] Si toca ejecución real (`ACTION_EXECUTION_MODE=happyrobot`), se ha usado solo con destinatarios de demo y con aprobación previa del usuario.
- [ ] Lo simulado se muestra etiquetado como simulado en la interfaz; nada mock se presenta como ejecución real.

## Impacto en la demo

<!-- ¿Cambia el guion de la demo, la superficie de API o las variables de entorno?
     Si sí, di qué hay que actualizar en README.md o docs/. -->

## Pendiente / riesgos conocidos

<!-- Lo que sabes que falta o puede romperse. Mejor aquí que en la demo. -->
