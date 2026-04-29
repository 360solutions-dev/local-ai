FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8501 8080

CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port 8080 & streamlit run app.py --server.port 8501 --server.address 0.0.0.0"]
