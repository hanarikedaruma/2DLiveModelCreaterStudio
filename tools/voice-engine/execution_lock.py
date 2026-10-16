"""Windows named mutex, shared with the native legacy audio application."""
import ctypes
from ctypes import wintypes

class ExecutionLock:
    def __init__(self,name):
        self.kernel=ctypes.WinDLL("kernel32",use_last_error=True)
        self.kernel.CreateMutexW.argtypes=(ctypes.c_void_p,wintypes.BOOL,wintypes.LPCWSTR)
        self.kernel.CreateMutexW.restype=wintypes.HANDLE
        self.kernel.WaitForSingleObject.argtypes=(wintypes.HANDLE,wintypes.DWORD)
        self.kernel.WaitForSingleObject.restype=wintypes.DWORD
        self.kernel.ReleaseMutex.argtypes=(wintypes.HANDLE,)
        self.kernel.CloseHandle.argtypes=(wintypes.HANDLE,)
        self.handle=self.kernel.CreateMutexW(None,False,name)
        self.owned=False
        if not self.handle:raise ctypes.WinError(ctypes.get_last_error())
    def __enter__(self):
        result=self.kernel.WaitForSingleObject(self.handle,0)
        if result not in (0,0x80):
            self.kernel.CloseHandle(self.handle);self.handle=None
            raise RuntimeError("別のVoiceChangerが実行中です。先に音声・変換処理を停止してください")
        self.owned=True
        return self
    def __exit__(self,*_):
        if self.owned:self.kernel.ReleaseMutex(self.handle)
        if self.handle:self.kernel.CloseHandle(self.handle)
        self.handle=None
