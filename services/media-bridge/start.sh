# Derives the facts of a media file itself from VFS mutations — it arrived, its bytes changed, it
# was turned or removed, its metadata was read, its renditions were made — and publishes them to
# /dev/events, where the pipeline engine picks them up as triggers.
media-bridge
