# Runtime libs for the Solar2D 2024.3711 Linux builder (snap base: core20 = Ubuntu 20.04).
FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq \
 && apt-get install -y -qq libsdl2-2.0-0 libgssapi-krb5-2 libbsd0 libsqlite3-0 libcurl4 >/dev/null \
 && rm -rf /var/lib/apt/lists/*
