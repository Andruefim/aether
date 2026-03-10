# Create venv for LoRA training (separate from sandbox)
python3 -m venv nova-lora/venv
source nova-lora/venv/bin/activate

# AMD ROCm (RX 9070)
pip install torch==2.8.0 pytorch-triton-rocm torchao==0.13.0 \
  --index-url https://download.pytorch.org/whl/rocm6.4
pip install --no-deps unsloth unsloth-zoo
pip install "unsloth[amd] @ git+https://github.com/unslothai/unsloth"
pip install trl datasets transformers accelerate requests

