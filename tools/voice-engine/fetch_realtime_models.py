"""Pinned official Seed Tiny / XLSR / HiFT assets; downloads never receive audio."""
import argparse,hashlib,json,os
from pathlib import Path

FILES={
    "Plachta/Seed-VC":("257283f9f41585055e8f858fba4fd044e5caed6e",["DiT_uvit_tat_xlsr_ema.pth","config_dit_mel_seed_uvit_xlsr_tiny.yml"]),
    "funasr/campplus":("e4b6ede7ce16997aff4ae69fbca1f0175e2afede",["campplus_cn_common.bin"]),
    "FunAudioLLM/CosyVoice-300M":("24c40509c3c5ea6fe06b5f8790ff99e3714a6bee",["hift.pt"]),
    "facebook/wav2vec2-xls-r-300m":("1a640f32ac3e39899438a2931f9924c02f080a54",["config.json","preprocessor_config.json","pytorch_model.bin"]),
}
def digest(path):
    result=hashlib.sha256()
    with path.open("rb") as handle:
        while chunk:=handle.read(8*1024*1024):result.update(chunk)
    return result.hexdigest()

def verify(root):
    cache=root/"external"/"realtime-models"
    manifest=json.loads((cache/"assets.json").read_text(encoding="utf-8"))
    count=0
    for asset in manifest["assets"]:
        directory=cache/"hub" if asset["repo"].startswith("facebook/") else root/"external"/"seed-vc"/"checkpoints"
        for item in asset["files"]:
            path=directory/("models--"+asset["repo"].replace("/","--"))/"snapshots"/asset["revision"]/item["name"]
            if path.stat().st_size!=item["bytes"] or digest(path)!=item["sha256"]:raise ValueError("Realtime model checksum mismatch: "+item["name"])
            count+=1
    print(f"Verified {count} realtime inference assets",flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--root",required=True);parser.add_argument("--verify",action="store_true")
    args=parser.parse_args();root=Path(args.root).resolve()
    if args.verify:verify(root);return
    import truststore
    truststore.inject_into_ssl()
    cache=root/"external"/"realtime-models";cache.mkdir(parents=True,exist_ok=True)
    os.environ["HF_HOME"]=str(cache);os.environ["HF_HUB_DISABLE_TELEMETRY"]="1"
    from huggingface_hub import HfApi,hf_hub_download
    api=HfApi();assets=[]
    for repo,(revision,names) in FILES.items():
        info=api.model_info(repo,revision=revision,files_metadata=True)
        directory=cache/"hub" if repo.startswith("facebook/") else root/"external"/"seed-vc"/"checkpoints"
        asset={"repo":repo,"revision":revision,"license":info.cardData.get("license") if info.cardData else None,"files":[]}
        for name in names:
            print("Download",repo,name,flush=True)
            path=Path(hf_hub_download(repo,name,revision=revision,cache_dir=str(directory)))
            hash_value=digest(path)
            entry=next(item for item in info.siblings if item.rfilename==name)
            if entry.lfs and entry.lfs.sha256!=hash_value:raise ValueError("Official model checksum mismatch")
            ref=directory/("models--"+repo.replace("/","--"))/"refs"/"main";ref.parent.mkdir(parents=True,exist_ok=True);ref.write_text(revision,encoding="utf-8")
            asset["files"].append({"name":name,"bytes":path.stat().st_size,"sha256":hash_value})
        assets.append(asset)
    (cache/"assets.json").write_text(json.dumps({"sourceRevision":"51383efd921027683c89e5348211d93ff12ac2a8","assets":assets},indent=2),encoding="utf-8")
    verify(root)

if __name__=="__main__":main()
