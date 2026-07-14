import { Text, VStack, VideoPlayer, useEffect, useMemo } from "scripting"

export type DownloadedVideoViewProps = {
  /** Absolute local path returned by the X video downloader. */
  videoPath: string
  /** Optional title returned by yt-dlp. */
  title?: string
}

/**
 * Native inline player for a video downloaded by this skill.
 * Render it in chat through a `scripting-file` block.
 */
export default function DownloadedVideoView({
  videoPath,
  title,
}: DownloadedVideoViewProps) {
  const player = useMemo(() => {
    const instance = new AVPlayer()
    instance.setSource(videoPath)
    return instance
  }, [videoPath])

  useEffect(() => {
    void SharedAudioSession.setCategory("playback", ["mixWithOthers"])
    void SharedAudioSession.setActive(true)

    return () => {
      player.dispose()
    }
  }, [player])

  return (
    <VStack spacing={8} padding={12}>
      {title ? <Text font="headline">{title}</Text> : null}
      <VideoPlayer player={player} frame={{ height: 360 }} />
    </VStack>
  )
}
