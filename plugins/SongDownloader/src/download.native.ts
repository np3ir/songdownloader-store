import type { PlaybackInfo } from "@luna/lib";
import { fetchMediaItemStream, type FetchProgress } from "@luna/lib.native";

import { createWriteStream } from "fs";
import { access, constants, mkdir, unlink, writeFile } from "fs/promises";
import { join, parse } from "path";
import { pipeline } from "stream/promises";

import { tagM4a } from "./m4a.native";

/**
 * Descarga con tags custom. Replica lib/MediaItem.download.native.ts pero
 * recibe un tagMap ya construido por el plugin (con la convención PROPIA del
 * usuario: separador, featured de /contributors, orden de artistas — mods de su
 * fork tiddl-elvigilante, no de tiddl upstream) en vez de usar el makeTags por
 * defecto de Luna. También escribe el sidecar .lrc.
 *
 * Dos ramas de tagging según el manifest:
 *   - FLAC (`application/vnd.tidal.bts`): el FlacStreamTagger de Luna aplica el
 *     tagMap durante el stream (rápido, en vuelo).
 *   - DASH/m4a (`application/dash+xml`): el stream sale crudo, así que se taggea
 *     POST-descarga con node-taglib-sharp (ver m4a.native.ts). Esto cierra el
 *     gap que tenía el core de Luna (m4a sin tags).
 */

type TagMap = Record<string, string | string[] | undefined | null>;

// Progreso vivo consultable desde render (mismo patrón que la lib)
const downloads: Record<string, { progress: FetchProgress } | undefined> = {};
export const getProgress = async (trackId: string): Promise<FetchProgress | undefined> => downloads[trackId]?.progress;

/** El FlacStreamTagger espera Record<string, string | string[]> sin huecos.
 * flacTags() trae campos undefined; los descartamos (también los strings
 * vacíos, que ensuciarían los Vorbis comments). */
const cleanTags = (tags: TagMap): Record<string, string | string[]> => {
	const out: Record<string, string | string[]> = {};
	for (const [k, v] of Object.entries(tags)) {
		if (v === undefined || v === null) continue;
		if (Array.isArray(v)) {
			const arr = v.filter((x) => x !== undefined && x !== null && x !== "");
			if (arr.length > 0) out[k] = arr;
		} else if (v !== "") {
			out[k] = v;
		}
	}
	return out;
};

const fileExists = async (path: string): Promise<boolean> => {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
};

export const downloadTrack = async (
	trackId: string,
	playbackInfo: PlaybackInfo,
	path: string | string[],
	tags: TagMap,
	coverUrl?: string,
	lrc?: string,
): Promise<{ path: string; skipped: boolean }> => {
	if (Array.isArray(path)) path = join(...path);
	const parsed = parse(path);
	const finalPath = join(parsed.dir, parsed.base);

	// No re-descargar si ya existe (dedup por ruta, igual que la lib y su fork)
	if (await fileExists(finalPath)) {
		// Aun así, escribe el .lrc si falta y lo pidieron
		if (lrc && lrc.trim().length > 0) {
			const lrcPath = join(parsed.dir, `${parsed.name}.lrc`);
			if (!(await fileExists(lrcPath))) await writeFile(lrcPath, lrc, "utf8").catch(() => {});
		}
		return { path: finalPath, skipped: true };
	}

	await mkdir(parsed.dir, { recursive: true });

	// FLAC = tags en el stream; DASH/m4a = stream crudo + tag post-descarga
	const isFlac = playbackInfo.manifestMimeType === "application/vnd.tidal.bts";

	const progress: FetchProgress = { total: 0, downloaded: 0 };
	downloads[trackId] = { progress };
	try {
		const streamOpts = isFlac ? { progress, tags: { tags: cleanTags(tags), coverUrl } } : { progress };
		const stream = await fetchMediaItemStream(playbackInfo, streamOpts);
		const writeStream = createWriteStream(finalPath);

		// pipeline() engancha handlers de error a AMBOS streams y los destruye si
		// algo falla. Con el `.pipe().on("error")` anterior, un error del stream
		// FUENTE (p.ej. 403 del CDN) quedaba sin listener -> ERR_UNHANDLED_ERROR
		// que crasheaba el proceso main de Electron ("reply was never sent").
		try {
			await pipeline(stream, writeStream);
		} catch (err) {
			// Borra el archivo parcial/0 bytes para que un reintento no lo "salte"
			// como si ya existiera.
			await unlink(finalPath).catch(() => {});
			throw err;
		}

		// m4a: el stream salió sin tags, los escribimos ahora (best-effort)
		if (!isFlac) {
			await tagM4a(finalPath, tags, coverUrl).catch(() => {});
		}

		if (lrc && lrc.trim().length > 0) {
			const lrcPath = join(parsed.dir, `${parsed.name}.lrc`);
			await writeFile(lrcPath, lrc, "utf8").catch(() => {});
		}

		return { path: finalPath, skipped: false };
	} finally {
		delete downloads[trackId];
	}
};
