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

# Coqui TTS imports transformers.pytorch_utils.isin_mps_friendly, removed in newer transformers.
# Patch it with torch.isin so TTS loads without pinning an old transformers.
def _patch_transformers_for_tts():
    import torch
    import transformers.pytorch_utils as pu
    if not hasattr(pu, "isin_mps_friendly"):
        pu.isin_mps_friendly = torch.isin
_patch_transformers_for_tts()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")
DEVICE = os.environ.get("DEVICE", "cuda")

# ── Model cache ────────────────────────────────────────────────────────────────
whisper_model = None
tts_model = None
tts_speaker_name = None   # first available speaker (fallback)


def load_whisper():
    global whisper_model
    if whisper_model is not None:
        return whisper_model
    logger.info(f"Loading Whisper {WHISPER_MODEL_SIZE} on {DEVICE} ({COMPUTE_TYPE})...")
    from faster_whisper import WhisperModel
    whisper_model = WhisperModel(WHISPER_MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
    logger.info("Whisper loaded ✓")
    return whisper_model


def load_tts():
    global tts_model, tts_speaker_name
    if tts_model is not None:
        return tts_model
    logger.info("Loading XTTS-v2...")
    from TTS.api import TTS
    tts_model = TTS(XTTS_MODEL_NAME).to(DEVICE)

    # Pick first available speaker as fallback (avoids KeyError on "Ana Florence")
    try:
        speakers = tts_model.speakers or []
        tts_speaker_name = speakers[0] if speakers else None
        logger.info(f"XTTS-v2 loaded ✓ — available speakers: {len(speakers)}, fallback: {tts_speaker_name}")
    except Exception as e:
        logger.warning(f"Could not list speakers: {e}")
        tts_speaker_name = None

    return tts_model


@asynccontextmanager
async def lifespan(app: FastAPI):
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


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "whisper": whisper_model is not None,
        "xtts": tts_model is not None,
        "reference_wav": REFERENCE_WAV_PATH.exists(),
        "fallback_speaker": tts_speaker_name,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile):
    model = load_whisper()

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
            language=None,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {"text": text, "language": info.language, "duration": round(info.duration, 2)}
    finally:
        Path(tmp_path).unlink(missing_ok=True)


class SpeakRequest(BaseModel):
    text: str
    language: str = "ru"


@app.post("/speak")
async def speak(req: SpeakRequest):
    if not req.text.strip():
        raise HTTPException(400, "text is empty")

    model = load_tts()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name

    try:
        tts_kwargs = dict(
            text=req.text,
            language=req.language,
            file_path=out_path,
        )

        # Use built-in speaker (default); reference WAV is optional and can break path handling on Windows
        if tts_speaker_name:
            tts_kwargs["speaker"] = tts_speaker_name
            logger.info(f"TTS: using built-in speaker '{tts_speaker_name}', lang={req.language}, len={len(req.text)}")
        else:
            logger.warning("TTS: no built-in speaker available, trying without")

        model.tts_to_file(**tts_kwargs)

        audio_data = Path(out_path).read_bytes()

        def iter_wav():
            yield audio_data

        return StreamingResponse(
            iter_wav(),
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"},
        )
    except Exception as e:
        logger.error(f"TTS error: {e}", exc_info=True)
        raise HTTPException(500, f"TTS failed: {str(e)}")
    finally:
        Path(out_path).unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")