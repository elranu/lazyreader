# lazyreader

Un mod para Claude Code (terminal y el Code tab de Claude Desktop) que te lee en voz alta las respuestas de Claude y va resaltando cada frase mientras la dice: lo ya leído queda tenue, la frase actual en color y negrita, y lo que falta en normal.

*A Claude Code mod that reads Claude's replies aloud and highlights each sentence as it is spoken.*

## Qué hace

- **🔊 debajo de cada respuesta:** la lee desde el principio.
- **`/read`:** lee la última respuesta.
- **`/read <palabras>`:** lee desde la frase que contiene esas palabras.
- **Seleccionar texto y correr `/read`:** lee desde lo que marcaste con el mouse (donde la superficie informa la selección).
- **Mientras lee:** controles ⏮ ⏸/▶ ⏭ ⏹ arriba de la respuesta, y `/read-pause` y `/read-stop`.
- Los bloques de código se muestran pero no se leen; las tablas se leen fila por fila.
- Opcional: leer cada respuesta automáticamente al terminar el turno.

## Requisitos

La voz por defecto es [edge-tts](https://github.com/rany2/edge-tts) (voces neurales, por ejemplo `es-AR-TomasNeural`), y cada frase se reproduce con `mpv`:

```bash
pipx install edge-tts
```

edge-tts usa el servicio de voz en línea de Microsoft Edge: el texto que se lee sale de tu máquina. Si preferís que no salga, elegí el motor `system`, que usa el sintetizador del sistema operativo (`say` en macOS).

## Instalación

En una sesión de Claude Code en la terminal:

```
/plugin install lazyreader --marketplace elranu/lazyreader
```

Respondé `y` para agregar el marketplace y elegí el alcance.

Desde una shell:

```bash
claude plugin install lazyreader --marketplace elranu/lazyreader
```

En Claude Desktop, donde `/plugin` no corre: clic en **+** al lado de la caja del prompt, **Plugins**, **Add marketplace** con `elranu/lazyreader`, y después **Add plugin**.

## Opciones

Se cambian en el menú de configuración de Claude Code (`/config`):

| Opción | Por defecto | Qué es |
| --- | --- | --- |
| `engine` | `edge-tts` | `edge-tts` o `system` |
| `voice` | `es-AR-TomasNeural` | La voz (`edge-tts --list-voices`) |
| `rate` | `+10%` | Velocidad de edge-tts |
| `player` | `mpv --no-video --really-quiet` | Con qué se reproduce cada frase |
| `autoRead` | `false` | Leer cada respuesta al terminar el turno |
| `speakerButton` | `true` | Mostrar el 🔊 debajo de cada respuesta |

## Límites

- El resaltado va por frase, no por palabra.
- Mientras lee, la respuesta se muestra como texto plano (sin el formato markdown) y vuelve a su formato al terminar.
- Con el motor `system`, parar o pausar corta al final de la frase en curso.

## Licencia

MIT
