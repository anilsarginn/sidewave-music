FROM python:3.12-slim

# beets: muzik dosyalarini MusicBrainz'e karsi tanir, etiketler, kutuphaneye tasir.
# Pillow sadece kapak gorseli isleme icin gerekli (fetchart plugin).
# DIKKAT: beets 2.x'te MusicBrainz ayri bir eklenti ve musicbrainzngs
# varsayilan kurulumda GELMEZ. Kurulmazsa beets hicbir zaman aday bulamaz,
# her dosyayi sessizce atlar — teshis edilmesi zor bir sessiz basarisizlik.
RUN pip install --no-cache-dir beets musicbrainzngs requests pillow \
    && rm -rf /root/.cache

ENV BEETSDIR=/config

COPY watch.sh /usr/local/bin/watch.sh
RUN chmod +x /usr/local/bin/watch.sh

CMD ["/usr/local/bin/watch.sh"]
