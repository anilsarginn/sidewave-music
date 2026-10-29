#!/bin/sh
# beets-watch — downloads/ klasorunu izler, yeni muzik gelince kutuphaneye tasir.
# Bos donguyu bilerek atlar: dosya yoksa MusicBrainz'e hic dokunmaz.
set -u

INTERVAL="${IMPORT_INTERVAL:-300}"
SOURCE="${IMPORT_SOURCE:-/music/downloads}"
ELAPSED="$INTERVAL"

echo "[beets-watch] baslatildi | kaynak=$SOURCE | aralik=${INTERVAL}sn"

while true; do
    if [ "$ELAPSED" -lt "$INTERVAL" ] && [ ! -f /jobs/import.request ]; then
        sleep 5
        ELAPSED=$((ELAPSED + 5))
        continue
    fi
    ELAPSED=0
    # Yarim inen dosyalari kacirmamak icin: son 60 sn icinde degismis dosya varsa bekle
    if find "$SOURCE" -mindepth 1 -type f -newermt "-60 seconds" 2>/dev/null | grep -q .; then
        echo "[beets-watch] indirme hala suruyor gibi, bu tur atlaniyor"
    elif find "$SOURCE" -mindepth 1 -type f 2>/dev/null | grep -q .; then
        rm -f /jobs/import.request
        echo "[beets-watch] yeni dosya(lar) bulundu, import basliyor"

        # 1. gecis: albüm olarak esle (tam albüm indirildiyse en dogru sonuc)
        beet import -q "$SOURCE" 2>&1 || echo "[beets-watch] albüm gecisi hata dondurdu"

        # 2. gecis: albüm olarak eslesemeyen tek parcalari singleton olarak al.
        # Albümün 1-2 parcasini indirdiginde 1. gecis eslestiremez, burasi yakalar.
        if find "$SOURCE" -mindepth 1 -type f 2>/dev/null | grep -q .; then
            echo "[beets-watch] kalan dosyalar tek parca olarak deneniyor"
            beet import -q -s "$SOURCE" 2>&1 || echo "[beets-watch] tek parca gecisi hata dondurdu"
        fi

        # tasima sonrasi geride kalan bos klasorleri temizle
        find "$SOURCE" -mindepth 1 -type d -empty -delete 2>/dev/null

        KALAN=$(find "$SOURCE" -mindepth 1 -type f 2>/dev/null | wc -l)
        echo "[beets-watch] tur bitti | downloads/ta kalan: $KALAN dosya"
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
done
