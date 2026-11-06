# Picture vectors

How a photo or a video is made findable by what it shows, without a caption: a SigLIP2 vector
(EMS `vision.embed`) for a photo and one per keyframe of a video, compared with a query's words
through the same model's text tower.

**Making them.** `media-embed-picture` runs `embed-picture` on `media.metadata.extracted` for a
photo or a video in a folder that wants `picture-vectors` and has no `metadata/picture` yet, a
step of kind `embed-picture` on the models worker. A photo is sent as its `small` rendition when it
has one (`@media/picture-source`: 800 px, already in the display frame, which the model sees at
384 px), otherwise with the node's turn; EMS picks a video's keyframes itself. The vectors are core
`embedding` nodes under `<file>/metadata/picture/` (`embedding`, or `k0`… with `atSeconds`), typed
per model (`@media/pictures`: a new model is a new table, never mixed with the old); the directory
is emptied first, so another model's or extra keyframes' rows go, and stamped `embeddedBy` after
the vectors, and the file is marked last (`pictureVectorsBy`). A model nothing has given a type is
refused.

**Keeping them current.** `pictures-heal` runs `pictures-scan` every hour: one query per kind for
the photos and videos whose marker is missing or names another model than EMS runs now
(`generations().imageEmbed`), passed over as the other heals pass over (`@media/stale-scan`), each
announced `media.picture.stale` in the bulk lane, and nothing while that work waits or EMS does not
answer. `embed-picture` decides what the fact asks: vectors the model EMS runs made are kept and
the file marked, another model's are made again, and while EMS embeds no pictures nothing is
replaced. `-f` makes them again whatever made them.

**Reading them.** Search embeds a query's words once per space (`pictureQuery`, through
`@ems/text-embedding`, which every search asking the same words shares) and asks the type's index
for the nearest vectors (`vfs.findSimilar`); `fileOfPictureVector` maps a hit to its file, and a
video scores by its best keyframe. `PICTURE_FLOOR` is the least cosine that counts as a match. The
archive's search, album search and label suggestions read them so.
