const messages={
 SOURCE_AUTH_REQUIRED:'This recording is not available for playback.',
 SOURCE_NO_AUDIO:'Audio is not available for this recording. Please try again.',
 SOURCE_CLIENT_UNAVAILABLE:'This recording is taking longer to prepare. Please try again.',
 SOURCE_UNAVAILABLE:'This recording is unavailable right now.',
 SOURCE_RATE_LIMITED:'The music source is busy. Please try again shortly.',
 SOURCE_ACCESS_DENIED:'This recording is not available for playback.',
 SOURCE_TIMEOUT:'This song took too long to prepare. Please try again.',
 SOURCE_INVALID_STREAM:'A playable audio stream could not be prepared.',
 SOURCE_EXPIRED:'The playback link expired. Please try again.',
 SOURCE_BUSY:'The music source is busy. Please try again shortly.',
 CATALOG_UNAVAILABLE:'The music catalog is unavailable right now.',
 INVALID_VIDEO_ID:'Invalid track ID.',
 INVALID_REQUEST:'Invalid request.',
}
export const sourceMessage=code=>messages[code]||'The music source is unavailable. Please try again.'
