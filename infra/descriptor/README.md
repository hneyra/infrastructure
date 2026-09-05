# `descriptor/` — el contrato con el que un sistema aporta su infraestructura

ADR-0031 §2. Cada repositorio publica `@kamayuk/infra-<sistema>`; `infrastructure` lo importa,
**fija su versión**, lo compone y **lo audita con las mismas reglas que audita los propios**.

## Por qué esto se puede hacer

`ADR-0011` eligió que cada componente fuera **una función pura que devuelve objetos planos de
Kubernetes**, en vez de crear recursos. Se eligió por tres motivos escritos —la auditoría puede
leerlos, las pruebas corren sin Pulumi y sin clúster, y el diff es legible— y ninguno hablaba de
repositorios.

**Esa elección es la que permite ahora que un descriptor cruce la frontera de un repositorio sin
perder la verificación.** `infrastructure` recibe datos, no llamadas: puede leerlos, compararlos
con `INF-01` §4 y **negarse a aplicarlos**, exactamente igual que con los suyos. Si un descriptor
creara recursos, `auditarDescriptor` no tendría nada que leer y la única garantía sería la
confianza en quien lo escribió. **Si se rompe eso, esto no funciona.**

## Lo que declara

| Miembro | Qué es |
|---|---|
| `baseDeDatos()` | Su base y sus roles. Datos, no DDL: el motor es de `infrastructure` |
| `despliegue()` | Su `Deployment` y su `Service`. Uno por perfil si tiene más de uno |
| `migracion()` | Su `Job`. Cada base tiene sus migraciones y su prueba de aislamiento |
| `ingreso()` | Sus rutas, **bajo su prefijo** |
| `egreso()` | A quién puede llamar. El *deny* por omisión y la entrada son de la plataforma |
| `alertas()`, `panel()` | Lo suyo de observabilidad; la instalación es común |
| `claves()` | Su inventario: metadatos, **nunca un valor** |

## Las cinco prohibiciones, y cuál sostiene a las otras

| | Prohibición | Dónde se implementa |
|---|---|---|
| (a) | Una ruta fuera de su prefijo | `auditarPrefijo` |
| (b) | **Declarar la etiqueta de la imagen** | `auditarEtiquetaDeImagen` |
| (c) | Privilegios sobre la base de otro sistema | `auditarBaseAjena` |
| (d) | Un `Deployment` sin límites o sin sondas | **`auditarManifiestos`, el de los componentes propios** |
| (e) | Un `Secret` en claro | `auditarSecretoEnClaro` |

**La (b) es la que sostiene todo lo demás.** Si la etiqueta entra en el descriptor, entra en el
estado de Pulumi: cada liberación vuelve a ser un `pulumi up`, cada reversión también, y componer
aquí pasa de barato a ser el cuello de botella que la separación venía a quitar (ADR-0011 §5).

**La (d) es la que enseña cómo está montado esto: no se implementa aquí.** La hace
`auditarManifiestos`, el mismo que audita `BaseDeDatos.ts` o `Ingreso.ts`. Escribirla otra vez
serían dos definiciones de «límites de recursos» envejeciendo aparte.

## Un descriptor no se puede auditar solo

Lo destapó escribir la primera muestra válida, y por eso `ContextoDeDescriptores` pide los
manifiestos de la plataforma. `auditarPrioridades` comprueba que la `priorityClassName` de cada
pod corresponda a una `PriorityClass` **del manifiesto**, y las `PriorityClass` son de alcance de
clúster: las crea `infrastructure`. Auditado por su cuenta, **cualquier descriptor correcto sale
rojo** por dos clases que no le toca definir.

Así que se audita la unión y se le imputa al descriptor el **delta**: lo que aparece al añadirlo y
no estaba antes. Es también lo que ocurre al desplegar, así que la auditoría del PR y la del `up`
miran lo mismo.

## Las muestras

`muestras/prohibidos.ts` tiene **cinco**, cada una el descriptor válido de `catastro` con **un
solo cambio**. `muestras/validos.ts` tiene **dos** que la auditoría acepta —`catastro` con un
perfil, `rentas` con dos—, y son la mitad que importa: sin ellos, un `auditarDescriptor` que
rechazara todo pasaría las cinco pruebas de las prohibiciones.

Medido quitando cada guarda, una a una:

| Mutación | Resultado |
|---|---|
| Quitar `auditarPrefijo` | **Rojo**: (a) |
| Quitar `auditarEtiquetaDeImagen` | **Rojo**: (b) |
| Quitar `auditarBaseAjena` | **Rojo ×2**: (c) y el rol superusuario |
| Quitar la **herencia** de `auditarManifiestos` | **Rojo ×2**: (d) y la prueba de que la (d) no es una copia |
| Quitar `auditarRecursos` del **`auditoria.ts` propio** | **Rojo ×4**: la (d) del descriptor **y dos pruebas de los componentes propios** (#152, #156) |
| Quitar `auditarSecretoEnClaro` | **Rojo**: (e) |

**La penúltima es la que demuestra el diseño entero**: una regla quitada del auditor de los
componentes propios pone en rojo al descriptor ajeno. No es una comprobación parecida escrita dos
veces: es la misma.
