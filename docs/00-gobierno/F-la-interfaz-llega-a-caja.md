# `F` — la interfaz llega a `caja`, y cuatro guardas medían nginx con la vara de Spring

**Estado:** aplicado en `infrastructure`. Los cinco clones **no se tocan**: su `git status` queda
limpio.

`caja` estrenó su interfaz de ventanilla (#16, #17): una tercera imagen, un quinto `Deployment` y
un cuarto servicio en su compose. En `infrastructure` eso puso **catorce pruebas en rojo**, y
ninguna decía lo que pasaba de verdad — **acusaban al repositorio equivocado**.

> **El resultado, en una línea: `main` pasa de 681 pruebas con 14 rojas a 687 con 0**, y las seis
> nuevas son la mitad que faltaba: quién mide a un contenedor que no es el backend.

---

## 1. La causa, que es una sola

Hasta ahora **cada sistema publicaba dos imágenes del mismo árbol de fuentes** —`aplicacion` y
`migrador`, separadas porque las credenciales lo están (C-14 §1)—, y las dos son el mismo jar de
Spring. Cuatro guardas se apoyaron en esa coincidencia **sin decirlo**, y con un contenedor de
nginx dentro del espacio de nombres las cuatro se rompen a la vez:

| Guarda | Lo que decía | Lo que pasaba |
|---|---|---|
| `sondas-contra-la-cadena` | la sonda `/` no la atiende `SeguridadWeb` de `caja` | claro que no: `SeguridadWeb` es la cadena del **backend**, y nginx no la tiene |
| `C-17 §5` | «`kamayuk-caja-interfaz/interfaz → undefined`», un `CrashLoopBackOff` garantizado | leía `SPRING_PROFILES_ACTIVE` de un contenedor que no es de Spring y tomó el `undefined` por «un perfil que termina» |
| `compose-de-los-sistemas` | «no tiene exactamente un contenedor principal (tiene 2)» | emparejaba **un** proceso del descriptor con **un** servicio del compose |
| `imagenes-publicadas` / `C-14 §1` | «`caja` declara una imagen de más» | la lista `[sistema, sistema-migrador]` estaba **escrita a mano** |

La corrección es una: **no todo contenedor del espacio de nombres de un sistema corre su
backend**, y eso se **deriva de la imagen** (`verificaciones/procesos-de-un-sistema.ts`).

**Y la pregunta es positiva a propósito**: «¿corre el jar?», no «¿es la interfaz?». Un sidecar
nuevo —una caché, un exportador— entra como «otro proceso» y queda fuera de las reglas de Spring,
que es lo correcto; con la pregunta al revés entraría como backend y se mediría con una vara que
no es la suya, **en silencio**.

---

## 2. Lo que NO se hace: dejar de mirar

Separar por la imagen y parar ahí sería el defecto de C-15/C-16 con otro nombre: la interfaz
quedaría fuera de la cadena de Spring —correcto— **y fuera de toda comprobación** —que no lo es—.
Una sonda que pide una ruta que nginx no sirve mata el pod igual; lo único que cambia es quién
contesta.

Así que la interfaz se mide **contra su nginx**, que viaja en el mismo manifiesto: el `ConfigMap`
que ese pod monta. Y hay un censo —«hoy hay exactamente uno, y es la interfaz de `caja`»— para
que la separación no pueda pasar en verde por lista vacía.

---

## 3. Dos hallazgos que salieron de medir, y ninguno se buscaba

**(a) `caja` la llama «interfaz» y `catastro` la llama «web».** Dos nombres para la misma cosa a
los dos lados de la frontera. Por eso ninguna guarda de aquí puede apoyarse en el nombre, y por
eso `correElBackend` pregunta por el jar.

**(b) `catastro` publica `kamayuk-catastro-web` y ningún descriptor la despliega.** La comparación
nueva —lo que el flujo empuja contra lo que el descriptor pide— lo destapó. **Las dos direcciones
no pesan igual, y C-2 ya decidió esto para las extensiones:**

- una imagen que el descriptor **pide** y nadie publica es **ROJO**: es el `ImagePullBackOff` con
  el `up` en verde que D-23 existe para impedir;
- una imagen que se **publica** y nadie despliega es **censo con su motivo**, no rojo. Así se
  estrena una interfaz —`caja` pasó por ahí—, y un rojo aquí nacería disparado el primer día del
  trabajo de otro repositorio. Una comprobación que grita el primer día se silencia (#437).

Medido contra `ghcr.io`: `kamayuk-catastro-web` da **404** en la punta de `catastro`, o sea que
su flujo la declara y todavía no hay ninguna.

---

## 4. Lo que sube, con nombre y apellido

`prod` pasa de `1 940m / 6 304Mi` permanentes a **`1 990m / 6 368Mi`**, y del pico
`2 610m / 9 696Mi` a **`2 660m / 9 760Mi`**: exactamente **50m y 64Mi**, el contenedor de nginx.

`perfil-del-ambiente.test.ts` dice que cambiar esas cifras **no es arreglar la prueba** sino
declarar que la demanda de producción cambió, así que se mide contra el nodo: `prod` pasa de
faltarle **810m** de CPU a **860m**, y de **3 968Mi** a **4 032Mi**. **No cabía antes y no cabe
ahora** —es D-25—, pero la interfaz lo empeora en una cantidad exacta, y esa cantidad queda
escrita.

Y las **quince** cargas sin credencial, que eran catorce: el quinto `Deployment` hereda el hueco
de D-23 en vez de quedarse fuera de él.

---

## 5. Las cuatro versiones suben a sus puntas

`kamayuk:versionDe{Rentas,Catastro,Normativa,Caja}` pasan al `sha` de `main` de cada clon. **No es
cosmética y no es gratis**: la versión va **en el nombre** del `Job`, así que esto crea `Job` de
migración e implantación nuevos en los dos ambientes — que es el único mecanismo por el que una
migración llega a un ambiente en marcha (#675).

Hacía falta porque el manifiesto pedía `kamayuk-caja-interfaz:90919433a02…`, un `sha` **anterior a
que la interfaz existiera**: `404 MANIFEST_UNKNOWN`, y un `pulumi up` que la pidiera dejaría el pod
en `ImagePullBackOff` sin que el `up` fallara.

Comprobado contra el registro antes de subirlas: las **nueve** imágenes que `stg` pide existen.
`prod` no se pudo confirmar desde aquí porque las tres del monolito son privadas y contestan
**403** a una credencial personal —que **no** es «no existe», y el guion no lo da por bueno—; en
CI se pregunta con `REGISTRY_PULL_TOKEN`, que es la credencial que el nodo usa.

---

## 6. Las mutaciones

Cada una aplicada **sola**, ejecutada, y restaurada **por copia comparada con `cmp`**. Línea base:
**687 en verde**.

| # | Mutación | Resultado |
|---|---|---|
| **M1** | El descriptor de `caja` pide una imagen que su flujo no empuja | 2 en rojo, y una lo dice entero: «el descriptor de «caja» pide kamayuk-caja-inventada y su flujo no la empuja: el manifiesto es valido, `pulumi up` sale en verde y el pod se queda en ImagePullBackOff» |
| **M2** | El nginx de la interfaz pierde su `location /` | 1 en rojo: «readinessProbe pide «/», y el nginx de «caja» solo declara «/solo-esto», «/assets/», «=»» |
| **M2b** | La sonda de la interfaz pide una ruta que nginx no sirve | **VERDE — ver abajo** |
| **M3** | El compose de `caja` pierde su servicio `caja-interfaz` | 1 en rojo |
| **M5** | Sube lo que pide el contenedor de la interfaz | 3 en rojo, y el primero es el nodo: «expected 3438 to be less than or equal to 1700» |
| **M6** | **El defecto entero**: `correElBackend` devuelve `true` para todo | **8 en rojo**, exactamente los tres archivos del principio — y entre ellos el censo, que es la señal de que la separación no puede pasar callada |

### M2b pasó en VERDE, y dice qué protege esta guarda y qué no

Cambiar la sonda de la interfaz a `/no-lo-sirve-nginx` **no pone nada rojo**, y es correcto:
`location /` es un prefijo que casa con cualquier ruta, así que con esta configuración **ninguna
sonda puede fallar**. Lo que la guarda protege no es la sonda: es que **la configuración siga
teniendo quien la atienda**. Por eso la mutación que muerde es M2, sobre el nginx, y no sobre la
sonda. Queda dicho para que nadie escriba M2b creyendo que mide algo.

---

## 7. Lo que este trabajo no toca

- **`catastro` no se toca.** Su `kamayuk-catastro-web` se cuenta, no se arregla: es de su dueño.
- **El monolito sigue donde estaba.** Retirarlo es [`E`](E-el-monolito-sale-del-sistema.md), que
  rebasa encima de esto.
- **No se ejecuta ningún `pulumi up`.**
