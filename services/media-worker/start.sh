# Admits the media pool's work that is not a model request, against one budget of `cpu` slots.
#
# The engine puts these steps in /var/pools/media instead of running them inline, so a crawl cannot
# start hundreds at once. The kinds are the modules': each names its own in a drop-in,
# `/etc/media-worker.d/<module>/kinds`, which `media-pool-kinds cpu` reads. A kind no worker takes
# never runs at all, since the pool has nobody to claim it, and the dashboard shows it as having
# no worker. The drop-ins are read as the worker starts: until one names a kind, it waits for one,
# and `mod install` restarts it once it has put in place a module whose kinds are new or changed
# (`dropIns` in mod.json).
#
# CFG_CPU_SLOTS is the budget and each step's `requires` what a job takes of it, so one transcode
# excludes a concurrent face assignment on a small box while two assignments share it;
# CFG_CPU_WORKERS only caps how many are in flight. CFG_CPU_NON_ENTRY_SLOTS is a soft reservation
# inside the budget for the kinds a drop-in marks `reserve`, the work after ingest: ingest keeps
# normal priority over the unreserved share, admitted downstream work gets first choice of the
# reserved tail, and ingest borrows it whenever none of that can run. When it is a two-slot job's
# turn and only one slot is free, the worker holds that slot and admits nothing else until a second
# frees, or a two-slot job would wait forever behind one-slot kinds.
#
# The pool path comes from POOLS_PATH, which boot exports into /etc/bashrc and this service
# sources; a literal path would name an empty pool nothing writes to (ein/core#210).
#
# Every other instance of the media service (`ems-instance`) gets a worker of its own beside this
# one, with the kinds that call EMS (`ops=`) whose ops it serves (`media-pool-kinds --instance`),
# its own budget of slots, and steps that call it (CFG_EMS_INSTANCE). A job it cannot do goes
# straight back for the others (--pass-on). Its worker stops when it stops answering or its kinds
# change, and starts again once it answers with kinds to take. The service starts over when an
# instance is added or removed, and when a worker ends.
echo media-worker: starting

others=$(ems-instance list --others --names 2>/dev/null)

instance_worker() {
  local instance_kinds slots
  while true; do
    instance_kinds=$(media-pool-kinds cpu --instance "$1" 2>/dev/null)
    if [ -n "$instance_kinds" ]; then
      slots=$(ems-instance show "$1" cpuSlots 2>/dev/null)
      echo "media-worker: $1 takes $instance_kinds"
      pipeline-worker --pool "${POOLS_PATH:-/var/pools}/media" --name "media-worker@$1" \
        --capacity cpu="${slots:-2}" \
        $instance_kinds \
        --concurrency "${slots:-2}" \
        --env CFG_EMS_INSTANCE="$1" --pass-on \
        --while "media-pool-kinds cpu --instance $1 --expect='$instance_kinds'"
    fi
    sleep 30
  done
}

instances_unchanged() {
  while [ "$(ems-instance list --others --names 2>/dev/null)" = "$others" ]; do
    sleep 60
  done
  echo "media-worker: the media service's instances changed, starting over"
}

kinds=$(media-pool-kinds cpu)
if [ -z "$kinds" ]; then
  echo "media-worker: no module names work for it yet, waiting for a drop-in in /etc/media-worker.d"
fi
while [ -z "$kinds" ]; do
  sleep 30
  kinds=$(media-pool-kinds cpu)
done

pipeline-worker --pool "${POOLS_PATH:-/var/pools}/media" \
  --capacity cpu="${CFG_CPU_SLOTS:-2}" \
  $kinds \
  --reserve-capacity cpu="${CFG_CPU_NON_ENTRY_SLOTS:-1}" \
  --concurrency "${CFG_CPU_WORKERS:-4}" &
for name in $others; do
  instance_worker "$name" &
done
instances_unchanged &
wait -n
exit 1
