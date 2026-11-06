# pictures-heal — the clock of pictures-scan, which announces every photo and video whose picture
# vectors are missing or were made by another model than EMS embeds with now: a crawl a crash
# interrupted, a file read while EMS embedded no pictures, a new model. The scan is one query per
# kind over every tree, and announces nothing while picture work waits, so an hour between passes
# costs nothing and leaves nothing waiting long.
echo pictures-heal: starting
while true; do
  pictures-scan --if-idle --limit 0
  sleep 3600
done
