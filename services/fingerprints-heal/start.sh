# fingerprints-heal — the clock of fingerprints-scan, which announces every picture, video and
# recording without `fingerprintedAt`: a crawl a crash interrupted, a print EMS could not make then.
# The scan is one query per kind over every tree, and announces nothing while fingerprint work
# waits, so an hour between passes costs nothing and leaves nothing waiting long.
echo fingerprints-heal: starting
while true; do
  fingerprints-scan --if-idle --limit 0
  sleep 3600
done
