# Owns admission of the model-bound media steps. The engine puts them in /pools/media instead of
# running them inline; this worker claims from it, and what it offers as `models` is how many
# model requests EiN keeps in flight against EMS at once.
#
# The card is EMS's: no GPU is passed to this container, and nothing here knows whether a request
# ran on the card or the CPU; EMS decides that and names a fallback in its health. The steps this
# worker runs are HTTP calls into EMS, which has its own admission (EMS_LIMIT_MODELS, a bounded
# queue, a reserve for interactive requests) and its own model residency and eviction. What this
# worker keeps is what EMS cannot decide for us:
#
#   - these calls are slow (a recording's transcription about a minute on the card, its voices
#     half that) and must not fill the engine's inline lane during a crawl;
#   - EMS chooses only among what it is sent, and answers `busy` past its depth, so EiN has to
#     bound what it sends and choose which of its backlogs gets to queue there. Keeping to one
#     kind is what keeps a model loaded and working: only this pool holds a kind's whole backlog.
#     Offering every kind at once instead, twelve in flight, took half as long again on fry, as
#     EMS then switched models every few requests (ein/core#1068).
#
# CFG_MODEL_SLOTS is that bound. Size it against EMS_LIMIT_MODELS on the EMS side: more slots than
# EMS runs at once only moves the wait from this pool to EMS's queue, and past its depth into
# `busy` failures and retries.
#
# The kinds are backlogs, not devices: the modules name theirs in drop-ins,
# `/etc/media-models.d/<module>/kinds`, which `media-pool-kinds models` reads. A kind is the unit
# the rotation below fairs between, and each step takes one slot. The drop-ins are read as the
# worker starts: until one names a kind, it waits for one, and `mod install` restarts it once it has
# put in place a module whose kinds are new or changed (`dropIns` in mod.json).
#
# Rotation is round-robin over the kind list rather than by priority, so a kind with little work
# drains and hands its slots straight on. --kind-quantum is the anti-starvation bound and nothing
# more: the first kind outranks the others and a crawl adds to it continuously, so "always take the
# highest priority" would starve the rest outright. A worker only crosses it after all commands of
# its current kind have finished. Priority orders jobs within a kind; the quantum decides between
# kinds.
#
# The pool path comes from POOLS_PATH, which boot exports into /etc/bashrc and this service
# sources; a literal path would name an empty pool nothing writes to (ein/core#210).
echo models-worker: starting

kinds=$(media-pool-kinds models)
if [ -z "$kinds" ]; then
  echo "models-worker: no module names work for it yet, waiting for a drop-in in /etc/media-models.d"
fi
while [ -z "$kinds" ]; do
  sleep 30
  kinds=$(media-pool-kinds models)
done

pipeline-worker --pool "${POOLS_PATH:-/var/pools}/media" \
  --capacity models="${CFG_MODEL_SLOTS:-2}" \
  $kinds \
  --kind-quantum "${CFG_MODEL_KIND_QUANTUM_MS:-3600000}" \
  --concurrency "${CFG_MODEL_SLOTS:-2}"
