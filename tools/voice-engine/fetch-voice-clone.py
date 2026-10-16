"""Install the pinned fixed-speaker model; generation itself remains offline."""
import argparse,os
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--cache',required=True)
args=parser.parse_args()
import truststore
truststore.inject_into_ssl()
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from huggingface_hub import HfApi,hf_hub_download
revision='fd4b254389122332181a7c3db7f27e918eec64e3'
cache=Path(args.cache).resolve()
target=cache/'models--Qwen--Qwen3-TTS-12Hz-1.7B-Base'/'snapshots'/revision
# local_dir avoids Windows symlink privilege races in concurrent hub caching.
repo='Qwen/Qwen3-TTS-12Hz-1.7B-Base'
info=HfApi().model_info(repo,revision=revision,files_metadata=True)
for file in info.siblings:
    path=(target/file.rfilename).resolve()
    if not path.is_relative_to(target):raise ValueError('Invalid model path')
    if path.is_file() and path.stat().st_size==file.size:continue
    hf_hub_download(repo,file.rfilename,revision=revision,cache_dir=str(cache/'_downloads'),local_dir=str(target))
print('Fixed-speaker model downloaded. Normal synthesis uses local files only.')
