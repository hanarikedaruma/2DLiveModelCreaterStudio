"""Actual worker framing/composer with identity inference, without GPU or devices."""
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import worker

class IdentityModel:
    sr=48000
    def __init__(self,profile):self.profile=profile
    def convert(self,x):return x.copy(),{"processingMs":0.,"vramMiB":0.}

worker.create_model=lambda profile,**_:IdentityModel(profile)
worker.main()
