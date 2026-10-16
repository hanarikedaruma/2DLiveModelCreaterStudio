# SPDX-License-Identifier: GPL-3.0-or-later
"""Small, deterministic spoken restarts for the explicitly selected shy performance.

No extra model, network, audio slicing, or changes to the original text/history.
Uncertain kanji/name readings use a hesitation instead of a guessed syllable.
"""
import re,unicodedata
from dataclasses import dataclass

# Only repeat readings unambiguous in these expressions. Other words stay intact.
SALIENT=re.compile('大好き|好き|大切|大事|本当|ありがとう|ごめん|嬉し|うれし|会いたい|伝えたい')
ONSET={'大好き':'だ','好き':'す','大切':'た','大事':'だ','本当':'ほ','ありがとう':'あ',
       'ごめん':'ご','嬉し':'う','うれし':'う','会いたい':'あ','伝えたい':'つ'}
SMALL='ゃゅょぁぃぅぇぉゎ'

@dataclass(frozen=True)
class Performance:
    text:str
    hesitations:int=0

def first_mora(text):
    text=unicodedata.normalize('NFKC',text[:4])
    text=''.join(chr(ord(c)-0x60) if 'ァ'<=c<='ヶ' else c for c in text)
    if not text or not 'ぁ'<=text[0]<='ゖ' or text[0] in SMALL+'っんゕゖ':return ''
    return text[:2] if len(text)>1 and text[1] in SMALL else text[0]

def prepare_performance(text,style):
    if style!='shy':return Performance(text)
    start=len(text)-len(text.lstrip(' \t\r\n「『（(【“"'))
    if start>=len(text):return Performance(text)
    inserts=[];tail=text[start:]
    explicit=re.match(r'(?:[ぁ-ゖァ-ヺ]{1,2}(?:[、,…]|[.・]{2,})|[あぁいぃうぅえぇおぉアァイィウゥエェオォ][っッ]?。|あの[、… ]|えっと[、… ]|その[、… ]|[…、])',tail)
    if not explicit:
        mora=first_mora(tail)
        if not mora:
            anchor=SALIENT.match(tail)
            mora=ONSET[anchor.group()] if anchor else ''
        # A quiet hesitation avoids inventing a reading for a person's name,
        # a date or an ambiguous first kanji (e.g. 今日).
        inserts.append((start,mora+'、' if mora else 'あ……'))
    for anchor in SALIENT.finditer(text):
        position=anchor.start()
        if position<start+3:continue
        mora=ONSET[anchor.group()]
        if re.search(re.escape(mora)+r'っ?[、,…\s.・]+$',text[max(start,position-6):position]):continue
        inserts.append((position,'…'+mora+'、'));break
    spoken=text
    for position,value in reversed(inserts):spoken=spoken[:position]+value+spoken[position:]
    # Qwen can collapse 'う、うん' into one vowel or drop the second word.
    # Catch the existing introductory attempt and mark a stronger boundary;
    # this is not another filler, and the body/source/history stay intact.
    spoken=re.sub(r'^([\s「『（(【“"]*[うぅウゥ])[っッ]?[、,][ \t]*(?=[うぅウゥ])',r'\1っ。',spoken)
    # Other vowel restarts need only performance whitespace.
    spoken=re.sub(r'^([\s「『（(【“"]*[いぃうぅえぇおぉイィウゥエェオォ][っッ]?[、,])(?=\S)',r'\1 ',spoken)
    return Performance(spoken,len(inserts))
