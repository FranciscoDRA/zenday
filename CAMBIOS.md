# Qué se cambió en ZenDay

Resumen de la sesión del 18/08/2026. Para ver el detalle línea por línea:
`git diff` en la terminal, o **Ctrl+Shift+G** en VS Code.

---

## Archivos nuevos (aparecen como *untracked* en git)

| Archivo | Qué es |
|---|---|
| `firestore.rules` | Reglas de seguridad. **Sin desplegar todavía.** |
| `firebase.json` · `.firebaserc` | Config para poder desplegar y testear |
| `test/firestore-rules.test.mjs` | 28 tests de las reglas contra el emulador |
| `DESPLEGAR-REGLAS.md` | Cómo publicarlas |
| `src/utils/safeStorage.js` | Capa única de acceso a localStorage |
| `src/components/common/ErrorBoundary.jsx` | Contención de errores de render |

## Archivos modificados

### `electron/main.cjs`
- **Se sacó `rejectUnauthorized: false`** en los dos lugares (`fetch-external` y el chequeo de versión). Era validación de certificados TLS apagada.
- **Se eliminó el bloque que borraba las cabeceras de seguridad** (CSP, X-Frame-Options, COOP/COEP) de todas las respuestas.
- `fetch-external`: sólo https, sin destinos privados/loopback, techo de 10 MB, timeout de 30 s, redirecciones revalidadas.
- `open-file`: lista blanca de extensiones (antes un `.exe` se ejecutaba).
- `open-external`: sólo http/https/mailto/tel.
- `sandbox: true`, `webSecurity: true` siempre.
- `setWindowOpenHandler` + guarda de `will-navigate` + bloqueo de webviews.
- Permisos: sólo notificaciones (antes se concedían geolocalización y cámara/micrófono).
- DevTools deshabilitadas en producción.
- El `downloadUrl` de actualización debe ser https de GitHub; comparación semver real en vez de `!==`.
- Intervalo de recordatorios: tolera drift y no repite; se limpia al cerrar.
- Instancia única (antes abrir dos veces arrancaba dos bots de WhatsApp).
- `console.log` silenciado en producción.

### `electron/licenseManager.cjs`
- Secreto sale del repo → `process.env.ZENDAY_LICENSE_SECRET` en build.
- HMAC en vez de `sha256(concatenación)`.
- **Hardware ID estable**: usa el GUID de máquina. Antes incluía el nombre del equipo y la RAM total, así que renombrar la PC o agregar memoria invalidaba la licencia.
- **Una validación fallida ya no borra la licencia** (antes llamaba a `deleteLicense()`).
- Trial firmado con HMAC: no se resetea editando el `.dat`.
- **Las claves ya vendidas siguen funcionando** — verificado con 14 tests.

### `vite.config.js` + `index.html`
- `minify: 'esbuild'` y `sourcemap: 'hidden'`. Antes iba sin minificar y con los `.map` dentro del instalador: el código fuente completo llegaba a cada cliente.
- CSP real inyectada en build (`script-src 'self'`, sin `unsafe-inline`/`unsafe-eval`). El `index.html` tenía `default-src *`, que equivale a no tener CSP.
- Chunks separados: firebase, charts, pdf.

### `src/hooks/useBusinessId.js`
- **Un error de red al iniciar sesión ya no crea un negocio nuevo.** Antes el `catch` no distinguía "no tiene negocio" de "falló la lectura", y el cliente entraba a un espacio vacío viendo sus datos desaparecidos.
- `arrayUnion` / `arrayRemove` en vez de reescribir la lista de miembros.
- Código de negocio con `crypto.getRandomValues` en vez de `Math.random()`.
- Flag `cancelled` para descartar respuestas obsoletas.

### `src/hooks/useFirestoreSync.js`
- `getAll` devuelve `{ ok, items, error }`. **Antes devolvía `[]` tanto si la colección estaba vacía como si la lectura fallaba**, y App.jsx decidía con `.length`.
- `saveDoc` / `deleteDoc` devuelven `{ ok, error }` en vez de tragarse el error.
- `saveMany` nuevo: escribe en lotes de 500 con `writeBatch`.
- `subscribe` acepta callback de error.

### `src/App.jsx`
- Toda la persistencia pasa por `safeStorage` → avisa cuando localStorage se llena, en vez de dejar de guardar en silencio.
- Los inicializadores de `useState` ya no pueden tirar excepción con JSON corrupto (era pantalla en blanco al arrancar).
- **Guarda contra snapshots vacíos**: un `[]` del servidor ya no pisa la copia local.
- Usa el `{ ok }` de `getAll`; si la lectura falló, trabaja con lo local y **no sube nada**.
- Subida inicial con `saveMany` en lotes (antes una petición de red por registro, sin `await`).
- Flag `cancelled`: cambiar de modo a mitad de carga ya no mezcla datos de los dos modos.
- `ErrorBoundary` por pantalla, con `key` para que se limpie al navegar.
- Estado `invalid` de licencia lleva a la pantalla de activación.
- Banner de trial: leía `trialDaysLeft`, que nunca existió → mostraba "quedan undefined días".

### `src/main.jsx`
- `ErrorBoundary` en la raíz.

### `package.json`
- `author` decía `"Tu Nombre"` (sale en las propiedades del .exe).
- `asarUnpack`: se sacaron `puppeteer` y `whatsapp-web.js`, que ya no son dependencias.
- Scripts `test:rules` y `deploy:rules`.

---

## Verificado

| Qué | Resultado |
|---|---|
| Reglas de Firestore contra el emulador | 28 / 28 |
| Compatibilidad de licencias ya vendidas | 14 / 14 |
| Trial firmado y anti-manipulación | 7 / 7 |
| Build de Vite (CSP, minificado, chunks) | OK |
| Bundle del proyecto completo | 852 KB, todos los imports resuelven |
| `node --check` de los `.cjs` | OK |

**No verificado:** que la app levante. Requiere Windows, Electron con pantalla y tus credenciales.

---

## Pendiente

1. `npm run build` + `npm run electron` — el primer sospechoso si algo falla es `sandbox: true`.
2. `npx firebase login` + `npm run deploy:rules`.
3. **Reglas de la Realtime Database.** ZenDay lee stock de `zenday-297b3-default-rtdb.firebaseio.com` (`useSyncListener.js:330`). Es una segunda base con reglas propias que `firestore.rules` no cubre. Falta definir qué escribe en la ruta `productos`.
4. Parches 5, 7 y 8 de `PARCHES-App.jsx.md`: IDs con `Date.now()` (colisionan), los 10 `window.confirm`, y los adjuntos de clientes que hoy no abren.

## Para revertir

```bash
git diff                          # ver todo
git checkout -- <archivo>         # revertir uno
git checkout -- .                 # revertir todos los modificados
```

Los archivos nuevos son *untracked*: `git checkout` no los toca, se borran a mano.
