FROM denoland/deno:bin-2.9.7 AS deno
FROM python:3.12.13-slim-bookworm

WORKDIR /app
COPY --from=deno /deno /usr/local/bin/deno
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && deno --version
COPY app.py resolver.py extract_worker.py baslat.sh ./
RUN chmod +x baslat.sh
ENV PORT=4455
EXPOSE 4455
CMD ["./baslat.sh"]
