# renditions-heal — the clock of renditions-scan, which announces every file whose renditions are
# missing or were made by another rendition table: a crawl a crash interrupted, a table that was
# edited. The scan is one query per kind over every tree, and announces nothing while rendition
# work waits, so an hour between passes costs nothing and leaves nothing waiting long.
echo renditions-heal: starting
while true; do
  renditions-scan --if-idle --limit 0
  sleep 3600
done
