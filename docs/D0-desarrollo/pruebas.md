# DEV-02 — Pruebas

## 1. Qué verifica qué

| Tarea | Qué mide | Necesita |
|---|---|---|
| `yarn verificar` | El descriptor: lint, tipos (**dos** `tsconfig`) y pruebas | nada |
| `yarn capacidad --ambiente prod` | Si el stack cabe en el nodo, sin desplegar | nada |
| `cd librerias-backend && ./gradlew build` | Las barreras que consumen los cinco backends | nada |
| `node docs/00-gobierno/verificar-las-muestras-del-registro.mjs` | Que la guarda de #711 muerde y no muerde de más | nada |

Ninguna de esas necesita Pulumi, ni token, ni clúster. **Y ninguna de esas es suficiente**, que es
lo propio de este repositorio: ver §4.

## 2. `yarn verificar` NO está en verde hoy, y por qué

Medido el 2026-09-04 sobre este árbol, en macOS: **16 archivos, 344 pruebas, 337 en verde y 7 en
rojo**, en dos archivos. Los dos fallos son **heredados de la mudanza desde `sgtm`**, ninguno lo
introdujo la separación de documentación, y **ninguno se arregla aquí sin tomar una decisión**. Se
escriben en vez de esconderse: un README que dijera «`yarn verificar` en verde» sería falso, y una
instrucción falsa cuesta más que una que falta.

### 2.1 `deriva-de-migraciones.test.ts` — 6 rojas

```
«c755de2149344b8033736958ee8ae6f643c90281» no esta en este clon, asi que no se puede
saber cuantas migraciones trae. Esta comprobacion NO se salta: un numero inventado
seria peor que ninguno.
```

La guarda de #675 resuelve `applicationBootstrapVersion` como una revisión **del repositorio en
que vive** (`git ls-tree <sha> backend/sgtm-esquema/…/db/migration/`). En `sgtm` eso funcionaba
porque el `sha`, el `Pulumi.<ambiente>.yaml` y las migraciones estaban en el mismo `git log`.
**Aquí no**: `c755de21…` es un *commit* de `sgtm` —comprobado, `git cat-file -t` lo encuentra allí
y no aquí— y la historia de `infrastructure` empieza en su propio commit inicial.

La guarda **está haciendo su trabajo**: se niega a inventar un número. Lo que hay que decidir
—y no es de esta etapa— es qué significa esa versión ahora que cada sistema trae su propio
baseline (ADR-0032): son cuatro historias de migraciones en cuatro repositorios, y una sola
línea de configuración por ambiente.

### 2.2 `reserva-del-nodo.test.ts` — 1 roja, y sólo en macOS

```
· La reserva existente es de este guion pero con otras cifras: se corrige.
sed: -e: No such file or directory
```

`infra/vps/reservar-recursos-del-nodo.sh` corrige la reserva duplicada con `sed -i -e …`, que es
sintaxis **GNU**. El `sed` de macOS es BSD y lee el `-e` como la extensión del respaldo. El guion
se ejecuta contra un nodo Linux y CI corre en `ubuntu-latest`, así que **el rojo es del entorno de
quien desarrolla en macOS, no del guion en producción**. La corrección portable es escribir a un
temporal y mover, no `sed -i`.

Reproducirlo sin vitest, para no creérselo:

```bash
cd infra
TMP=$(mktemp -d)
printf 'write-kubeconfig-mode: "0644"\n\n# … Escrito por infra/vps/reservar-recursos-del-nodo.sh …\nkubelet-arg:\n  - "system-reserved=cpu=1,memory=1Gi"\n  - "kube-reserved=cpu=1,memory=1Gi"\n' > $TMP/config.yaml
SGTM_CONFIG_K3S=$TMP/config.yaml bash vps/reservar-recursos-del-nodo.sh --solo-configuracion
```

## 3. Las barreras, medidas desde el consumidor

`librerias-backend` no tiene consumidor propio: las 18 reglas y sus 40 muestras sólo demuestran
que muerden cuando un backend las ejecuta. Para medirlo de verdad:

```bash
cd ../rentas/backend && ./gradlew cleanTest verificarArquitectura --no-build-cache
```

