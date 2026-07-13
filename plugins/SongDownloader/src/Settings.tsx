/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { ReactiveStore } from "@luna/core";
import { MediaItem, Quality, type redux } from "@luna/lib";
import { LunaButtonSetting, LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";

import React from "react";
import { getDownloadFolder } from "./helpers";
import { requestStop } from "./cancel";

// Default alineado con el template de tiddl del usuario (config.toml [templates].default)
const defaultFilenameFormat = "{artist_initials}/{albumArtist}/({year}) {album}/{trackNumber}. {artist} - {title}{explicit}";
const DEFAULT_ARTIST_SEPARATOR = " / "; // DEFAULT_ARTIST_SEPARATOR del fork tiddl-elvigilante
const DEFAULT_MAX_ARTISTS_IN_NAME = 3; // MAX_ARTISTS_IN_NAME del fork tiddl-elvigilante
const DEFAULT_TRACK_NUMBER_PADDING = 2; // {trackNumber} -> "01." (0 = sin padding)

type Settings = {
	downloadQuality: redux.AudioQuality;
	defaultPath?: string;
	pathFormat: string;
	useRealMAX: boolean;
	// Convención propia del usuario (portada de su fork tiddl-elvigilante, no upstream)
	artistSeparator: string;
	useFullwidth: boolean;
	fetchFeatured: boolean;
	saveLrc: boolean;
	maxArtistsInName: number;
	trackNumberPadding: number;
	discSubfolder: boolean;
	// Descarga de artista completo
	artistIncludeSingles: boolean;
	artistDedup: boolean;
	artistTrackDelay: number;
	artistAlbumDelay: number;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("SongDownloader", {
	downloadQuality: Quality.Max.audioQuality,
	pathFormat: defaultFilenameFormat,
	useRealMAX: true,
	artistSeparator: DEFAULT_ARTIST_SEPARATOR,
	useFullwidth: true,
	fetchFeatured: true,
	saveLrc: true,
	maxArtistsInName: DEFAULT_MAX_ARTISTS_IN_NAME,
	trackNumberPadding: DEFAULT_TRACK_NUMBER_PADDING,
	discSubfolder: true,
	artistIncludeSingles: true,
	artistDedup: true,
	artistTrackDelay: 5, // = tiddl track_delay
	artistAlbumDelay: 10, // = tiddl artist_delay
});

// Sanitize download quality
if (Quality.fromAudioQuality(settings.downloadQuality) === undefined) settings.downloadQuality = Quality.Max.audioQuality;
// Sanitize numeric settings (ReactiveStore may hydrate an old install without them)
if (!Number.isFinite(settings.maxArtistsInName) || settings.maxArtistsInName < 1) settings.maxArtistsInName = DEFAULT_MAX_ARTISTS_IN_NAME;
if (!Number.isFinite(settings.trackNumberPadding) || settings.trackNumberPadding < 0) settings.trackNumberPadding = DEFAULT_TRACK_NUMBER_PADDING;
if (!Number.isFinite(settings.artistTrackDelay) || settings.artistTrackDelay < 0) settings.artistTrackDelay = 2;
if (!Number.isFinite(settings.artistAlbumDelay) || settings.artistAlbumDelay < 0) settings.artistAlbumDelay = 5;

export const Settings = () => {
	const [downloadQuality, setDownloadQuality] = React.useState(settings.downloadQuality);
	const [defaultPath, setDefaultPath] = React.useState(settings.defaultPath);
	const [pathFormat, setPathFormat] = React.useState(settings.pathFormat);
	const [useRealMAX, setUseRealMAX] = React.useState(settings.useRealMAX);
	const [artistSeparator, setArtistSeparator] = React.useState(settings.artistSeparator);
	const [useFullwidth, setUseFullwidth] = React.useState(settings.useFullwidth);
	const [fetchFeatured, setFetchFeatured] = React.useState(settings.fetchFeatured);
	const [saveLrc, setSaveLrc] = React.useState(settings.saveLrc);
	const [maxArtistsInName, setMaxArtistsInName] = React.useState(String(settings.maxArtistsInName));
	const [trackNumberPadding, setTrackNumberPadding] = React.useState(String(settings.trackNumberPadding));
	const [discSubfolder, setDiscSubfolder] = React.useState(settings.discSubfolder);
	const [artistIncludeSingles, setArtistIncludeSingles] = React.useState(settings.artistIncludeSingles);
	const [artistDedup, setArtistDedup] = React.useState(settings.artistDedup);
	const [artistTrackDelay, setArtistTrackDelay] = React.useState(String(settings.artistTrackDelay));
	const [artistAlbumDelay, setArtistAlbumDelay] = React.useState(String(settings.artistAlbumDelay));

	return (
		<LunaSettings>
			<LunaButtonSetting
				title="Stop current download"
				desc={
					<>
						Cancel a running download (album, playlist or artist). The current track finishes, then it stops.
						<br />
						You can also just click the download button again while it's running.
					</>
				}
				children="Stop"
				onClick={() => requestStop()}
			/>
			<LunaSelectSetting
				title="Download quality"
				value={downloadQuality}
				onChange={(e) => setDownloadQuality((settings.downloadQuality = e.target.value))}
			>
				{Object.values(Quality.lookups.audioQuality).map((quality) => {
					if (typeof quality !== "string" && quality.audioQuality !== Quality.MQA.audioQuality)
						return <LunaSelectItem key={quality.name} value={quality.audioQuality} children={quality.name} />;
				})}
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Use RealMAX to find the highest quality"
				value={useRealMAX}
				onChange={(_, checked) => setUseRealMAX((settings.useRealMAX = checked))}
			/>
			<LunaButtonSetting
				title="Default save path"
				desc={
					<>
						Set a default folder to save files to (will disable prompting for path on download)
						{defaultPath && (
							<>
								<br />
								Using {defaultPath}
							</>
						)}
					</>
				}
				children={defaultPath === undefined ? "Set default folder" : "Clear default folder"}
				onClick={async () => {
					if (defaultPath !== undefined) return setDefaultPath((settings.defaultPath = undefined));
					setDefaultPath((settings.defaultPath = await getDownloadFolder()));
				}}
			/>
			<LunaTextSetting
				title="Path format"
				desc={
					<>
						Define subfolders using <b>/</b>.
						<br />
						For example: {"{artist}/{album}/{title}"}
						<br />
						Saves in subfolder artist/album/ named <b>title.flac</b>.
						<div style={{ marginTop: 8 }} />
						You can use the following tags:
						<ul>
							<li key="artist_initials">
								<b>artist_initials</b> — album artist's initial folder (A–Z, or # for other). E.g. {"{artist_initials}/{albumArtist}/..."} → <b>A/Alex Bueno/...</b>
							</li>
							<li key="explicit">
								<b>explicit</b> — appends <b>{" (explicit)"}</b> for explicit tracks, nothing otherwise (tiddl's explicit marker).
							</li>
							{MediaItem.availableTags.map((tag) => (
								<li key={tag}>{tag}</li>
							))}
						</ul>
					</>
				}
				value={pathFormat}
				onChange={(e) => setPathFormat((settings.pathFormat = e.target.value))}
			/>
			<LunaTextSetting
				title="Artist separator"
				desc={
					<>
						String used to join multiple artists in the <b>filename</b> (your own convention).
						<br />
						Default <b>{'" / "'}</b>. The ARTIST tag is always written multi-value.
					</>
				}
				value={artistSeparator}
				onChange={(e) => setArtistSeparator((settings.artistSeparator = e.target.value))}
			/>
			<LunaTextSetting
				title="Max artists in filename"
				desc={<>Beyond this count the filename collapses the tail into <b>&amp; others</b>. All artists still go in the tag.</>}
				value={maxArtistsInName}
				onChange={(e) => {
					const raw = e.target.value;
					setMaxArtistsInName(raw);
					const n = parseInt(raw, 10);
					if (Number.isFinite(n) && n >= 1) settings.maxArtistsInName = n;
				}}
			/>
			<LunaTextSetting
				title="Track number padding"
				desc={
					<>
						Zero-pad <b>{"{trackNumber}"}</b> in the filename to this many digits (e.g. <b>2</b> → <b>01.</b>).
						<br />
						Set to <b>0</b> to disable padding.
					</>
				}
				value={trackNumberPadding}
				onChange={(e) => {
					const raw = e.target.value;
					setTrackNumberPadding(raw);
					const n = parseInt(raw, 10);
					if (Number.isFinite(n) && n >= 0) settings.trackNumberPadding = n;
				}}
			/>
			<LunaSwitchSetting
				title="Disc subfolder for multi-disc albums"
				desc={
					<>
						On albums with more than one disc (volume), add a <b>Disc N</b> folder before the file so tracks
						from different discs don't mix. Skipped if your Path format already uses <b>{"{discNumber}"}</b>.
					</>
				}
				value={discSubfolder}
				onChange={(_, checked) => setDiscSubfolder((settings.discSubfolder = checked))}
			/>
			<LunaSwitchSetting
				title="Fullwidth sanitization"
				desc={<>Replace forbidden filename chars (: / ? * ... ) with fullwidth twins instead of stripping them (your own convention).</>}
				value={useFullwidth}
				onChange={(_, checked) => setUseFullwidth((settings.useFullwidth = checked))}
			/>
			<LunaSwitchSetting
				title="Fetch featured artists from /contributors"
				desc={<>Recover featured artists Tidal drops from the main list, via the track's contributors endpoint (extra request per track).</>}
				value={fetchFeatured}
				onChange={(_, checked) => setFetchFeatured((settings.fetchFeatured = checked))}
			/>
			<LunaSwitchSetting
				title="Save .lrc lyrics sidecar"
				desc={<>Write synced lyrics to a <b>.lrc</b> file next to the track when available.</>}
				value={saveLrc}
				onChange={(_, checked) => setSaveLrc((settings.saveLrc = checked))}
			/>
			<LunaSwitchSetting
				title="Artist download · include EPs & singles"
				desc={<>When downloading a whole artist (right-click an artist), also fetch their EPs and singles, not just albums.</>}
				value={artistIncludeSingles}
				onChange={(_, checked) => setArtistIncludeSingles((settings.artistIncludeSingles = checked))}
			/>
			<LunaSwitchSetting
				title="Artist download · deduplicate editions"
				desc={<>Collapse multiple editions of the same album (same title/type/version) and keep the highest quality one. Recommended.</>}
				value={artistDedup}
				onChange={(_, checked) => setArtistDedup((settings.artistDedup = checked))}
			/>
			<LunaTextSetting
				title="Artist download · delay between tracks (s)"
				desc={<>Max random pause (seconds) between tracks during a full-artist download, to avoid hammering TIDAL. <b>0</b> = no delay.</>}
				value={artistTrackDelay}
				onChange={(e) => {
					const raw = e.target.value;
					setArtistTrackDelay(raw);
					const n = parseFloat(raw);
					if (Number.isFinite(n) && n >= 0) settings.artistTrackDelay = n;
				}}
			/>
			<LunaTextSetting
				title="Artist download · delay between albums (s)"
				desc={<>Max random pause (seconds) between albums during a full-artist download. <b>0</b> = no delay.</>}
				value={artistAlbumDelay}
				onChange={(e) => {
					const raw = e.target.value;
					setArtistAlbumDelay(raw);
					const n = parseFloat(raw);
					if (Number.isFinite(n) && n >= 0) settings.artistAlbumDelay = n;
				}}
			/>
		</LunaSettings>
	);
};
