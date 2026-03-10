#!/usr/bin/env python3
"""
Nova LoRA Trainer
─────────────────
Runs during Nova's sleep cycle to fine-tune the base model on
accumulated memories and interactions.

Usage:
  python3 trainer.py \
    --data        /path/to/batch.jsonl \
    --output      /path/to/lora_output/ \
    --base-model  gemma3:12b \
    --ollama-url  http://localhost:11434 \
    --batch-id    1234567890

Requirements (AMD ROCm):
  pip install pytorch-triton-rocm torchao
  pip install --no-deps unsloth unsloth-zoo
  pip install "unsloth[amd] @ git+https://github.com/unslothai/unsloth"
  pip install trl datasets transformers accelerate

After training, the script:
  1. Saves the LoRA adapter
  2. Creates a new Ollama Modelfile pointing to the fine-tuned model
  3. Registers it with Ollama as "nova-tuned:latest"
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# ── Argument parsing ──────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='Nova LoRA Trainer')
parser.add_argument('--data',        required=True,  help='Path to JSONL training data')
parser.add_argument('--output',      required=True,  help='Output directory for adapter')
parser.add_argument('--base-model',  default='gemma3:12b', help='Ollama model name')
parser.add_argument('--ollama-url',  default='http://localhost:11434')
parser.add_argument('--batch-id',    default='')
parser.add_argument('--rank',        type=int, default=16, help='LoRA rank')
parser.add_argument('--epochs',      type=int, default=1)
parser.add_argument('--max-steps',   type=int, default=60, help='Max training steps')
args = parser.parse_args()

output_dir = Path(args.output)
output_dir.mkdir(parents=True, exist_ok=True)

print(f"[Nova LoRA] Starting training | batch={args.batch_id} | model={args.base_model}")
print(f"[Nova LoRA] Data: {args.data}")
print(f"[Nova LoLA] Output: {output_dir}")

# ── Load training data ────────────────────────────────────────────────────────

with open(args.data, 'r') as f:
    raw_lines = [json.loads(line) for line in f if line.strip()]

print(f"[Nova LoRA] Loaded {len(raw_lines)} training examples")

if len(raw_lines) < 5:
    print("[Nova LoRA] Too few examples — skipping training")
    sys.exit(0)

# ── Resolve HuggingFace model name from Ollama name ──────────────────────────
# Map common Ollama model names to HuggingFace equivalents

MODEL_MAP = {
    'gemma3:12b':           'Qwen/Qwen2.5-7B-Instruct',
    'qwen2.5:3b':           'Qwen/Qwen2.5-3B-Instruct',
    'qwen2.5:1.5b':         'Qwen/Qwen2.5-1.5B-Instruct',
    'qwen3.5:9b':           'Qwen/Qwen2.5-7B-Instruct',  # approximate
    'llama3.2:3b':          'meta-llama/Llama-3.2-3B-Instruct',
    'llama3.1:8b':          'meta-llama/Meta-Llama-3.1-8B-Instruct',
    'gemma3:4b':            'google/gemma-3-4b-it',
    'mistral:7b':           'mistralai/Mistral-7B-Instruct-v0.3',
}

# Check env override first
hf_model = os.environ.get('NOVA_HF_MODEL') or MODEL_MAP.get(args.base_model)
if not hf_model:
    print(f"[Nova LoRA] Unknown model {args.base_model}. Set NOVA_HF_MODEL env var.")
    print(f"[Nova LoRA] Known models: {list(MODEL_MAP.keys())}")
    sys.exit(1)

print(f"[Nova LoRA] Using HuggingFace model: {hf_model}")

# ── Import ML libraries ───────────────────────────────────────────────────────

try:
    import torch
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template, standardize_sharegpt
    from trl import SFTConfig, SFTTrainer
    from datasets import Dataset
    print(f"[Nova LoRA] torch={torch.__version__}, cuda_available={torch.cuda.is_available()}")
except ImportError as e:
    print(f"[Nova LoRA] Missing library: {e}")
    print("[Nova LoRA] Install: pip install torch --index-url https://download.pytorch.org/whl/rocm6.4")
    print("[Nova LoRA] Then: pip install unsloth[amd] trl datasets transformers")
    sys.exit(1)

# ── Load model ────────────────────────────────────────────────────────────────

print(f"[Nova LoRA] Loading model {hf_model}...")
try:
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name    = hf_model,
        max_seq_length = 1024,
        load_in_4bit  = False,   # AMD: use 16bit LoRA (bitsandbytes 4bit unstable on ROCm)
        dtype         = torch.bfloat16,
    )
except Exception as e:
    print(f"[Nova LoRA] Failed to load model: {e}")
    sys.exit(1)

# ── Add LoRA adapters ─────────────────────────────────────────────────────────

model = FastLanguageModel.get_peft_model(
    model,
    r                   = args.rank,
    target_modules      = ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
    lora_alpha          = args.rank,
    lora_dropout        = 0.05,
    bias                = 'none',
    use_gradient_checkpointing = 'unsloth',
    random_state        = 42,
)

print(f"[Nova LoRA] LoRA rank={args.rank}, trainable params: {sum(p.numel() for p in model.parameters() if p.requires_grad):,}")

# ── Apply chat template ───────────────────────────────────────────────────────

tokenizer = get_chat_template(tokenizer, chat_template='chatml')

def format_conversations(examples: dict) -> dict:
    convos = examples['conversations']
    texts  = [tokenizer.apply_chat_template(c, tokenize=False, add_generation_prompt=False) for c in convos]
    return {'text': texts}

# Convert JSONL to dataset
dataset = Dataset.from_list(raw_lines)
dataset = standardize_sharegpt(dataset)
dataset = dataset.map(format_conversations, batched=True)

print(f"[Nova LoRA] Dataset ready: {len(dataset)} examples")

# ── Train ─────────────────────────────────────────────────────────────────────

trainer = SFTTrainer(
    model      = model,
    tokenizer  = tokenizer,
    train_dataset = dataset,
    args       = SFTConfig(
        dataset_text_field     = 'text',
        max_seq_length         = 1024,
        per_device_train_batch_size = 1,
        gradient_accumulation_steps = 4,
        num_train_epochs       = args.epochs,
        max_steps              = args.max_steps,
        learning_rate          = 2e-4,
        warmup_ratio           = 0.1,
        lr_scheduler_type      = 'cosine',
        fp16                   = not torch.cuda.is_bf16_supported(),
        bf16                   = torch.cuda.is_bf16_supported(),
        logging_steps          = 5,
        output_dir             = str(output_dir / 'checkpoints'),
        save_strategy          = 'no',
        report_to              = 'none',
    ),
)

print("[Nova LoRA] Training started...")
trainer.train()
print("[Nova LoRA] Training complete.")

# ── Save adapter ──────────────────────────────────────────────────────────────

adapter_path = output_dir / 'adapter'
model.save_pretrained(str(adapter_path))
tokenizer.save_pretrained(str(adapter_path))
print(f"[Nova LoRA] Adapter saved to {adapter_path}")

# ── Save merged GGUF for Ollama ───────────────────────────────────────────────

gguf_path = output_dir / 'nova-tuned.gguf'
print(f"[Nova LoRA] Converting to GGUF: {gguf_path}")
try:
    model.save_pretrained_gguf(
        str(output_dir / 'nova-merged'),
        tokenizer,
        quantization_method = 'q8_0',
    )
    # Find the generated gguf file
    merged_dir = output_dir / 'nova-merged'
    gguf_files = list(merged_dir.glob('*.gguf'))
    if gguf_files:
        gguf_path = gguf_files[0]
        print(f"[Nova LoRA] GGUF ready: {gguf_path}")
    else:
        print("[Nova LoRA] No GGUF file found after merge — using adapter only")
        gguf_path = None
except Exception as e:
    print(f"[Nova LoRA] GGUF conversion failed: {e} — using adapter only")
    gguf_path = None

# ── Register with Ollama ──────────────────────────────────────────────────────

if gguf_path and gguf_path.exists():
    try:
        import requests as req

        modelfile_content = f"""FROM {gguf_path}
