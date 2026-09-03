// La libreria de verificaciones que consumen los cinco repositorios.
//
// Es un build propio y no un modulo de ninguno de ellos: si viviera dentro de uno,
// los otros cuatro dependerian de ese, que es justo lo que la separacion deshace.
//
// Se consume como *composite build* —`includeBuild` desde el `settings.gradle.kts`
// de cada backend— y no como artefacto publicado. El motivo esta escrito en
// `README.md`, y en una linea: un jar publicado a mano se queda viejo sin que nada
// se ponga rojo, y una verificacion vieja que pasa en verde es exactamente el modo
// de fallo que este proyecto lleva doscientos issues evitando (#192).
rootProject.name = "librerias-backend"

include("comun-verificaciones")

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        mavenCentral()
    }
}
