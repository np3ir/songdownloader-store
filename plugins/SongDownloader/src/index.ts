/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, MediaItem, Playlist, safeInterval, StyleTag, TidalApi, type redux } from "@luna/lib";

import { buildFileName, getDownloadFolder, getDownloadPath } from "./helpers";
import { getFeaturedContributors } from "./contributors";
import { cleanTitle, orderArtists } from "./tags";
import { dedupAlbums, getArtistAlbums, sortAlbumsOldestFirst } from "./artist";
import { downloadState } from "./cancel";
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
const downloadMediaItem = async (mediaItem: MediaItem, downloadFolder: string | undefined, button: Button, prefix = ""): Promise<boolean> => {
	const setText = (t: string) => (button.text = `${prefix}${t}`);
	try {
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
	if (path === undefined) return false;

	// 6. Sidecar .lrc
	let lrc: string | undefined;
	if (settings.saveLrc) {
		const lyrics = await mediaItem.lyrics().catch(() => undefined);
		lrc = lyrics?.subtitles ?? undefined;
	}

	// 7. Descarga nativa con progreso
	const playbackInfo = await mediaItem.playbackInfo(settings.downloadQuality);
	if (playbackInfo === undefined) {
		trace.err(`Track not available: ${tags.title}`); // callado (sin toast)
		return false;
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
	try {
		await downloadTrack(trackKey, playbackInfo, path, tags, coverUrl, lrc);
	} finally {
		clearInterval();
	}
	return true;
	} catch (err) {
		// Falla callada (sin toast): un track malo no debe spamear popups ni parar
		// el bulk. Se registra en consola y se cuenta en el resumen final.
		trace.err.withContext(`Failed to download`)(err);
		return false;
	}
};

type AlbumItemsResponse = { items?: redux.MediaItem[]; totalNumberOfItems?: number; limit?: number; offset?: number };

/**
 * Tracks de un álbum vía `albums/{id}/items` (paginado) con el countryCode REAL
 * de la sesión. NO se usa Album.mediaItems() del core: su TidalApi.albumItems
 * pega a pages/album con countryCode=NZ hardcodeado y devuelve undefined para
 * álbumes no licenciados en NZ — el álbum se saltaría en silencio.
 */
const albumTMediaItems = async (albumId: redux_ItemId): Promise<redux.MediaItem[]> => {
	const all: redux.MediaItem[] = [];
	let offset = 0;
	while (true) {
		const page = await TidalApi.fetch<AlbumItemsResponse>(
			`https://desktop.tidal.com/v1/albums/${albumId}/items?${TidalApi.queryArgs()}&limit=100&offset=${offset}`,
		).catch(trace.err.withContext(`albumTMediaItems(${albumId})`));
		const items = page?.items ?? [];
		all.push(...items);
		const total = page?.totalNumberOfItems ?? 0;
		// Avanzar por lo RECIBIDO, nunca por el limit que el API dice aceptar:
		// si el echo del limit difiere (o es 0), offset se quedaría fijo pidiendo
		// la misma página (memoizada = instantánea) en un loop infinito -> OOM.
		offset += items.length;
		if (items.length === 0 || offset >= total || all.length >= total) break;
	}
	return all;
};

/**
 * Descarga una lista de álbumes completos (por id) a `folder`, con contadores,
 * delays anti-bot y cancelación. Reusado por la descarga de artista completo y
 * por el botón "Download full albums" de playlists.
 */
const downloadAlbumList = async (albumIds: redux_ItemId[], folder: string, button: Button): Promise<{ ok: number; failed: number }> => {
	let ok = 0;
	let failed = 0;
	for (let i = 0; i < albumIds.length && !downloadState.cancel; i++) {
		const tItems = await albumTMediaItems(albumIds[i]);
		if (tItems.length === 0) continue; // álbum muerto en catálogo (404) o vacío

		let j = 0;
		for await (const mediaItem of MediaItem.fromTMediaItems(tItems)) {
			if (downloadState.cancel) break;
			if (mediaItem.contentType !== "track") continue; // saltar videos (no soportados)
			j++;
			const prefix = `[${i + 1}/${albumIds.length} · ${j}] `;
			const success = await downloadMediaItem(mediaItem, folder, button, prefix);
			if (success) ok++;
			else failed++;
			if (downloadState.cancel) break;
			if (settings.artistTrackDelay > 0) await jitter(settings.artistTrackDelay);
		}
		if (!downloadState.cancel && settings.artistAlbumDelay > 0) await jitter(settings.artistAlbumDelay);
	}
	return { ok, failed };
};

export { Settings } from "./Settings";

// ── Descarga de colección: track / álbum / playlist ──────────────────────────
const downloadButton = ContextMenu.addButton(unloads);
const fullAlbumsButton = ContextMenu.addButton(unloads);
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		// Re-click mientras hay una descarga en curso = detenerla.
		if (downloadState.active) {
			downloadState.cancel = true;
			downloadButton.text = `Stopping...`;
			return;
		}
		const downloadFolder = settings.defaultPath ?? (trackCount > 1 ? await getDownloadFolder() : undefined);
		downloadState.active = true;
		downloadState.cancel = false;
		downloadButton.elem.classList.add("download-button");
		try {
			for await (const mediaItem of await mediaCollection.mediaItems()) {
				if (downloadState.cancel) break;
				if (mediaItem.contentType !== "track") continue; // saltar videos (no soportados)
				await downloadMediaItem(mediaItem, downloadFolder, downloadButton);
			}
		} finally {
			downloadState.active = false;
			downloadState.cancel = false;
			downloadButton.text = defaultText;
			downloadButton.elem?.classList.remove("download-button");
		}
	});

	await downloadButton.show(contextMenu);

	// Botón adicional SOLO para playlists: descargar los álbumes COMPLETOS a los
	// que pertenecen los tracks de la playlist (issue #130 de luna-plugins).
	if (mediaCollection instanceof Playlist) {
		const albumsDefaultText = (fullAlbumsButton.text = `Download full albums`);

		fullAlbumsButton.onClick(async () => {
			if (fullAlbumsButton.elem === undefined) return;
			// Re-click mientras hay una descarga en curso = detenerla.
			if (downloadState.active) {
				downloadState.cancel = true;
				fullAlbumsButton.text = `Stopping...`;
				return;
			}
			// Siempre carpeta base: una playlist de N tracks puede convertirse en N
			// álbumes (cientos de tracks); nunca preguntar ruta por cada uno.
			const folder = settings.defaultPath ?? (await getDownloadFolder());
			if (folder === undefined) return;

			downloadState.active = true;
			downloadState.cancel = false;
			fullAlbumsButton.elem.classList.add("download-button");
			try {
				fullAlbumsButton.text = `Collecting albums...`;
				// Items CRUDOS de la playlist (tMediaItems): el id de álbum ya viene en
				// cada track, sin construir un MediaItem (+fetch de calidad) por track.
				const albumIds: redux_ItemId[] = [];
				const seen = new Set<redux_ItemId>();
				for (const tItem of await mediaCollection.tMediaItems()) {
					if (tItem?.type !== "track") continue; // saltar videos (no soportados)
					const albumId = tItem.item.album?.id;
					if (albumId === undefined || seen.has(albumId)) continue;
					seen.add(albumId);
					albumIds.push(albumId);
				}

				if (albumIds.length === 0) {
					fullAlbumsButton.text = `No albums found`;
					return;
				}

				const { ok, failed } = await downloadAlbumList(albumIds, folder, fullAlbumsButton);
				const summary = `${ok} ok${failed ? `, ${failed} failed` : ""}`;
				fullAlbumsButton.text = downloadState.cancel ? `Stopped (${summary})` : `Done — ${summary}`;
			} finally {
				downloadState.active = false;
				downloadState.cancel = false;
				fullAlbumsButton.elem?.classList.remove("download-button");
				setTimeout(() => (fullAlbumsButton.text = albumsDefaultText), 3000);
			}
		});

		await fullAlbumsButton.show(contextMenu);
	}
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
		// Re-click mientras hay una descarga en curso = detenerla.
		if (downloadState.active) {
			downloadState.cancel = true;
			artistButton.text = `Stopping...`;
			return;
		}
		// La descarga de artista SIEMPRE necesita una carpeta base (son cientos de
		// tracks; nunca preguntar ruta por cada uno).
		const folder = settings.defaultPath ?? (await getDownloadFolder());
		if (folder === undefined) return;

		downloadState.active = true;
		downloadState.cancel = false;
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

			const { ok, failed } = await downloadAlbumList(
				albums.map((a) => a.id),
				folder,
				artistButton,
			);
			const summary = `${ok} ok${failed ? `, ${failed} failed` : ""}`;
			artistButton.text = downloadState.cancel ? `Stopped (${summary})` : `Done — ${summary}`;
		} finally {
			downloadState.active = false;
			downloadState.cancel = false;
			artistButton.elem?.classList.remove("download-button");
			setTimeout(() => (artistButton.text = `Download artist`), 3000);
		}
	});

	const artistElem = await artistButton.show(contextMenu);
	enableClonedButton(artistElem);
});

/**
 * El ContextMenuButton clona un ítem del menú; en el menú de artista ese ítem
 * viene "disabled" y el clon hereda el estilo gris. Le quitamos el estado
 * disabled (atributo + aria + dimming inline) para que se vea/comporte como
 * los demás ítems. El onclick ya funciona; esto es solo cosmético.
 */
const enableClonedButton = (span: HTMLElement | undefined) => {
	if (!(span instanceof HTMLElement)) return;
	const nodes: (Element | null | undefined)[] = [
		span,
		span.closest("button"),
		span.closest('div[data-type="contextmenu-item"]'),
		span.parentElement,
		span.parentElement?.parentElement,
	];
	for (const node of nodes) {
		if (!(node instanceof HTMLElement)) continue;
		if (node instanceof HTMLButtonElement) node.disabled = false;
		node.removeAttribute("disabled");
		node.removeAttribute("aria-disabled");
		node.style.opacity = "";
		node.style.pointerEvents = "";
	}
};

// Alias de tipo local para el id del evento (redux.ItemId sin importar todo redux).
type redux_ItemId = string | number;
