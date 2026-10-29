FROM ghcr.io/neptunehub/audiomuse-ai@sha256:43506382e093cb607bffa5ca96de50adf0ee10a96fa6187f07dbef80322119a2
COPY worker.py /online/worker.py
ENV NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /online
ENTRYPOINT ["python3", "/online/worker.py"]
