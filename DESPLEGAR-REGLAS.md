# Desplegar las reglas de Firestore

Esto es lo único del parche que no puedo hacer yo: publicar requiere autenticarse
como dueño de `zenday-297b3`, y no tengo (ni debo tener) tus credenciales.

Pero las reglas ya están probadas: **28 tests contra el emulador de Firestore,
28 en verde**. No estás publicando algo a ciegas.

---

## Los dos comandos

Desde `C:\Users\franc\mi-calendario`:

```bash
npm install                 # trae firebase-tools y el paquete de tests
npm run test:rules          # corre los 28 tests contra el emulador local
```

Si da todo verde:

```bash
npx firebase login          # una vez: se abre el navegador, entrás con tu cuenta
npm run deploy:rules        # publica en zenday-297b3
```

`npm run test:rules` no toca tu proyecto de Firebase: levanta un emulador en tu
propia máquina, corre las pruebas y lo apaga. Podés correrlo las veces que quieras.

> Requiere Java para el emulador. Si `npm run test:rules` se queja, instalá
> el JDK de Temurin y volvé a intentar. Si preferís saltearte los tests, el
> deploy funciona igual.

---

## Qué verifican los 28 tests

**Aislamiento entre negocios** — lo que importa

- Ana lee los pacientes de su consultorio ✅
- Bruno NO puede leer los pacientes de Ana
- Bruno NO puede listar las colecciones de Ana
- Bruno NO puede escribir ni borrar en el negocio de Ana
- Sin sesión iniciada no se lee absolutamente nada

**Membresía** — que `joinBusiness` y `leaveBusiness` sigan andando

- Bruno NO puede leer el documento del negocio de Ana sin ser miembro
- Bruno NO puede **expulsar** a Ana de su propio negocio
- Bruno NO puede reescribir la lista de miembros a su antojo
- Bruno NO puede cambiar el `createdBy`
- Bruno SÍ puede sumarse con el código, y ahí sí ve los datos compartidos
- Bruno SÍ puede salirse, y al salir pierde el acceso

**Perfiles** — cada uno lee sólo el suyo (ahí vive el `businessId`, que es la
credencial para entrar a un negocio)

**Config de versión** — lectura pública (`main.cjs` la consulta sin sesión), pero
`downloadUrl` es de sólo lectura para todos. Es la dirección desde donde tus
clientes bajan el instalador: si alguien pudiera escribirla, les distribuiría su
propio ejecutable.

**Operación normal** — Ana puede crear y borrar en `appointments`, `products`,
`expenses` y `audit`, en los dos modos. Una colección o un modo que no estén
previstos quedan cerrados.

---

## Si algo se rompe después de publicar

En la consola de Firebase → Firestore → Reglas hay **historial de versiones**:
podés volver a la anterior con un clic.

El síntoma de una regla de más sería un `permission-denied` en la consola de
ZenDay al abrir alguna pantalla. Si pasa, pasame el mensaje: dice exactamente qué
ruta se denegó y ajusto la regla.

Ojo con una cosa: escribí las reglas leyendo tu código, no mirando tu base real.
Si ZenDay guarda en alguna colección que no aparece en el código que revisé, esa
ruta va a quedar denegada. Los tests cubren las cinco que encontré
(`appointments`, `patients`, `products`, `expenses`, `audit`) — si usás alguna
más, decime y la agrego antes de que publiques.

---

## Otros cambios en `package.json`

- `author`: estaba en `"Tu Nombre"`, ahora dice `Francisco` (aparece en las
  propiedades del .exe que ven tus clientes).
- `asarUnpack`: saqué `puppeteer` y `whatsapp-web.js`, que ya no son
  dependencias del proyecto.
- Scripts nuevos: `test:rules` y `deploy:rules`.
