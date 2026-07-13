# Song Downloader (ElVigilante) — Luna Plugin Store

A [Tidal Luna](https://github.com/Inrixia/TidaLuna) plugin store containing **SongDownloader ElVigilante**, a fork of Inrixia's [SongDownloader](https://github.com/Inrixia/luna-plugins) that downloads TIDAL songs as FLAC using a custom tagging/naming convention.

> This is a personal fork. Naming/tagging conventions here are my own modifications, **not** features of the original SongDownloader or of tiddl.

## Install the store

1. Install the [TidaLuna client](https://github.com/Inrixia/TidaLuna).
2. In TIDAL, open **Luna Settings → Plugin Store**.
3. Add this store URL:

   ```
   https://github.com/np3ir/songdownloader-store/releases/download/latest/store.json
   ```

4. Install **SongDownloader ElVigilante** from the store.
5. If you have the original *Song Downloader* installed, remove it (both add a download button to the context menu).

Then right-click any track, album or playlist → **Download N tracks**.

## Features (vs the original SongDownloader)

- **Artist separator** — join multiple artists in the filename with a configurable string (default `" / "`); the ARTIST tag stays multi-value.
- **Featured artists from `/contributors`** — recover featured artists TIDAL drops from the main artist list.
- **`.lrc` sidecar** — write synced lyrics next to the track.
- **Fullwidth sanitization** — replace forbidden filename chars (`: / ? *` …) with fullwidth twins instead of stripping them.
- **`{artist_initials}` placeholder** — alpha-bucket folder (`A/Artist/…`, `#` for non-letters).
- **Optional track-number padding** — zero-pad `{trackNumber}` (e.g. `01.`); set to `0` to disable.
- **Multi-disc handling** — albums with more than one volume auto-get a `Disc N` subfolder (unless your Path format already uses `{discNumber}`), so discs don't interleave. Toggleable.
- **Full-artist download** — right-click an artist → **Download artist** grabs the whole discography (albums, optionally EPs & singles), with edition dedup (keeps the best-quality version of each album) and configurable pacing (delays between tracks/albums) to stay gentle on TIDAL.
- **Album-artist normalization** — the album folder uses the primary album artist and the album's own release date, so compilations don't fragment into multiple year folders.
- **m4a tagging** — tracks that download as m4a (AAC/DASH) get tagged too (via `node-taglib-sharp`), not just FLAC.

### Path format tags

Use `/` for subfolders. Available placeholders include `{artist_initials}`, `{albumArtist}`, `{artist}`, `{album}`, `{title}`, `{trackNumber}`, `{year}`, `{date}`, and the rest of the FLAC tag set. Example:

```
{artist_initials}/{albumArtist}/({year}) {album}/{trackNumber}. {artist} - {title}
```

## Development

```sh
corepack enable
pnpm install
pnpm run watch   # builds + serves on http://localhost:3000 (DEV store appears in Luna)
```

Pushing to `master` triggers a GitHub Action that builds and publishes the `latest` release with `store.json`.

## Credits & license

Forked from [Inrixia/luna-plugins](https://github.com/Inrixia/luna-plugins) (SongDownloader). Licensed under **AGPL-3.0**, same as upstream.
