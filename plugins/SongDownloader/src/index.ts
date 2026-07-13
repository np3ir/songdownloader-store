import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag } from "@luna/lib";

import { buildFileName, getDownloadFolder, getDownloadPath } from "./helpers";
import { getFeaturedContributors } from "./contributors";
import { cleanTitle, orderArtists } from "./tags";
import { downloadTrack, getProgress } from "./download.native";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const downloadButton = ContextMenu.addButton(unloads);

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		const downloadFolder = settings.defaultPath ?? (trackCount > 1 ? await getDownloadFolder() : undefined);
		downloadButton.elem.classList.add("download-button");
		for await (let mediaItem of await mediaCollection.mediaItems()) {
			if (settings.useRealMAX) {
				downloadButton.text = `Checking RealMax...`;
				mediaItem = (await mediaItem.max()) ?? mediaItem;
			}

			// 1. Tags base de Luna (title, album, isrc, upc, replaygain, cover, ...)
			downloadButton.text = `Loading tags...`;
			const { tags, coverUrl } = await mediaItem.flacTags();

			// 2. Convención propia del usuario (de su fork tiddl-elvigilante, no
			//    upstream): orden de artistas (MAIN ordenados + FEATURED ordenados)
			//    + featured extra desde /contributors.
			downloadButton.text = settings.fetchFeatured ? `Fetching contributors...` : `Loading tags...`;
			const rawArtists = (mediaItem.tidalItem.artists ?? []).map((a) => ({ name: a.name, type: a.type }));
			const featuredExtra = settings.fetchFeatured ? await getFeaturedContributors(mediaItem.id) : [];
			const ordered = orderArtists(rawArtists, featuredExtra);

			// 3. Override de tags según la convención propia del usuario
			if (ordered.all.length > 0) tags.artist = ordered.all;
			tags.title = cleanTitle(mediaItem.tidalItem.title, mediaItem.tidalItem.version);

			// 3b. Normaliza la fecha del ÁLBUM para {year}/{date}: usa SIEMPRE la
			//     fecha del álbum, nunca la fecha por-track. Las compilaciones tienen
			//     fecha distinta por track; makeTags de Luna cae a la fecha por-track
			//     cuando album.releaseYear es null, y eso parte el mismo álbum en
			//     varias carpetas de año (2022/2024/2025...). Igual que tiddl, que
			//     usa album.releaseDate para la carpeta.
			const album = await mediaItem.album().catch(() => undefined);
			const albumDate = album?.releaseDate; // getter Album: releaseDate ?? streamStartDate
			if (albumDate) {
				tags.date = albumDate;
				tags.year = album!.releaseYear ?? (/^\d{4}/.test(albumDate) ? albumDate.slice(0, 4) : tags.year);
			}

			// 3c. {albumArtist} = SOLO el artista principal del álbum (paridad con
			//     tiddl, que usa album.artist.name). Luna pone TODOS los album
			//     artists; en un álbum con muchos colaboradores eso creaba una
			//     carpeta gigante ("KAROL G ／ Feid ／ Maluma ／ ..."). Usamos el
			//     campo singular `artist` del álbum, con fallback al primero.
			const mainAlbumArtist =
				album?.tidalAlbum.artist?.name ?? (Array.isArray(tags.albumArtist) ? tags.albumArtist[0] : tags.albumArtist);
			if (mainAlbumArtist) tags.albumArtist = [mainAlbumArtist];

			// 4. Nombre de archivo (fullwidth + separador + cap de artistas)
			downloadButton.text = `Fetching filename...`;
			const ext = await mediaItem.fileExtension(settings.downloadQuality);
			const fileName = buildFileName(settings.pathFormat, ext, tags, ordered.all, tags.albumArtist, {
				separator: settings.artistSeparator,
				useFullwidth: settings.useFullwidth,
				maxArtistsInName: settings.maxArtistsInName,
			});

			// 5. Ruta destino
			downloadButton.text = `Fetching download path...`;
			const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
			if (path === undefined) return;

			// 6. Sidecar .lrc (subtítulos sincronizados)
			let lrc: string | undefined;
			if (settings.saveLrc) {
				const lyrics = await mediaItem.lyrics().catch(() => undefined);
				lrc = lyrics?.subtitles ?? undefined;
			}

			// 7. Descarga nativa con MIS tags + progreso
			const playbackInfo = await mediaItem.playbackInfo(settings.downloadQuality);
			if (playbackInfo === undefined) {
				trace.msg.err(`Track ${tags.title} is not available for download`);
				continue;
			}

			downloadButton.text = `Downloading...`;
			const trackKey = String(mediaItem.id);
			const clearInterval = safeInterval(
				unloads,
				async () => {
					try {
						const progress = await getProgress(trackKey);
						if (progress === undefined) return;
						const { total, downloaded } = progress;
						if (!total || downloaded === undefined) return;
						const el = downloadButton.elem;
						if (el === undefined) return; // el menú se cerró; no toques un elemento destruido
						const percent = (downloaded / total) * 100;
						el.style.setProperty("--progress", `${percent}%`);
						const downloadedMB = (downloaded / 1048576).toFixed(0);
						const totalMB = (total / 1048576).toFixed(0);
						downloadButton.text = `Downloading... ${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%`;
					} catch {
						/* lectura de progreso falló (IPC); ignorar, nunca romper el flujo */
					}
				},
				250,
			);
			await downloadTrack(trackKey, playbackInfo, path, tags, coverUrl, lrc).catch(
				trace.msg.err.withContext(`Failed to download ${tags.title}`),
			);
			clearInterval();
		}
		downloadButton.text = defaultText;
		downloadButton.elem.classList.remove("download-button");
	});

	await downloadButton.show(contextMenu);
});
