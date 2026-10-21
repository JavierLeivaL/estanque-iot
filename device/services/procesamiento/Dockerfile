# Imagen liviana compatible con ARM64 (Raspberry Pi). Usa los paquetes de Debian,
# así no hay que compilar nada en la Raspberry.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-paho-mqtt \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1000 --create-home app
WORKDIR /app
COPY main.py .
ENV PYTHONUNBUFFERED=1
USER app
CMD ["python3", "main.py"]
