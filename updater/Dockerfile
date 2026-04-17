FROM alpine:3.19

RUN apk add --no-cache git python3 docker-cli docker-cli-compose

WORKDIR /app
COPY server.py update.sh ./
RUN chmod +x update.sh

EXPOSE 8070

CMD ["python3", "server.py"]
