// comun-verificaciones — las barreras, en un solo sitio para los cinco repositorios.
//
// Va en `src/main` y no en `src/test` a proposito: quien la consume la pone en su
// `testImplementation`, y para eso tiene que ser el artefacto principal. Que sus
// clases se llamen «...TestBase» no las hace pruebas: son las clases base de las
// que cada repositorio deriva la suya, con su configuracion.
//
// LO QUE NO ESTA AQUI, y conviene decirlo porque se busca: el contrato de la API de cada
// sistema (`ContratoDeApiTest`, `FormasDeLaApiTest`, `RespuestasDeLaApiTest`) y el panel
// de recaudacion. Cada sistema publica lo suyo, asi que compartirlos seria compartir una
// verdad que no es la misma en los cuatro.
//
// LO QUE SI ESTA, desde P6: `contrato/`, el contrato ENTRE sistemas. Ahi la logica es la
// contraria — lo que un consumidor espera de un proveedor tiene que significar lo mismo
// leido desde los dos lados, y dos implementaciones de «que forma tiene este JSON»
// acabarian discrepando justo en el caso raro. Discrepar ahi significa que el proveedor
// cree cumplir un contrato que el consumidor lee de otra manera.
plugins {
    `java-library`
    id("com.diffplug.spotless") version "8.9.0"
}

// El MISMO formato que los cinco repositorios que la consumen: AOSP, 4 espacios y 100
// columnas (ARQ-04 §5). Sin esto, un `spotlessApply` en cualquiera de ellos no tocaria esta
// libreria y el codigo compartido acabaria con dos estilos —y el diff de un cambio de una
// linea vendria con doscientas de reformateo.
spotless {
    java {
        target("src/**/*.java")
        googleJavaFormat("1.36.1").aosp()
        removeUnusedImports()
        trimTrailingWhitespace()
        endWithNewline()
    }
}

group = "kamayuk.comun"
version = "0.1.0-SNAPSHOT"

val versionDeJava = providers.gradleProperty("kamayuk.java.version").getOrElse("25").toInt()

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(versionDeJava))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-Xlint:all", "-parameters"))
}

dependencies {
    // ArchUnit, JUnit y AssertJ son `api` y no `implementation`: quien deriva de
    // `ArquitecturaTestBase` escribe `@Test` y `assertThat`, asi que los necesita
    // en su propio classpath de compilacion. Declararlos `implementation` obligaria
    // a cada repositorio a repetirlos, que es un sitio mas donde una version puede
    // divergir.
    api(platform(libs.junit.bom))
    api(libs.junit.jupiter)
    api(libs.assertj)
    api(libs.archunit)
    api(libs.jspecify)

    // Las clases de muestra llevan @Service, @Transactional, @RestController y
    // @Component: sin ellas las reglas que vigilan esas anotaciones no tendrian
    // como demostrarse. Es la unica razon por la que Spring entra aqui, y entra
    // como `compileOnly` + `api` de las anotaciones minimas.
    api(platform(libs.spring.boot.bom))
    api("org.springframework:spring-context")
    api("org.springframework:spring-tx")
    api("org.springframework:spring-web")
    api("org.springframework.boot:spring-boot")

    // Jackson entra por las pruebas de contrato entre repositorios (P6): el archivo que
    // el consumidor publica lo lee el proveedor, y son dos builds distintos. Los cinco
    // backends ya lo tienen —son aplicaciones Spring Boot web—, asi que no anade nada a
    // su classpath; lo que anade es poder leerlo desde aqui.
    api("com.fasterxml.jackson.core:jackson-databind")

    testImplementation(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}

// Las fuentes de las clases de muestra viajan tambien como RECURSO, no solo compiladas.
//
// Los escaneres se demuestran sobre archivos de verdad —con su javadoc dentro, que es la mitad de
// la demostracion: si contaran los comentarios, `MuestraDeRepositorioQueBorra` daria seis hallazgos
// y no tres—. Mientras las muestras vivian en el mismo modulo que la prueba, ese archivo se leia
// del disco por su ruta; ahora el repositorio que consume esta libreria no tiene sus fuentes, asi
// que se empaquetan junto a las clases y se leen del classpath (`FuenteDeMuestra`).
//
// Si esto se quita, `FuenteDeMuestra` falla nombrando el recurso que falta. Es a proposito: una
// demostracion que no encuentra su muestra tiene que ponerse roja, no pasar.
// Y las migraciones de muestra, que no son Java: `RevisorDeEsquema` se demuestra sobre SQL
// (ADR-0034 regla 1), y una de sus muestras solo existe repartida en DOS archivos —la tabla
// nace sin geometria y la recibe tres migraciones despues—, que es la forma en que ese defecto
// llega de verdad. Sin empaquetarlas, `FuenteDeMuestra` falla nombrando el recurso que falta.
tasks.processResources {
    from("src/main/java/kamayuk/comun/verificaciones/muestras") {
        include("**/*.java", "**/*.sql")
        into("fuentes-de-muestra")
    }
}
