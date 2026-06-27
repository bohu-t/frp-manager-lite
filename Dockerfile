ARG PYTHON_IMAGE=python:3.13.5-slim-bookworm
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FML_HOST=0.0.0.0 \
    FML_PORT=8080 \
    FML_DB=/data/data.sqlite3

WORKDIR /app

RUN addgroup --system --gid 10001 fml \
    && adduser --system --uid 10001 --ingroup fml --home /app --no-create-home fml \
    && mkdir -p /data \
    && chown -R fml:fml /data /app

COPY --chown=fml:fml app.py /app/app.py
COPY --chown=fml:fml frontend/ /app/frontend/

USER fml

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/nodes', timeout=3).read()" || exit 1

CMD ["python", "app.py"]
