# ADR-0001 — Plataforma del backend: Spring Boot 4 sobre Java 25

**Estado:** Aceptado
**Fecha:** 2026-08-17

## Contexto

El sistema original es Visual Basic .NET sobre .NET Framework 4.0 y SQL Server 2008, con cliente
Windows. Nada de eso se conserva: el destino es una aplicación web multi-municipal.

La elección de plataforma condiciona veinte años de mantenimiento en una entidad pública, donde
la rotación de personal es alta y la contratación de perfiles muy especializados, difícil.

## Decisión

**Spring Boot 4 sobre Java 25 (LTS)**, con Gradle y Kotlin DSL para el build.

Es la misma plataforma que el [SRTM](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/../srtm/CLAUDE.md), y esa coincidencia es
deliberada: los dos productos comparten dominio, estrategia multi-tenant y equipo potencial.
Lo aprendido en uno se aplica en el otro sin traducción.

Razones propias:

- **Disponibilidad de personal.** Java es el perfil más fácil de contratar y de reemplazar en el
  sector público peruano.
- **RLS de PostgreSQL vía JDBC estándar.** El mecanismo de aislamiento —`SET LOCAL` por
  transacción— se implementa con un gestor de transacciones propio de 60 líneas, sin depender de
  extensiones del ORM.
- **Java 25 LTS** trae `record`, `sealed` y pattern matching, que sirven para modelar objetos de
  valor tributarios sin ceremonia.
- Spring Modulith permite el monolito modular de [ADR-0003](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0003-monolito-modular.md) con
  límites verificados en el build.

## Consecuencias

- Se necesita JDK 25 para compilar. La versión es una propiedad de Gradle para poder construir
  donde todavía no esté instalado; CI usa siempre la de `gradle.properties`.
- La capa `dominio` no depende de Spring, para que las reglas tributarias se prueben sin levantar
  el contexto (regla 7 de [ARQ-04](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/estandares-de-codigo-backend.md)).
- El artefacto es único y se despliega en dos perfiles, web y batch: la emisión masiva no compite
  por recursos con la caja.

## Alternativas consideradas

- **.NET moderno.** Habría conservado el lenguaje del original, pero no el código: el sistema es
  de escritorio y no hay nada que portar. Sin ventaja real, y con menos afinidad con el SRTM.
- **Node.js / TypeScript en el backend.** Descartado por la aritmética monetaria: el `number` de
  JavaScript es binario de doble precisión, y aquí se manejan importes. Un decimal por biblioteca
  es posible, pero la prohibición no sería verificable en el build con la misma facilidad.
