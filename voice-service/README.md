# Aether Voice Service

FastAPI сервис для STT (Whisper) и TTS (XTTS-v2).

## Установка

```bash
cd voice-service

# 1. Python окружение
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 2. PyTorch с CUDA (RTX GPU)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# 3. Зависимости
pip install -r requirements.txt
```

## Запуск

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## Переменные окружения

| Переменная | Значение по умолчанию | Описание |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | Модель Whisper |
| `DEVICE` | `cuda` | `cuda` или `cpu` |
| `WHISPER_COMPUTE_TYPE` | `float16` | `float16` (GPU) или `int8` (CPU) |
| `REFERENCE_WAV` | `assets/reference.wav` | Эталонный голос для XTTS cloning |
| `VOICE_SERVICE_URL` | `http://localhost:8001` | URL сервиса (для NestJS) |

## Эталонный голос (XTTS voice cloning)

Положи 6–30 секунд чистой речи в `assets/reference.wav`.
XTTS будет использовать этот голос для всех ответов.
Без файла — используется встроенный голос "Ana Florence".

## Endpoints

- `GET /health` — проверка состояния
- `POST /transcribe` — загрузить audio файл → получить текст
- `POST /speak` — `{"text": "...", "language": "ru"}` → audio/wav stream
