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
	/** Auto-inyectar carpeta "Disc N" en álbumes multidisco. */
	discSubfolder: boolean;
	/** Nº de volúmenes/discos del álbum (>1 = multidisco). */
	numberOfVolumes: number;
	/** Volumen/disco de ESTE track. */
	volumeNumber: number;
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

	// Multidisco: si el álbum tiene >1 volumen y el template NO maneja el disco
	// explícitamente ({discNumber}), inyecta una carpeta "Disc N" antes del archivo
	// para que el disco 1 track 1 y el disco 2 track 1 no se mezclen. Paridad con
	// tiddl (auto-inject disc folder por numberOfVolumes).
	if (opts.discSubfolder && opts.numberOfVolumes > 1 && !pathFormat.includes("{discNumber}")) {
		const parts = fileName.split("/");
		const discPart = sanitize(`Disc ${opts.volumeNumber || 1}`);
		parts.splice(parts.length - 1, 0, discPart); // inserta antes del último segmento (el archivo)
		fileName = parts.join("/");
	}

	return fileName;
};
