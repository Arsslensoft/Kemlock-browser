// What File items and note attachments need to agree on between the files tab and the background (docs/plans/add-item-format.md).
// A file goes to the core in pieces of 1 MiB (base64 in a message) and comes back the same way, so no page holds more than a piece
// at once in a message, and the worker's idle time starts over with each.

/** The size of a piece of a file, in bytes: what `stageItemFile` takes at most and `readOpened` gives. */
export const itemFileChunkBytes = 1_048_576

/**
 * The name of the port the files tab holds open (and pings) while a file is staged or opened in it, so the worker the browser would
 * stop is kept: what the core holds for the tab is gone with the worker.
 */
export const itemFilesKeepAlivePort = 'item-files-keepalive'

/** How often the files tab pings that port, in milliseconds (the worker stops after 30 seconds of nothing). */
export const itemFilesPingMs = 15_000

/** The most files a note holds, and the most bytes of one (the server's limits). */
export const maxAttachments = 100
export const maxAttachmentBytes = 50 * 1024 * 1024
