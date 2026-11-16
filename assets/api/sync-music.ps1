Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
})[0]

Function Await-Async($op, $type) {
    if (-not $op) { return $null }
    try {
        $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
        $t.Wait(3000) | Out-Null
        return $t.Result
    } catch {
        return $null
    }
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null

Function Get-SessionManager {
    try {
        return Await-Async ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    } catch {
        return $null
    }
}

$manager = Get-SessionManager

Function Is-ValidSession($s) {
    if (-not $s) { return $false }
    try {
        $p = Await-Async ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if (-not $p -or -not $p.Title) { return $false }
        # Exclude self/portfolio browser tabs
        if ($p.Title -like "*Robin Hossain |*" -or $p.Title -like "*Personal Portfolio*") {
            return $false
        }
        return $true
    } catch {
        return $true
    }
}

Function Get-ActiveMediaSession($mgr) {
    if (-not $mgr) { return $null }

    # 1. Dedicated music apps: Spotify (prioritize playing first, then paused)
    try {
        $sessions = $mgr.GetSessions()
        if ($sessions) {
            # 1a. Playing Spotify
            foreach ($s in $sessions) {
                if ($s.SourceAppUserModelId -like "*spotify*") {
                    $pb = $s.GetPlaybackInfo()
                    if ($pb -and $pb.PlaybackStatus.ToString() -eq "Playing" -and (Is-ValidSession $s)) {
                        return $s
                    }
                }
            }
            # 1b. Paused Spotify (if has track)
            foreach ($s in $sessions) {
                if ($s.SourceAppUserModelId -like "*spotify*" -and (Is-ValidSession $s)) {
                    return $s
                }
            }
        }
    } catch {}

    # 2. Other dedicated music players (Apple Music, Tidal, Deezer, etc.)
    try {
        $sessions = $mgr.GetSessions()
        if ($sessions) {
            foreach ($s in $sessions) {
                if ($s.SourceAppUserModelId -match "applemusic|tidal|deezer|musicbee|foobar|winamp") {
                    if (Is-ValidSession $s) { return $s }
                }
            }
        }
    } catch {}

    # 3. Any actively playing session (e.g. YouTube Music in browser)
    try {
        $sessions = $mgr.GetSessions()
        if ($sessions) {
            foreach ($s in $sessions) {
                try {
                    $pb = $s.GetPlaybackInfo()
                    if ($pb -and $pb.PlaybackStatus.ToString() -eq "Playing" -and (Is-ValidSession $s)) {
                        return $s
                    }
                } catch {}
            }
        }
    } catch {}

    # 4. Try current session if valid
    try {
        $cur = $mgr.GetCurrentSession()
        if ($cur -and (Is-ValidSession $cur)) { return $cur }
    } catch {}

    # 5. Fallback to any valid session
    try {
        $sessions = $mgr.GetSessions()
        if ($sessions) {
            foreach ($s in $sessions) {
                if (Is-ValidSession $s) {
                    return $s
                }
            }
        }
    } catch {}

    return $null
}

# String cleaner for search queries
Function Clean-TitleForSearch($str) {
    if (-not $str) { return "" }
    $c = $str -replace '\((?:official|music|video|audio|lyrics?|visualizer|hd|4k|remastered|explicit|clean|live|version|edit)[^)]*\)', ' '
    $c = $c -replace '\[(?:official|music|video|audio|lyrics?|visualizer|hd|4k|remastered|explicit|clean|live|version|edit)[^\]]*\]', ' '
    $c = $c -replace '\s*(?:feat\.?|ft\.?)\s+.*$', ''
    $c = ($c -replace '[^\w\s''-]', ' ') -replace '\s+', ' '
    return $c.Trim()
}

Function Clean-ArtistForSearch($str) {
    if (-not $str) { return "" }
    $c = $str -replace '\s*(?:&|feat\.?|ft\.?|x|,)\s+.*$', ''
    $c = ($c -replace '[^\w\s''-]', ' ') -replace '\s+', ' '
    return $c.Trim()
}

$trackMetaCache = @{}

Function Get-TrackMetadata($artist, $title, $album) {
    if (-not $title) { return $null }
    $cacheKey = "$artist::$title"
    if ($trackMetaCache.ContainsKey($cacheKey)) {
        return $trackMetaCache[$cacheKey]
    }

    $cleanTitle = Clean-TitleForSearch $title
    $cleanArtist = Clean-ArtistForSearch $artist
    $meta = [PSCustomObject]@{
        albumArt = ""
        previewUrl = ""
        durationSec = 0
    }

    # 1. Primary: iTunes Search by Artist + Title
    try {
        $q = [System.Uri]::EscapeDataString("$cleanArtist $cleanTitle")
        $url = "https://itunes.apple.com/search?term=$q&entity=song&limit=3"
        $res = Invoke-RestMethod -Uri $url -TimeoutSec 4
        $item = $res.results | Where-Object { $_.previewUrl } | Select-Object -First 1
        if (-not $item -and $res.results) {
            $item = $res.results | Where-Object { $_.artworkUrl100 } | Select-Object -First 1
        }
        if ($item) {
            if ($item.artworkUrl100) {
                $meta.albumArt = $item.artworkUrl100 -replace '100x100bb', '600x600bb'
            }
            if ($item.previewUrl) {
                $meta.previewUrl = $item.previewUrl
            }
            if ($item.trackTimeMillis) {
                $meta.durationSec = [Math]::Round($item.trackTimeMillis / 1000)
            }
        }
    } catch {}

    # 2. Secondary: iTunes Search by Title only (if previewUrl not found)
    if (-not $meta.previewUrl -and $cleanTitle) {
        try {
            $qTitle = [System.Uri]::EscapeDataString($cleanTitle)
            $urlTitle = "https://itunes.apple.com/search?term=$qTitle&entity=song&limit=3"
            $resT = Invoke-RestMethod -Uri $urlTitle -TimeoutSec 4
            $itemT = $resT.results | Where-Object { $_.previewUrl } | Select-Object -First 1
            if ($itemT) {
                if (-not $meta.albumArt -and $itemT.artworkUrl100) {
                    $meta.albumArt = $itemT.artworkUrl100 -replace '100x100bb', '600x600bb'
                }
                $meta.previewUrl = $itemT.previewUrl
                if ($meta.durationSec -le 0 -and $itemT.trackTimeMillis) {
                    $meta.durationSec = [Math]::Round($itemT.trackTimeMillis / 1000)
                }
            }
        } catch {}
    }

    # 3. Tertiary: Deezer API fallback for preview MP3 and Cover
    if (-not $meta.previewUrl) {
        try {
            $dzQuery = [System.Uri]::EscapeDataString("$cleanArtist $cleanTitle")
            $dzUrl = "https://api.deezer.com/search?q=$dzQuery"
            $dzRes = Invoke-RestMethod -Uri $dzUrl -TimeoutSec 4
            $dzItem = $dzRes.data | Where-Object { $_.preview } | Select-Object -First 1
            if ($dzItem) {
                if (-not $meta.albumArt -and $dzItem.album -and $dzItem.album.cover_big) {
                    $meta.albumArt = $dzItem.album.cover_big
                }
                $meta.previewUrl = $dzItem.preview
                if ($meta.durationSec -le 0 -and $dzItem.duration) {
                    $meta.durationSec = $dzItem.duration
                }
            }
        } catch {}
    }

    # 4. Check for local full-length audio file in assets/audio/ (overrides 30-second preview clips)
    $audioDir = Join-Path (Split-Path -Parent $PSScriptRoot) "audio"
    if (Test-Path $audioDir) {
        if ($cleanTitle -match "lies" -and $cleanArtist -match "zach bryan") {
            $meta.previewUrl = "assets/audio/lies-zach-bryan.mp3"
            if ($meta.durationSec -le 0) { $meta.durationSec = 221 }
        } else {
            $matchedFile = Get-ChildItem -Path $audioDir -Filter "*.mp3" -ErrorAction SilentlyContinue | Where-Object { 
                $cleanTitle -and $_.BaseName -like "*$cleanTitle*" 
            } | Select-Object -First 1
            if ($matchedFile) {
                $meta.previewUrl = "assets/audio/" + $matchedFile.Name
            }
        }
    }

    # 5. Resolve full-length YouTube streaming Video ID via InnerTube API
    $meta | Add-Member -NotePropertyName "youtubeId" -NotePropertyValue "" -Force
    try {
        if ($cleanTitle -match "lies" -and $cleanArtist -match "zach bryan") {
            $meta.youtubeId = "nhR-Ka-aKUs"
        } else {
            $b = "{`"context`":{`"client`":{`"clientName`":`"WEB`",`"clientVersion`":`"2.20240101.00.00`"}},`"query`":`"$cleanArtist $cleanTitle audio`"}"
            $ytRes = Invoke-RestMethod -Uri "https://www.youtube.com/youtubei/v1/search" -Method Post -Body $b -ContentType "application/json" -TimeoutSec 3
            $ytItem = $ytRes.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents | Where-Object { $_.videoRenderer } | Select-Object -First 1
            if ($ytItem) {
                $meta.youtubeId = $ytItem.videoRenderer.videoId
            }
        }
    } catch {}

    $trackMetaCache[$cacheKey] = $meta
    return $meta
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$jsonPath = Join-Path $PSScriptRoot "now-playing.json"

# Start lightweight embedded HTTP server for instant CORS-free real-time queries & playback control
$port = 28934
$listener = New-Object System.Net.HttpListener
$listenerStarted = $false
try {
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
    $listenerStarted = $true
} catch {
    # Port may be in use by another instance or restricted; continue with file output
}

$asyncContext = $null
if ($listenerStarted) {
    $asyncContext = $listener.BeginGetContext($null, $null)
}

$cachedJson = "{`"isNowPlaying`":false,`"playbackStatus`":`"Stopped`",`"title`":`"`",`"artist`":`"`",`"albumArt`":`"`",`"previewUrl`":`"`",`"positionSec`":0,`"durationSec`":0,`"updatedAt`":0}"
$lastDiskWrite = [DateTime]::MinValue
$lastDiskContent = ""

Write-Host "PC Music Sync Service started."
if ($listenerStarted) {
    Write-Host "HTTP endpoint listening on http://127.0.0.1:$port/now-playing"
}
Write-Host "Syncing with Spotify / YouTube Music / Windows Media..."

while ($true) {
    try {
        if (-not $manager) {
            $manager = Get-SessionManager
        }

        $session = Get-ActiveMediaSession $manager
        $now = [DateTimeOffset]::UtcNow
        $nowMs = $now.ToUnixTimeMilliseconds()

        if ($session) {
            [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
            $props = Await-Async ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $timeline = $session.GetTimelineProperties()
            $playback = $session.GetPlaybackInfo()

            $status = if ($playback) { $playback.PlaybackStatus.ToString() } else { "Closed" }
            $title = if ($props -and $props.Title) { $props.Title.Trim() } else { "" }
            $artist = if ($props -and $props.Artist) { $props.Artist.Trim() } else { "" }
            $album = if ($props -and $props.AlbumTitle) { $props.AlbumTitle.Trim() } else { "" }

            $durSec = 0.0
            $posSec = 0.0

            if ($timeline) {
                if ($timeline.EndTime) {
                    $durSec = [Math]::Round($timeline.EndTime.TotalSeconds, 2)
                }
                if ($timeline.Position) {
                    $posSec = [Math]::Round($timeline.Position.TotalSeconds, 2)
                }
                # When playing, extrapolate current position accurately from LastUpdatedTime in UTC
                if ($status -eq "Playing" -and $timeline.LastUpdatedTime -and $timeline.LastUpdatedTime.Year -gt 2000) {
                    $lastUpdUtc = $timeline.LastUpdatedTime.ToUniversalTime()
                    $diff = ($now - $lastUpdUtc).TotalSeconds
                    if ($diff -gt 0 -and $diff -lt 3600) {
                        $posSec = [Math]::Round($posSec + $diff, 2)
                        if ($durSec -gt 0 -and $posSec -gt $durSec) {
                            $posSec = $durSec
                        }
                    }
                }
            }

            # Fetch or retrieve cached real album artwork & audio preview URL
            $meta = $null
            if ($title) {
                $meta = Get-TrackMetadata $artist $title $album
            }

            if ($durSec -le 0 -and $meta -and $meta.durationSec -gt 0) {
                $durSec = $meta.durationSec
            }

            $isNowPlaying = ($status -eq "Playing")

            $info = [PSCustomObject]@{
                title = $title
                artist = $artist
                album = $album
                albumArt = if ($meta -and $meta.albumArt) { $meta.albumArt } else { "" }
                previewUrl = if ($meta -and $meta.previewUrl) { $meta.previewUrl } else { "" }
                youtubeId = if ($meta -and $meta.youtubeId) { $meta.youtubeId } else { "nhR-Ka-aKUs" }
                positionSec = $posSec
                durationSec = $durSec
                playbackStatus = $status
                isNowPlaying = $isNowPlaying
                updatedAt = $nowMs
            }
            $cachedJson = $info | ConvertTo-Json -Compress
        } else {
            $info = [PSCustomObject]@{
                title = ""
                artist = ""
                album = ""
                albumArt = ""
                previewUrl = ""
                positionSec = 0.0
                durationSec = 0.0
                playbackStatus = "Stopped"
                isNowPlaying = $false
                updatedAt = $nowMs
            }
            $cachedJson = $info | ConvertTo-Json -Compress
        }

        # Write to disk periodically (~every 500ms if playing, or whenever state/song changes)
        $timeSinceWrite = ([DateTime]::UtcNow - $lastDiskWrite).TotalMilliseconds
        if ($timeSinceWrite -ge 500 -or $cachedJson -ne $lastDiskContent) {
            $lastDiskWrite = [DateTime]::UtcNow
            $lastDiskContent = $cachedJson
            try {
                [System.IO.File]::WriteAllText($jsonPath, $cachedJson, $utf8NoBom)
            } catch {}
        }

        # Handle incoming HTTP requests
        if ($listenerStarted -and $listener.IsListening) {
            $reqCount = 0
            while ($asyncContext -and $asyncContext.IsCompleted -and $reqCount -lt 10) {
                $reqCount++
                try {
                    $context = $listener.EndGetContext($asyncContext)
                    $asyncContext = $listener.BeginGetContext($null, $null)

                    $resp = $context.Response
                    $resp.Headers.Add("Access-Control-Allow-Origin", "*")
                    $resp.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    $resp.Headers.Add("Access-Control-Allow-Headers", "*")
                    $resp.Headers.Add("Access-Control-Allow-Private-Network", "true")
                    $resp.ContentType = "application/json; charset=utf-8"

                    if ($context.Request.HttpMethod -eq "OPTIONS") {
                        $resp.StatusCode = 204
                        $resp.Close()
                    } else {
                        $rawUrl = $context.Request.RawUrl
                        $path = $context.Request.Url.AbsolutePath.ToLower()
                        $responseBody = $cachedJson

                        # Handle Seeking: /seek?pos=X
                        if ($path -eq "/seek" -or $rawUrl -like "*/seek*") {
                            if ($rawUrl -match 'pos=([0-9\.]+)') {
                                $targetPos = [double]$Matches[1]
                                if ($session) {
                                    try {
                                        $ticks = [long]($targetPos * 10000000)
                                        Await-Async ($session.TryChangePlaybackPositionAsync($ticks)) ([bool]) | Out-Null
                                        Write-Host "Seek request processed to: $targetPos s"
                                    } catch {}
                                }
                                $responseBody = "{`"success`":true,`"positionSec`":$targetPos}"
                            }
                        }
                        # Handle Toggle Play/Pause: /toggle-play
                        elseif ($path -eq "/toggle-play" -or $rawUrl -like "*/toggle-play*") {
                            if ($session) {
                                try {
                                    Await-Async ($session.TryTogglePlayPauseAsync()) ([bool]) | Out-Null
                                    Write-Host "Toggle play/pause processed"
                                } catch {}
                            }
                            $responseBody = "{`"success`":true}"
                        }
                        # Handle Play: /play
                        elseif ($path -eq "/play" -or $rawUrl -like "*/play*") {
                            if ($session) {
                                try {
                                    Await-Async ($session.TryPlayAsync()) ([bool]) | Out-Null
                                } catch {}
                            }
                            $responseBody = "{`"success`":true}"
                        }
                        # Handle Pause: /pause
                        elseif ($path -eq "/pause" -or $rawUrl -like "*/pause*") {
                            if ($session) {
                                try {
                                    Await-Async ($session.TryPauseAsync()) ([bool]) | Out-Null
                                } catch {}
                            }
                            $responseBody = "{`"success`":true}"
                        }

                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseBody)
                        $resp.ContentLength64 = $bytes.Length
                        $resp.OutputStream.Write($bytes, 0, $bytes.Length)
                        $resp.OutputStream.Close()
                    }
                } catch {
                    if ($listener.IsListening) {
                        try { $asyncContext = $listener.BeginGetContext($null, $null) } catch {}
                    }
                }
            }
        }
    } catch {
        # ignore transient COM/WinRT session exceptions
    }

    Start-Sleep -Milliseconds 250
}
