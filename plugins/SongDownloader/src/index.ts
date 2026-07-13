/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { Tracer, type LunaUnload } from "@luna/core";
import { Album, ContextMenu, MediaItem, safeInterval, StyleTag } from "@luna/lib";

import { buildFileName, getDownloadFolder, getDownloadPath } from "./helpers";
import { getFeaturedContributors } from "./contributors";
import { cleanTitle, orderArtists } from "./tags";
import { dedupAlbums, getArtistAlbums, sortAlbumsOldestFirst } from "./artist";
import { downloadTrack, getProgress } from "./download.native";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (maxSeconds: number) => sleep(Math.random() * Math.max(0, maxSeconds) * 1000);

type Button = ReturnType<typeof ContextMenu.addButton>;

/**
 * Descarga UN mediaItem con la convención de tags/nombres del usuario.
 * Reusable por la descarga de colección (álbum/playlist/track) Y por la de
 * artista completo. `prefix` se antepone al texto de estado del botón (para
 * mostrar "[álbum i/N · track j] ..." en la descarga de artista).
 */
const downloadMediaItem = async (mediaItem: MediaItem, downloadFolder: string | undefined, button: Button, prefix = ""): Promise<void> => {
	const setText = (t: string) => (button.text = `${prefix}${t}`);

	if (settings.useRealMAX) {
		setText(`Checking RealMax...`);
		mediaItem = (await mediaItem.max()) ?? mediaItem;
	}

	// 1. Tags base de Luna (title, album, isrc, upc, replaygain, cover, ...)
	setText(`Loading tags...`);
	const { tags, coverUrl } = await mediaItem.flacTags();

	// 2. Orden de artistas (MAIN ordenados + FEATURED ordenados) + featured extra
	//    desde /contributors (convención propia del usuario).
	setText(settings.fetchFeatured ? `Fetching contributors...` : `Loading tags...`);
	const rawArtists = (mediaItem.tidalItem.artists ?? []).map((a) => ({ name: a.name, type: a.type }));
	const featuredExtra = settings.fetchFeatured ? await getFeaturedContributors(mediaItem.id) : [];
	const ordered = orderArtists(rawArtists, featuredExtra);

	// 3. Override de tags según la convención propia del usuario.
	//    El título se limpia pasándole la lista de artistas: así quita el sufijo
	//    "(with X)"/"(feat. X)" solo si X ya está en {artist}, sin duplicarlo.
	if (ordered.all.length > 0) tags.artist = ordered.all;
	tags.title = cleanTitle(mediaItem.tidalItem.title, mediaItem.tidalItem.version, ordered.all);

	// 3b. Fecha del ÁLBUM para {year}/{date} (nunca por-track; evita fragmentar compilaciones).
	const album = await mediaItem.album().catch(() => undefined);
	const albumDate = album?.releaseDate;
	if (albumDate) {
		tags.date = albumDate;
		tags.year = album!.releaseYear ?? (/^\d{4}/.test(albumDate) ? albumDate.slice(0, 4) : tags.year);
	}

	// 3c. {albumArtist} = SOLO el artista principal del álbum (no la lista completa).
	const mainAlbumArtist = album?.tidalAlbum.artist?.name ?? (Array.isArray(tags.albumArtist) ? tags.albumArtist[0] : tags.albumArtist);
	if (mainAlbumArtist) tags.albumArtist = [mainAlbumArtist];

	// 3d. {album} = título RAW de TIDAL (no el de MusicBrainz que Luna prefiere),
	//     quitándole "(Explicit)"/"(E)" como hace tiddl (generate_template_data).
	const rawAlbumTitle = album?.tidalAlbum.title ?? mediaItem.tidalItem.album?.title;
	if (rawAlbumTitle) tags.album = rawAlbumTitle.replace(/\s*\(\s*(?:Explicit|E)\s*\)/gi, "").trim();

	// 4. Nombre de archivo (fullwidth + separador + cap + padding + multidisco)
	setText(`Fetching filename...`);
	const ext = await mediaItem.fileExtension(settings.downloadQuality);
	const fileName = buildFileName(settings.pathFormat, ext, tags, ordered.all, tags.albumArtist, {
		separator: settings.artistSeparator,
		useFullwidth: settings.useFullwidth,
		maxArtistsInName: settings.maxArtistsInName,
		trackNumberPadding: settings.trackNumberPadding,
		discSubfolder: settings.discSubfolder,
		numberOfVolumes: album?.tidalAlbum.numberOfVolumes ?? 1,
		volumeNumber: mediaItem.tidalItem.volumeNumber ?? 1,
		explicit: mediaItem.tidalItem.explicit ?? false,
	});

	// 5. Ruta destino
	const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
	if (path === undefined) return;

	// 6. Sidecar .lrc
	let lrc: string | undefined;
	if (settings.saveLrc) {
		const lyrics = await mediaItem.lyrics().catch(() => undefined);
		lrc = lyrics?.subtitles ?? undefined;
	}

	// 7. Descarga nativa con progreso
	const playbackInfo = await mediaItem.playbackInfo(settings.downloadQuality);
	if (playbackInfo === undefined) {
		trace.msg.err(`Track ${tags.title} is not available for download`);
		return;
	}

	setText(`Downloading...`);
	const trackKey = String(mediaItem.id);
	const clearInterval = safeInterval(
		unloads,
		async () => {
			try {
				const progress = await getProgress(trackKey);
				if (progress === undefined) return;
				const { total, downloaded } = progress;
				if (!total || downloaded === undefined) return;
				const el = button.elem;
				const percent = (downloaded / total) * 100;
				if (el !== undefined) el.style.setProperty("--progress", `${percent}%`);
				const downloadedMB = (downloaded / 1048576).toFixed(0);
				const totalMB = (total / 1048576).toFixed(0);
				setText(`Downloading... ${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%`);
			} catch {
				/* lectura de progreso falló (IPC); ignorar */
			}
		},
		250,
	);
	await downloadTrack(trackKey, playbackInfo, path, tags, coverUrl, lrc).catch(trace.msg.err.withContext(`Failed to download ${tags.title}`));
	clearInterval();
};

