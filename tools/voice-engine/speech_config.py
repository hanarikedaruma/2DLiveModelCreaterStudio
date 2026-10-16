# SPDX-License-Identifier: GPL-3.0-or-later
"""Data-only speech requests and context instructions, shared across runtimes."""
import json
from pathlib import Path

MODEL_ID="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
MODEL_REVISION="5ecdb67327fd37bb2e042aab12ff7391903235d3"
CLONE_MODEL_ID='Qwen/Qwen3-TTS-12Hz-1.7B-Base'
CLONE_MODEL_REVISION='fd4b254389122332181a7c3db7f27e918eec64e3'
DEFAULT_VOICE="自然な日本語を話す若い成人女性。柔らかく、可愛らしく、あたたかい声。軽く明るい響き。極端な高音や鼻声を避け、子音は明瞭に、日常会話らしく自然に話す。"
STYLES={
    "auto":("文脈に合わせる","Adapt emotion, emphasis, intonation and pauses naturally to the meaning of the current text and conversational context. For heartfelt or important words, use steady, supported, gently resonant delivery and slightly more deliberate articulation at conversational volume. At a topic transition, use a brief natural pause and a clear onset. Keep the reference speaker's timbre and habitual vocal register; do not force a deeper pitch or shout. Avoid exaggerated acting."),
    "cheerful":("明るく嬉しそうに","Speak cheerfully and warmly, with a smile and lively but natural intonation."),
    "shy":("恥ずかしい","Speak with warm embarrassment and shy affection, hesitant but intelligible. Perform the written short restarts as tentative attempts, with small hesitant pauses and a gentle, slightly restrained onset. Keep the reference speaker's timbre and habitual register at conversational volume. Do not force a lower pitch, a whisper or a different age. Do not add extra fillers, words or sentences beyond the supplied performance text."),
    "gentle":("落ち着いて優しく","Speak gently, reassuringly and calmly, with soft natural intonation."),
    "sad":("寂しさ・戸惑い","Speak with restrained sadness or hesitation, softly and naturally."),
    "surprised":("驚き","Speak with natural surprise, using expressive but not exaggerated intonation."),
    "whisper":("ささやくように","Speak in a soft intimate whisper, keeping the words intelligible."),
}

def bounded_text(value,label,maximum,minimum=0):
    if not isinstance(value,str) or not minimum<=len(value.strip())<=maximum:raise ValueError(f"{label}は{minimum}〜{maximum}文字にしてください")
    if any(ord(ch)<32 and ch not in "\n\t\r" for ch in value):raise ValueError(f"{label}に使用できない文字があります")
    return value.strip()

def validate_preferences(value=None):
    if value is None:value={}
    if not isinstance(value,dict):raise ValueError("読み上げ設定が不正です")
    style=value.get("style","auto")
    if not isinstance(style,str) or style not in STYLES:raise ValueError("未対応の読み方です")
    result={"voice":bounded_text(value.get("voice",DEFAULT_VOICE),"声の説明",2000,5),
        "scene":bounded_text(value.get("scene",""),"場面・話し方",500),"style":style}
    for key in ("useContext","applyFilters"):
        flag=value.get(key,True)
        if not isinstance(flag,bool):raise ValueError("読み上げの設定が不正です")
        result[key]=flag
    delivery=value.get("delivery","whole")
    if delivery not in ("whole","stream"):raise ValueError("未対応の再生方式です")
    result["delivery"]=delivery
    return result

def validate_request(value):
    if not isinstance(value,dict) or value.get("schemaVersion")!=1:raise ValueError("未対応の読み上げデータです")
    text=bounded_text(value.get("text"),"読み上げる文章",300,1)
    preferences=validate_preferences(value.get("preferences"))
    history=value.get("history",[])
    if not isinstance(history,list) or len(history)>3:raise ValueError("会話の文脈が長すぎます")
    history=[bounded_text(item,"直前の文章",300,1) for item in history]
    seed=value.get("seed",31415)
    if isinstance(seed,bool) or not isinstance(seed,int) or not 0<=seed<2**32:raise ValueError("読み上げのseedが不正です")
    result={"schemaVersion":1,"text":text,"preferences":preferences,
            "history":history if preferences["useContext"] else [],"seed":seed}
    if 'speaker' in value:
        speaker=value['speaker']
        if not isinstance(speaker,dict):raise ValueError('話者の指定が不正です')
        result['speaker']={'reference':bounded_text(speaker.get('reference'),'話者の参照音声',4096,1)}
        if 'sha256' in speaker:
            digest=speaker['sha256']
            if not isinstance(digest,str) or len(digest)!=64 or any(ch not in '0123456789abcdef' for ch in digest):raise ValueError('話者の識別子が不正です')
            result['speaker']['sha256']=digest
    return result

def build_instruction(request):
    request=validate_request(request);p=request["preferences"]
    parts=[p["voice"],"Speak fluent natural Japanese. Read only the current text supplied separately. Preserve its words; do not invent a reply or read the instructions. Use the whole utterance to plan phrasing, question intonation, emphasis and sentence-final pauses.",STYLES[p["style"]][1]]
    if p["scene"]:parts.append("Scene and delivery direction (not spoken): "+p["scene"])
    if request["history"]:
        parts.append("Earlier utterances, only as context for delivery. Do not repeat them: "+json.dumps(request["history"],ensure_ascii=False))
    return "\n".join(parts)

def build_delivery_instruction(request):
    # Identity comes only from the immutable reference prompt, never prose.
    lines=build_instruction(request).split('\n')
    voice=validate_request(request)['preferences']['voice']
    return '\n'.join(lines[len(voice.split('\n')):])

def voice_description(profile):
    reference=profile.get("reference")
    if reference:
        metadata=Path(reference).with_suffix(".json")
        try:
            if metadata.stat().st_size<=16000:
                value=json.loads(metadata.read_text(encoding="utf-8-sig"))
                if isinstance(value,dict) and value.get("model")==MODEL_ID:return bounded_text(value.get("instruction"),"声の説明",2000,5)
        except (OSError,ValueError,TypeError):pass
    return DEFAULT_VOICE

def locate_runtime(profile):
    candidates=[]
    if profile.get("sourceRepo"):candidates.append(Path(profile["sourceRepo"]).resolve().parent.parent)
    candidates.extend(Path(__file__).resolve().parents)
    cache_candidates=[]
    try:
        config=json.loads(Path(__file__).with_name('runtime.json').read_text(encoding='utf-8-sig'))
        if config.get('speechCache'):cache_candidates.append(Path(config['speechCache']))
    except (OSError,ValueError):pass
    cache_candidates.extend(directory/'external'/'voice-design-models' for directory in candidates)
    python=None
    for directory in candidates:
        python=directory/".venv-voice-design"/"Scripts"/"python.exe"
        if python.is_file():break
    if python and python.is_file():
        for cache in cache_candidates:
            for hub in (cache,cache/'hub'):
                snapshot=hub/('models--'+CLONE_MODEL_ID.replace('/','--'))/'snapshots'/CLONE_MODEL_REVISION
                if (snapshot/'model.safetensors').is_file():return python,hub
    raise ValueError('話者固定用モデルの準備が必要です。tools/voice-engine/setup-speech.ps1 を実行してください')
