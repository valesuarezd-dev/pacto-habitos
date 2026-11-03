# Nuestro pacto 🎁

Página para seguir hábitos en pareja, con un camino de regalos que se van poniendo mejores (y más lejanos) mientras más dura la racha.

## Archivos

```
index.html      la página
styles.css      los estilos (modo claro y oscuro)
app.js          toda la lógica: hábitos, rachas, regalos y castigos
api/state.js    función de Vercel que guarda los datos compartidos (Supabase o Upstash)
supabase.sql    crea la tabla si usas Supabase
package.json
.gitignore
```

No hay que instalar nada ni compilar nada.

## Cómo subirlo

1. **GitHub**: crea un repositorio nuevo (puede ser privado) y sube todos los archivos tal cual, respetando la carpeta `api/`. Desde la web de GitHub sirve “Add file → Upload files” y arrastrar la carpeta completa.
2. **Vercel**: entra a vercel.com, “Add New → Project”, importa el repositorio y aprieta “Deploy”. No cambies ninguna opción (Framework: Other).
3. **Base de datos** (para que los dos vean lo mismo). Sirve cualquiera de estas dos:
   - **Supabase**: en Vercel, pestaña **Storage**, conecta Supabase al proyecto. Después entra a Supabase → **SQL Editor** → **New query**, pega el contenido de `supabase.sql` y aprieta **Run**. Eso crea la tabla donde se guarda el pacto.
   - **Upstash (Redis)**: en Vercel, pestaña **Storage**, crea una base Upstash Redis gratis y conéctala al proyecto. No hay que hacer nada más.
4. Ve a **Deployments**, abre el último y elige **Redeploy** para que tome las variables nuevas.
5. Abre el link en tu celular y elige «Soy Valukis». Tomilin abre el mismo link en su celular y elige «Soy Tomilin». Cada teléfono recuerda su perfil (se puede cambiar con «Cambiar», arriba).

Si algo no está bien conectado, la página muestra «No se pudo conectar» con el motivo exacto. También puedes abrir `tu-pagina.vercel.app/api/state` en el navegador para ver la respuesta de la base de datos.

Tip: en el teléfono, “Compartir → Agregar a pantalla de inicio” la deja como una app.

### Código para que nadie más la toque (opcional)

Cualquiera con el link podría abrirla. Si quieres protegerla, en Vercel ve a **Settings → Environment Variables**, agrega `APP_PIN` con un código (por ejemplo `2611`) y vuelve a hacer Redeploy. La página va a pedir el código una vez en cada teléfono.

## Cómo funciona el pacto

**Hábitos.** Cada uno agrega los suyos. Solo el dueño puede marcarlos. Se puede marcar hoy y corregir los últimos 7 días tocando los puntitos.

**Flexibilidad.** Cada hábito tiene dos opciones:
- *Días libres fijos*: por ejemplo sábado y domingo para leer. Esos días no cuentan como fallo.
- *Margen*: cuántos días seguidos se puede saltar sin perder la racha. Si te pasas, la racha se corta. El día de hoy nunca corta la racha, porque todavía hay tiempo.

**Regalos.** Cada día con racha activa suma “días de progreso”. Los regalos llegan a los 7 días, 15 días, 1 mes, 3 meses, 6 meses y 1 año (y después cada año). Se pueden cambiar en Ajustes, con su nombre y una idea o presupuesto.

**Si uno tiene más hábitos.** No es proporcional. Con 1 hábito se suma 1 día de progreso por día; cada hábito extra agrega un 25 % (con 2 hábitos 1,25; con 3, 1,5) con un tope de 1,75. Así quien tiene más hábitos recibe regalos un poco antes, pero no el triple. El bono y el tope se ajustan en Ajustes.

**Perder una racha.** Los regalos ganados no se pierden nunca, pero si se corta la racha de algún hábito, el avance vuelve al último regalo alcanzado.

**Terminar un hábito.**
- *Lo logré*: disponible desde los 30 días de racha (ajustable). Recibes un último regalo del nivel de tu racha.
- *Me rindo*: pagas un castigo a la otra persona. Elige entre hacerle un regalo del nivel del tiempo que llevabas, o girar la ruleta de castigos (editable en Ajustes).

Todo lo pendiente aparece en **Por entregar**, y se marca como entregado cuando se da.

**Respaldo.** En Ajustes puedes descargar un archivo con todos los datos y volver a cargarlo.
