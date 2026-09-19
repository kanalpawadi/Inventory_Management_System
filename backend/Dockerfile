# Slim runtime image — serves precomputed predictions; no TensorFlow/Prophet needed.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
# Render / Cloud Run inject $PORT; default to 8000 locally
ENV PORT=8000
EXPOSE 8000
CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT} --workers 1
