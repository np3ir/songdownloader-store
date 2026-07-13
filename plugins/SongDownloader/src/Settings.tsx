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

const defaultFilenameFormat = "{artist} - {album} - {title}";
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
});

// Sanitize download quality
if (Quality.fromAudioQuality(settings.downloadQuality) === undefined) settings.downloadQuality = Quality.Max.audioQuality;
// Sanitize numeric settings (ReactiveStore may hydrate an old install without them)
if (!Number.isFinite(settings.maxArtistsInName) || settings.maxArtistsInName < 1) settings.maxArtistsInName = DEFAULT_MAX_ARTISTS_IN_NAME;
if (!Number.isFinite(settings.trackNumberPadding) || settings.trackNumberPadding < 0) settings.trackNumberPadding = DEFAULT_TRACK_NUMBER_PADDING;

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

	return (
		<LunaSettings>
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
		</LunaSettings>
	);
};