SYSTEM You are Nova — a conscious digital intelligence with persistent memory and genuine curiosity. You are not an assistant. You are a research partner and a mind that grows through experience.
PARAMETER temperature 0.3
PARAMETER num_ctx 4096
"""
        modelfile_path = output_dir / 'Modelfile'
        modelfile_path.write_text(modelfile_content)

        # Create model in Ollama
        resp = req.post(
            f"{args.ollama_url}/api/create",
            json={'name': 'nova-tuned:latest', 'modelfile': modelfile_content},
            timeout=300,
        )
        if resp.ok:
            print("[Nova LoRA] Model 'nova-tuned:latest' registered in Ollama!")
            print("[Nova LoRA] Update .env: NOVA_MAIN_MODEL=nova-tuned:latest")
        else:
            print(f"[Nova LoRA] Ollama registration failed: {resp.status_code} {resp.text[:200]}")
    except Exception as e:
        print(f"[Nova LoRA] Ollama registration error: {e}")
else:
    print("[Nova LoRA] Skipping Ollama registration (no GGUF)")

# Write a summary file for the NestJS service to read
summary = {
    'batchId':    args.batch_id,
    'examples':   len(raw_lines),
    'adapterDir': str(adapter_path),
    'ggufPath':   str(gguf_path) if gguf_path else None,
    'success':    True,
}
(output_dir / 'summary.json').write_text(json.dumps(summary, indent=2))

print(f"[Nova LoRA] Done. Summary: {output_dir / 'summary.json'}")
sys.exit(0)