export { Settings } from "./Settings";

// ── Descarga de colección: track / álbum / playlist ──────────────────────────
const downloadButton = ContextMenu.addButton(unloads);
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		const downloadFolder = settings.defaultPath ?? (trackCount > 1 ? await getDownloadFolder() : undefined);
		downloadButton.elem.classList.add("download-button");
		for await (const mediaItem of await mediaCollection.mediaItems()) {
			await downloadMediaItem(mediaItem, downloadFolder, downloadButton);
		}
		downloadButton.text = defaultText;
		downloadButton.elem.classList.remove("download-button");
	});

	await downloadButton.show(contextMenu);
});

// ── Descarga de ARTISTA completo ─────────────────────────────────────────────
// El menú de artista no dispara onMediaItem (solo track/álbum/playlist), así que
// usamos ContextMenu.onOpen y filtramos event.type === "ARTIST".
const artistButton = ContextMenu.addButton(unloads);
ContextMenu.onOpen(unloads, async ({ event, contextMenu }) => {
	if ((event as { type?: string })?.type !== "ARTIST") return;
	const artistId = (event as { id?: redux_ItemId }).id;
	if (artistId === undefined) return;

	artistButton.text = `Download artist`;
	artistButton.onClick(async () => {
		if (artistButton.elem === undefined) return;
		// La descarga de artista SIEMPRE necesita una carpeta base (son cientos de
		// tracks; nunca preguntar ruta por cada uno).
		const folder = settings.defaultPath ?? (await getDownloadFolder());
		if (folder === undefined) return;

		artistButton.elem.classList.add("download-button");
		try {
			artistButton.text = `Fetching discography...`;
			let albums = await getArtistAlbums(artistId, settings.artistIncludeSingles);
			if (settings.artistDedup) albums = dedupAlbums(albums);
			albums = sortAlbumsOldestFirst(albums);

			if (albums.length === 0) {
				artistButton.text = `No albums found`;
				return;
			}

			for (let i = 0; i < albums.length; i++) {
				const album = await Album.fromId(albums[i].id).catch(() => undefined);
				if (album === undefined) continue;

				let j = 0;
				for await (const mediaItem of await album.mediaItems()) {
					j++;
					const prefix = `[${i + 1}/${albums.length} · ${j}] `;
					await downloadMediaItem(mediaItem, folder, artistButton, prefix).catch(
						trace.msg.err.withContext(`Artist download (album ${albums[i].title})`),
					);
					if (settings.artistTrackDelay > 0) await jitter(settings.artistTrackDelay);
				}
				if (settings.artistAlbumDelay > 0) await jitter(settings.artistAlbumDelay);
			}
			artistButton.text = `Done`;
		} finally {
			artistButton.elem?.classList.remove("download-button");
			setTimeout(() => (artistButton.text = `Download artist`), 3000);
		}
	});

	await artistButton.show(contextMenu);
});

// Alias de tipo local para el id del evento (redux.ItemId sin importar todo redux).
type redux_ItemId = string | number;
