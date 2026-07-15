/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { TidalApi, type redux } from "@luna/lib";

import { trace } from "./index";

/**
 * Discografía de un artista + deduplicación de ediciones.
 *
 * Luna no expone un método para listar los álbumes de un artista, así que se
 * pega directo a `desktop.tidal.com/v1/artists/{id}/albums` (misma sesión
 * legítima del cliente, vía TidalApi.fetch — mismo patrón que contributors.ts).
 * El dedup replica el artist download de tiddl-elvigilante (agrupa por
 * title+type+version+explicit y se queda con la mejor calidad).
 */

export type ApiAlbum = {
	id: redux.ItemId;
	title: string;
	type?: string;
	version?: string | null;
	explicit?: boolean;
	releaseDate?: string;
	audioQuality?: string;
	mediaMetadata?: { tags?: string[] };
};
type ArtistAlbumsResponse = { items?: ApiAlbum[]; totalNumberOfItems?: number; limit?: number; offset?: number };

const PAGE = 50;

const fetchAlbumsPage = (artistId: redux.ItemId, filter: string, offset: number) =>
	TidalApi.fetch<ArtistAlbumsResponse>(
		`https://desktop.tidal.com/v1/artists/${artistId}/albums?${TidalApi.queryArgs()}&filter=${filter}&limit=${PAGE}&offset=${offset}`,
	);

/** Trae TODOS los álbumes del artista (paginado). `includeSingles` añade una
 * segunda pasada con filter=EPSANDSINGLES.
 *
 * NO se pide filter=COMPILATIONS: en TIDAL esa categoría trae cientos de
 * recopilatorios de TERCEROS donde el artista solo aparece en un track (p.ej.
 * Bonnie Tyler tenía 215: "Club Hits 2026", "Rugby World Cup 2023"...), así que
 * bajaría álbumes ajenos completos por una canción. Los álbumes en vivo del
 * propio artista NO se pierden: TIDAL los clasifica en ALBUMS (type=ALBUM),
 * verificado empíricamente. */
export const getArtistAlbums = async (artistId: redux.ItemId, includeSingles: boolean): Promise<ApiAlbum[]> => {
	const all: ApiAlbum[] = [];
	const filters = includeSingles ? ["ALBUMS", "EPSANDSINGLES"] : ["ALBUMS"];
	for (const filter of filters) {
		let offset = 0;
		while (true) {
			const resp = await fetchAlbumsPage(artistId, filter, offset).catch(trace.err.withContext(`getArtistAlbums(${artistId}, ${filter})`));
			const items = resp?.items ?? [];
			all.push(...items);
			const total = resp?.totalNumberOfItems ?? 0;
			offset += resp?.limit ?? PAGE;
			if (items.length === 0 || offset >= total) break;
		}
	}
	return all;
};

/** Puntaje de calidad de un álbum (HiRes=3, Lossless=2, High=1) — tiddl get_album_score. */
export const getAlbumScore = (a: ApiAlbum): number => {
	let score = 0;
	const aq = (a.audioQuality ?? "").toUpperCase();
	if (aq.includes("HI_RES") || aq.includes("HIRES")) score = 3;
	else if (aq.includes("LOSSLESS")) score = 2;
	else if (aq.includes("HIGH")) score = 1;
	const tags = (a.mediaMetadata?.tags ?? []).map((t) => t.toUpperCase());
	if (tags.includes("HIRES_LOSSLESS")) score = Math.max(score, 3);
	else if (tags.includes("LOSSLESS")) score = Math.max(score, 2);
	return score;
};

/** Deduplica ediciones del mismo álbum (title+type+version+explicit), quedándose
 * con la de mejor calidad. Igual que el artist download de tiddl. */
export const dedupAlbums = (albums: ApiAlbum[]): ApiAlbum[] => {
	const map = new Map<string, ApiAlbum>();
	for (const a of albums) {
		const key = [a.title.trim().toLowerCase(), a.type ?? "", (a.version ?? "").trim().toLowerCase(), a.explicit ?? false].join("|");
		const cur = map.get(key);
		if (cur === undefined || getAlbumScore(a) > getAlbumScore(cur)) map.set(key, a);
	}
	return [...map.values()];
};

/** Ordena oldest-first por releaseDate (los sin fecha al final), como tiddl. */
export const sortAlbumsOldestFirst = (albums: ApiAlbum[]): ApiAlbum[] =>
	[...albums].sort((a, b) => (a.releaseDate ?? "9999-99-99").localeCompare(b.releaseDate ?? "9999-99-99"));
