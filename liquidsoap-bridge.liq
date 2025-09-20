#!/usr/bin/liquidsoap

# Liquidsoap bridge for WebRTC to Shoutcast streaming
# Receives audio from WebRTC bridge via Harbor input
# Streams to Shoutcast server with proper protocol handling

# Set log level for debugging
settings.log.level := 4

# Harbor input - receives audio from our WebRTC bridge
harbor_source = input.harbor("webrtc", port=8001)

# Process the audio - normalize and ensure consistent format
processed_audio = harbor_source
  |> audio.normalize()
  |> fallback([_, blank()])

# Shoutcast output configuration with correct credentials
output.shoutcast(
  %mp3(bitrate=128),
  host="51.75.145.84",
  port=8015,
  password="test:test",
  mount="/radio.mp3",
  name="WebRTC DJ Stream",
  description="Live DJ mix from WebRTC application",
  genre="Electronic",
  processed_audio
)

# Log status
print("Liquidsoap bridge started")
print("Harbor input listening on port 8001")
print("Shoutcast output: 51.75.145.84:8015/radio.mp3")
print("Credentials: test:test")