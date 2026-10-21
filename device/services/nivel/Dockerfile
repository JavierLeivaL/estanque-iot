# Imagen liviana ARM64 con libgpiod v2 (acceso al GPIO por /dev/gpiochip0).
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-paho-mqtt python3-libgpiod \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY main.py .
ENV PYTHONUNBUFFERED=1
# Corre como root SOLO para poder abrir /dev/gpiochip0 (el contenedor NO es privilegiado:
# únicamente se le mapea ese dispositivo).
CMD ["python3", "main.py"]