**Demostrado que la cadena entera muerde**: borrar
`comun-verificaciones/…/muestras/indicadores/MuestraDePanelQueLeeLaBase.java` **aquí** pone en
rojo el `verificarArquitectura` **de otro repositorio**, nombrando la regla del panel. Eso es lo
que compra el *composite build* frente a un jar publicado.

**Cuidado con el verde rancio**: Gradle da `UP-TO-DATE` o `FROM-CACHE` y no ejecuta nada. Una
tarea que no corre no demuestra nada, y por eso los comandos de arriba llevan `cleanTest` y
`--no-build-cache`.

## 4. Lo que sólo se verifica ejecutándolo contra algo real

Es la mitad del valor de este repositorio, y no cabe en una prueba unitaria: que el respaldo se
**restaure**, que la alerta le **llegue** a alguien, que rotar una clave de verdad **invalide** la
anterior.

```bash
infra/verificaciones/motor/verificar-el-motor.sh --con-aislamiento
infra/verificaciones/ambiente/verificar-el-ambiente.sh --ambiente prod
infra/respaldo/simulacro-de-restauracion.sh --ambiente stg
infra/observabilidad/verificar-alertas.sh
infra/observabilidad/verificar-tableros.sh
infra/secretos/verificar-rotacion.sh
infra/secretos/asignar-claves.sh --ambiente stg --comprobar
infra/verificaciones/capacidad/verificar-contra-el-planificador.sh
infra/verificaciones/raiz-sellada/verificar-raiz-sellada.sh
```

Tres cosas de esa lista no son un detalle:

- **El aislamiento se verifica contra el motor que levanta ese guion, nunca contra uno en
  servicio.** La prueba provisiona, y `ALTER ROLE` sobre `sgtm_owner` y `sgtm_app` vale para
  **todas** las bases del clúster. Apuntarla a `prod` deja fuera a la aplicación.
- **`verificar-el-ambiente.sh` compara el ambiente desplegado con la versión declarada**, no con
  el árbol de trabajo. Si `Pulumi.<ambiente>.yaml` apunta a una revisión que no está en el clon,
  el guion **no concluye** en vez de contar las migraciones de otra cosa — por eso los flujos que
  lo corren llevan `fetch-depth: 0`.
- **Un guion que existe y no corre nadie no protege nada.** Ya pasó dos veces:
  `verificar-cuadros.mjs` y `verificar-rotacion.sh` estaban escritos y ningún flujo los invocaba.
  Si añades uno, engánchalo el mismo día.

## 5. La guarda del registro (#711)

```bash
node docs/00-gobierno/verificar-las-muestras-del-registro.mjs   # 6 muestras: 3 rojas, 3 verdes
node docs/00-gobierno/verificar-fila-del-registro.mjs           # contra el PR actual
```

Las tres verdes son la mitad que importa: un PR de sólo documentación, de sólo pruebas o sin issue
asociado **tiene que pasar**. Una guarda que grita siempre acaba esquivada, y en una convención de
proceso eso es peor que no tenerla.

## 6. Cómo se cuenta lo que corrió

El número que se afirma en un PR sale de los informes, no de la memoria:

```bash
python3 - <<'PY'
import glob, xml.etree.ElementTree as ET
t = f = e = s = 0
for p in glob.glob('librerias-backend/**/build/test-results/test/*.xml', recursive=True):
    r = ET.parse(p).getroot()
    t += int(r.get('tests')); f += int(r.get('failures'))
    e += int(r.get('errors')); s += int(r.get('skipped'))
print(f'pruebas={t} fallos={f} errores={e} omitidas={s}')
PY
```

## 7. Demostrar que una verificación puede fallar

1. Se rompe **una sola cosa** en el código que la verificación protege.
2. Se ejecuta —de verdad, sin caché— y se anota **el rojo exacto**: cuántas, cuáles y qué dice.
3. Se **restaura por copia** y se compara byte a byte con `cmp`. Un `sed` de vuelta puede pisar
   otra línea idéntica, y el único síntoma sería que algo deja de compilar más tarde.
4. Si la rotura pasa en **verde**, eso es el hallazgo: la verificación no medía lo que parecía. Se
   escribe, no se descarta.
