#!/usr/bin/env bash
# El cortafuegos del VPS: 22, 80 y 443, y nada mas (issue #153).
#
# **Esto no lo puede hacer Pulumi**, y conviene saber por que: Pulumi habla con el API
# de k3s, no con el sistema operativo del nodo. Un `Service` de tipo `ClusterIP` no
# publica nada, pero el propio k3s abre puertos en el nodo —6443 del API server, 10250
# del kubelet— y PostgreSQL responde en la red del clúster. Lo que decide que desde
# internet solo respondan 80 y 443 es esto, y se ejecuta **al aprovisionar el nodo**.
#
# Es tambien la razon de que la comprobacion correspondiente se haga DESDE FUERA: que un
# puerto no responda es una afirmacion sobre lo que ve internet, y no se puede verificar
# desde dentro del nodo.
#
#   uso, en el VPS y como root:  ./cortafuegos.sh
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
    echo "Esto configura el cortafuegos del nodo: hay que correrlo como root." >&2
    exit 1
fi

command -v ufw >/dev/null 2>&1 || { echo "Falta ufw. Instalalo primero." >&2; exit 1; }

# El orden importa: la regla de SSH va ANTES de la denegacion por omision. Al reves, la
# sesion por la que se esta configurando el cortafuegos se corta a si misma, y en un VPS
# sin consola de rescate eso es un viaje al panel del proveedor.
ufw allow 22/tcp   comment 'SSH: administracion y el tunel al API de k3s'
ufw allow 80/tcp   comment 'HTTP: solo redirige a 443, y el desafio HTTP-01 de ACME'
ufw allow 443/tcp  comment 'HTTPS: por aqui entra todo el mundo'

ufw default deny incoming
ufw default allow outgoing

# k3s enruta el trafico de los pods por sus propias interfaces. Sin esto, la denegacion
# por omision corta la red DENTRO del clúster y el sintoma —pods que no se ven entre
# ellos— no se parece en nada a «configure el cortafuegos».
ufw allow in on cni0
ufw allow in on flannel.1
ufw route allow in on cni0
ufw route allow out on cni0

ufw --force enable
ufw status verbose

cat <<'AVISO'

Lo que queda cerrado desde internet, y es el punto de todo esto:

  6443   API de k3s      → se llega por tunel SSH (INF-01 §1.4)
  10250  kubelet
  5432   PostgreSQL      → nunca se publica
  8080   Keycloak        → solo por /keycloak del ingreso, y sin /keycloak/admin

Comprobarlo DESDE FUERA del VPS, que es el unico sitio desde donde significa algo:

  nmap -Pn -p 22,80,443,5432,6443,10250 <vps>
AVISO
