"""Optional reference preparation; no user recording is sent to a service."""
import argparse,os
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument("--cache",required=True)
args=parser.parse_args()
import truststore
truststore.inject_into_ssl()
os.environ["HF_HOME"]=str(Path(args.cache).resolve())
os.environ["HF_HUB_DISABLE_TELEMETRY"]="1"
from huggingface_hub import snapshot_download
snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",revision="5ecdb67327fd37bb2e042aab12ff7391903235d3")
print("VoiceDesign model downloaded; normal voice creation uses the local cache.")
