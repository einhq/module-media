# A second worker for the model-bound media steps, off unless CFG_MODEL_SECOND_SLOTS is above 0. It
# takes the same kinds as `models` (`media-pool-kinds models`) in the reverse order, so while the
# first worker is on one backlog this one is on another, and EMS runs a second model family beside
# the first. Size both workers' slots together against EMS's model limit, and mind its card: two
# families' models must fit there, or one runs on the CPU.
if [ "${CFG_MODEL_SECOND_SLOTS:-0}" -le 0 ]; then
  echo models-second: off, CFG_MODEL_SECOND_SLOTS is 0
  while true; do
    sleep 86400
  done
fi
echo models-second: starting

kinds=$(media-pool-kinds models --reverse)
while [ -z "$kinds" ]; do
  sleep 30
  kinds=$(media-pool-kinds models --reverse)
done

pipeline-worker --pool "${POOLS_PATH:-/var/pools}/media" \
  --capacity models="${CFG_MODEL_SECOND_SLOTS}" \
  $kinds \
  --kind-quantum "${CFG_MODEL_KIND_QUANTUM_MS:-3600000}" \
  --concurrency "${CFG_MODEL_SECOND_SLOTS}"
