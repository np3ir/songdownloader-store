/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { showOpenDialog, showSaveDialog } from "@luna/lib.native";

import { alphaBucket, joinArtistsCapped, sanitizeAscii, sanitizeFullwidth } from "./tags";

export const getDownloadFolder = async () => {
	const { canceled, filePaths } = await showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
	if (!canceled) return filePaths[0];
};

export const getDownloadPath = async (defaultPath: string) => {
	const { canceled, filePath } = await showSaveDialog({
		defaultPath,
		filters: [{ name: "", extensions: [defaultPath ?? "*"] }],
	});
	if (!canceled) return filePath;
};

export type FileNameOpts = {
	separator: string;
	useFullwidth: boolean;
	maxArtistsInName: number;
	/** Ancho de zero-pad para {trackNumber} (0 = sin padding). */
	trackNumberPadding: number;
};

/**
 * Construye el nombre de archivo aplicando la convención propia del usuario
 * (mods de su fork tiddl-elvigilante, no de tiddl upstream):
 *   - {artist}: artistas ordenados (main+featured) unidos por `separator`,
 *     capados a `maxArtistsInName` + " & others".
 *   - {albumArtist}: unido por `separator` (sin cap).
 *   - Sanitización FULLWIDTH por valor (o ASCII si useFullwidth=false), lo que
 *     preserva los "/" del template como subcarpetas reales.
 *
 * `pathFormat` puede usar "/" para definir subcarpetas (igual que en su fork).
 */
export const buildFileName = (
	pathFormat: string,
	ext: string,
	tags: Record<string, string | string[] | undefined>,
	orderedArtists: string[],
	albumArtists: string[] | string | undefined,
	opts: FileNameOpts,
): string => {
	const sanitize = opts.useFullwidth ? sanitizeFullwidth : sanitizeAscii;

	let fileName = `${pathFormat}.${ext}`;

	// {artist_initials}: carpeta de inicial del album artist (o del primer artista
	//   del track si no hay album artist). Siempre A–Z o "#", no requiere sanitizar.
	const aaArr = Array.isArray(albumArtists) ? albumArtists : albumArtists ? [albumArtists] : [];
	const initialsSource = aaArr[0] || orderedArtists[0] || "";
	fileName = fileName.split("{artist_initials}").join(alphaBucket(initialsSource));

	// {artist}: lista capada, no solo el primero
	const artistValue = joinArtistsCapped(orderedArtists, opts.separator, opts.maxArtistsInName);
	fileName = fileName.split("{artist}").join(sanitize(artistValue));

	// {albumArtist}: unido por el separador (ya viene solo el principal desde index.ts)
	fileName = fileName.split("{albumArtist}").join(sanitize(aaArr.join(opts.separator)));

	// {trackNumber}: zero-pad opcional (0 = off). Solo dígitos se rellenan.
	const rawTrack = Array.isArray(tags.trackNumber) ? tags.trackNumber[0] : tags.trackNumber;
	if (rawTrack !== undefined && rawTrack !== null) {
		let trackValue = String(rawTrack);
		if (opts.trackNumberPadding > 0 && /^\d+$/.test(trackValue)) {
			trackValue = trackValue.padStart(opts.trackNumberPadding, "0");
		}
		fileName = fileName.split("{trackNumber}").join(sanitize(trackValue));
	}

	// Resto de placeholders
	for (const [tag, raw] of Object.entries(tags)) {
		if (tag === "artist" || tag === "albumArtist" || tag === "trackNumber") continue;
		const value = Array.isArray(raw) ? raw[0] : raw;
		if (value === undefined || value === null) continue;
		fileName = fileName.split(`{${tag}}`).join(sanitize(String(value)));
	}

	return fileName;
};
