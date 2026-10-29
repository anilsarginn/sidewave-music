"""Bounded PCM-to-MusiCNN service. No URLs, downloads, archive or DB access.

Uses the pinned AudioMuse image's MusiCNN ONNX model. Patch parameters match
AudioMuse's 16 kHz / 96 mel / 187-frame analysis. This pipeline has its OWN
version and index: excerpt embeddings are never mixed with full-track indices.
"""
import os
os.environ.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', NUMBA_NUM_THREADS='1')
import hashlib
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
import librosa
import onnxruntime as ort
MODEL = '/app/model/musicnn_embedding.onnx'
with open(MODEL,'rb') as f:
    VERSION = 'musicnn-excerpt-v1:' + hashlib.sha256(f.read()).hexdigest()
options = ort.SessionOptions()
options.intra_op_num_threads = 1
options.inter_op_num_threads = 1
session = ort.InferenceSession(MODEL, sess_options=options, providers=['CPUExecutionProvider'])

def embedding(pcm):
    if len(pcm) % 2 or not 16000*2*9 <= len(pcm) <= 16000*2*46:
        raise ValueError('invalid excerpt')
    audio = np.frombuffer(pcm,dtype='<i2').astype(np.float32) / 32768
    if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 0.0001:
        raise ValueError('silent excerpt')
    mel = librosa.feature.melspectrogram(y=audio,sr=16000,n_fft=512,hop_length=256,n_mels=96,center=False,norm='slaney',htk=False)
    spec = np.log10(1 + 10000 * np.maximum(mel,0))
    vectors=[]
    for offset in range(0,spec.shape[1]-186,187):
        patch = spec[:,offset:offset+187].T.astype(np.float32)[None,:,:]
        vectors.append(session.run(None,{session.get_inputs()[0].name:patch})[0][0])
    vec = np.mean(vectors,axis=0)
    norm = np.linalg.norm(vec)
    if not np.isfinite(vec).all() or norm < 1e-9:
        raise ValueError('invalid vector')
    return {'model':VERSION,'vector':(vec/norm).tolist(),'seconds':len(audio)/16000}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,status,value):
        body=json.dumps(value).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        self.reply(200 if self.path=='/health' else 404,{'model':VERSION,'ok':self.path=='/health'})
    def do_POST(self):
        if self.path!='/embedding':return self.reply(404,{'code':'NOT_FOUND'})
        try:
            self.connection.settimeout(10)
            size=int(self.headers.get('Content-Length','0'))
            if size<1 or size>16000*2*46:return self.reply(413,{'code':'INVALID_AUDIO'})
            pcm=self.rfile.read(size)
            self.reply(200,embedding(pcm))
        except Exception:
            self.reply(422,{'code':'ANALYSIS_FAILED'})

if __name__=='__main__':
    HTTPServer(('0.0.0.0',4460),Handler).serve_forever()
