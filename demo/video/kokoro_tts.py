"""Speak text with Kokoro (an open, local neural text-to-speech model) and write a WAV file.

    python kokoro_tts.py <models-dir> <voice> <speed> <out.wav>   (the text arrives on stdin)

Used by voiceover.ts. The model and voices are the kokoro-onnx release files (kokoro-v1.0.int8.onnx and
voices-v1.0.bin) in <models-dir>; setup is in docs/DEMO_AND_HELP.md, "Overview videos". Nothing leaves the machine.
"""
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

models_dir, voice, speed, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
text = sys.stdin.read().strip()

kokoro = Kokoro(os.path.join(models_dir, "kokoro-v1.0.int8.onnx"), os.path.join(models_dir, "voices-v1.0.bin"))
samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
sf.write(out, samples, sample_rate)
