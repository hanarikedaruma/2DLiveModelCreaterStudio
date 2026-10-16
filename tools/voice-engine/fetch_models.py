"""Download official pinned assets for local inference, without loading CUDA."""
import argparse
import hashlib
import json
import os
from pathlib import Path

def verify(root):
    root=Path(root).resolve()
    source=root/"external"/"seed-vc"
    cache=root/"external"/"quality-models"
    manifest=json.loads((cache/"assets.json").read_text(encoding="utf-8"))
    checked=0
    for item in manifest["assets"]:
        directory=source/"checkpoints" if item["repo"] in ("Plachta/Seed-VC","funasr/campplus") else cache/"hub"
        hub=directory/("models--"+item["repo"].replace("/","--"))
        if (hub/"refs"/"main").read_text().strip()!=item["revision"]:
            raise ValueError("Model revision mismatch: "+item["repo"])
        for entry in item["files"]:
            path=hub/"snapshots"/item["revision"]/entry["name"]
            if path.stat().st_size!=entry["bytes"]:raise ValueError("Model file size mismatch: "+entry["name"])
            digest=hashlib.sha256()
            with path.open("rb") as handle:
                while chunk:=handle.read(8*1024*1024):digest.update(chunk)
            if digest.hexdigest()!=entry["sha256"]:raise ValueError("Model checksum mismatch: "+entry["name"])
            checked+=1
    print(f"Verified {checked} inference assets",flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--verify",action="store_true")
    args = parser.parse_args()
    if args.verify:verify(args.root);return
    import truststore
    truststore.inject_into_ssl()
    root=Path(args.root).resolve()
    source=root/"external"/"seed-vc"
    cache=root/"external"/"quality-models"
    os.environ["HF_HOME"]=str(cache)
    os.environ["HF_HUB_DISABLE_TELEMETRY"]="1"
    from huggingface_hub import HfApi,hf_hub_download
    api=HfApi()
    assets=[]
    files={"Plachta/Seed-VC":["DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth",
                              "config_dit_mel_seed_uvit_whisper_small_wavenet.yml"],
           "funasr/campplus":["campplus_cn_common.bin"],
           "nvidia/bigvgan_v2_22khz_80band_256x":["config.json","bigvgan_generator.pt"],
           "openai/whisper-small":["config.json","preprocessor_config.json","model.safetensors"]}
    revisions={"Plachta/Seed-VC":"257283f9f41585055e8f858fba4fd044e5caed6e",
               "funasr/campplus":"e4b6ede7ce16997aff4ae69fbca1f0175e2afede",
               "nvidia/bigvgan_v2_22khz_80band_256x":"633ff708ed5b74903e86ff1298cf4a98e921c513",
               "openai/whisper-small":"973afd24965f72e36ca33b3055d56a652f456b4d"}
    for repo,names in files.items():
        info=api.model_info(repo,revision=revisions[repo])
        directory=source/"checkpoints" if repo in ("Plachta/Seed-VC","funasr/campplus") else cache/"hub"
        item={"repo":repo,"revision":info.sha,"license":info.cardData.get("license") if info.cardData else None,"files":[]}
        for name in names:
            print(f"Download {repo} / {name}",flush=True)
            path=hf_hub_download(repo,name,revision=info.sha,cache_dir=str(directory))
            # Resolve the verified upstream main to the exact downloaded revision.
            ref=directory/("models--"+repo.replace("/","--"))/"refs"/"main"
            ref.parent.mkdir(parents=True,exist_ok=True)
            ref.write_text(info.sha,encoding="utf-8")
            digest=hashlib.sha256()
            with open(path,"rb") as handle:
                while chunk:=handle.read(8*1024*1024): digest.update(chunk)
            item["files"].append({"name":name,"sha256":digest.hexdigest(),"bytes":Path(path).stat().st_size})
        assets.append(item)
    (cache/"assets.json").write_text(json.dumps({"sourceRevision":"51383efd921027683c89e5348211d93ff12ac2a8",
        "assets":assets},ensure_ascii=False,indent=2),encoding="utf-8")
    verify(root)
    print("All inference assets ready",flush=True)

if __name__=="__main__": main()
