"""
Voice service for Aether mode.
Provides:
  POST /transcribe  — audio → text (faster-whisper)
  POST /speak       — text → audio stream (XTTS-v2)
  GET  /health      — health check

Run: uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import io
import os
import logging
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Model paths ────────────────────────────────────────────────────────────────
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"

# Path to a reference voice WAV for XTTS cloning (6–30 sec, clean speech)
# If not found, falls back to a built-in speaker embedding
REFERENCE_WAV_PATH = Path(os.environ.get("REFERENCE_WAV", "assets/reference.wav"))

# Compute type: float16 for GPU, int8 for CPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")
DEVICE = os.environ.get("DEVICE", "cuda")  # or "cpu"


# ── Lazy model loading ─────────────────────────────────────────────────────────
whisper_model = None
tts_model = None


def load_whisper():
    global whisper_model
    if whisper_model is not None:
        return whisper_model
    logger.info(f"Loading Whisper {WHISPER_MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})...")
    from faster_whisper import WhisperModel
    whisper_model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
    )
    logger.info("Whisper loaded ✓")
    return whisper_model


def load_tts():
    global tts_model
    if tts_model is not None:
        return tts_model
    logger.info("Loading XTTS-v2...")
    from TTS.api import TTS
    tts_model = TTS(XTTS_MODEL_NAME).to(DEVICE)
    logger.info("XTTS-v2 loaded ✓")
    return tts_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load models on startup
    try:
        load_whisper()
    except Exception as e:
        logger.error(f"Failed to load Whisper: {e}")
    try:
        load_tts()
    except Exception as e:
        logger.error(f"Failed to load XTTS-v2: {e}")
    yield


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Aether Voice Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "whisper": whisper_model is not None,
        "xtts": tts_model is not None,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile):
    """
    Accepts audio file (webm, opus, wav, mp3, ogg).
    Returns { text, language, duration }.
    """
    model = load_whisper()

    # Save to temp file (faster-whisper needs a file path or bytes)
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(400, "Audio file is empty or too small")

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(
            tmp_path,
            beam_size=5,
            language=None,          # auto-detect (works for Russian + English)
            vad_filter=True,        # skip silence
            vad_parameters={"min_silence_duration_ms": 500},
        )

        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


class SpeakRequest(BaseModel):
    text: str
    language: str = "ru"


@app.post("/speak")
async def speak(req: SpeakRequest):
    """
    Converts text to speech using XTTS-v2.
    Returns streaming audio/wav.
    """
    if not req.text.strip():
        raise HTTPException(400, "text is empty")

    model = load_tts()

    # Determine speaker — use reference WAV if available
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name

    try:
        tts_kwargs = dict(
            text=req.text,
            language=req.language,
            file_path=out_path,
        )

        if REFERENCE_WAV_PATH.exists():
            tts_kwargs["speaker_wav"] = str(REFERENCE_WAV_PATH)
        else:
            # Use built-in speaker (XTTS default for multilingual)
            tts_kwargs["speaker"] = "Ana Florence"

        model.tts_to_file(**tts_kwargs)

        def iter_wav():
            with open(out_path, "rb") as f:
                while chunk := f.read(8192):
                    yield chunk

        return StreamingResponse(
            iter_wav(),
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"},
        )
    except Exception as e:
        Path(out_path).unlink(missing_ok=True)
        logger.error(f"TTS error: {e}")
        raise HTTPException(500, f"TTS failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
