# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded header + raw PCM packets on the private worker pipe."""
import json
import os
import numpy as np

MAX_HEADER=8192
MAX_FRAMES=24000

def command_lines(pipe,closed):
    """Never hold the Windows CRT stdin lock while native extensions load."""
    fd=pipe.fileno();pending=bytearray()
    if os.name=='nt':
        import ctypes,msvcrt
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        peek=kernel.PeekNamedPipe
        peek.argtypes=(wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p,ctypes.POINTER(wintypes.DWORD),ctypes.c_void_p)
        peek.restype=wintypes.BOOL;handle=msvcrt.get_osfhandle(fd)
    while not closed.is_set():
        if os.name=='nt':
            available=wintypes.DWORD()
            if not peek(handle,None,0,None,ctypes.byref(available),None):
                if ctypes.get_last_error() in (109,232):return
                raise ctypes.WinError(ctypes.get_last_error())
            count=min(4096,available.value)
            if not count:closed.wait(.01);continue
        else:
            import select
            if not select.select([fd],[],[],.05)[0]:continue
            count=4096
        raw=os.read(fd,count)
        if not raw:return
        pending.extend(raw)
        while b'\n' in pending:
            line,_,remaining=pending.partition(b'\n');pending=bytearray(remaining)
            if len(line)>MAX_HEADER:raise ValueError('読み上げ要求が大きすぎます')
            yield bytes(line)
        if len(pending)>MAX_HEADER:raise ValueError('読み上げ要求が大きすぎます')

def write_packet(pipe,value,audio=None):
    if audio is not None:
        audio=np.ascontiguousarray(audio,dtype='<f4')
        if audio.ndim!=1 or not 0<len(audio)<=MAX_FRAMES or not np.isfinite(audio).all():
            raise ValueError('逐次音声の長さ・値が不正です')
        value={**value,'frames':len(audio),'byteLength':audio.nbytes}
    header=(json.dumps(value,ensure_ascii=False,allow_nan=False)+'\n').encode('utf-8')
    if len(header)>MAX_HEADER:raise ValueError('音声応答が大きすぎます')
    for payload in (header, audio.tobytes() if audio is not None else b''):
        view=memoryview(payload)
        while view:
            n=pipe.write(view)
            if not n:raise EOFError('音声パイプが終了しました')
            view=view[n:]
    pipe.flush()

def read_packet(pipe):
    line=pipe.readline(MAX_HEADER+1)
    if not line or len(line)>MAX_HEADER or not line.endswith(b'\n'):raise EOFError('音声応答が終了・破損しています')
    value=json.loads(line.decode('utf-8'))
    if not isinstance(value,dict):raise ValueError('音声応答が不正です')
    audio=None
    if value.get('event')=='pcm':
        frames=value.get('frames');size=value.get('byteLength')
        if type(frames) is not int or not 0<frames<=MAX_FRAMES or type(size) is not int or size!=frames*4:
            raise ValueError('逐次音声の長さが不正です')
        raw=bytearray()
        while len(raw)<size:
            part=pipe.read(size-len(raw))
            if not part:raise EOFError('逐次音声が途中で終了しました')
            raw.extend(part)
        audio=np.frombuffer(raw,dtype='<f4').copy()
        if not np.isfinite(audio).all():raise ValueError('逐次音声に不正な値があります')
    return value,audio
