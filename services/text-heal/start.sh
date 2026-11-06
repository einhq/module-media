# text-heal — the clock of text-scan, which announces every file whose text was never read, whose
# reading or transcript is not what EMS makes now, or whose text vectors are missing or another
# model's: a crawl a crash interrupted, a write while nothing listened, a new model or new decode
# settings. The scan is a few queries over every tree, and holds back each fact whose work waits,
# so an hour between passes costs nothing and leaves nothing waiting long.
#
# The hour comes first: the service starts with the module, and a pass before the module's
# pipelines are set up would match the facts it announces against the definitions they replace.
echo text-heal: starting
while true; do
  sleep 3600
  text-scan --if-idle --limit 0
done
