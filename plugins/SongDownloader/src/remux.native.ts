/*
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │   Song Downloader (ElVigilante) — Luna Plugin Store          │
 *  └──────────────────────────────────────────────────────────────┘
 *  https://github.com/np3ir/songdownloader-store
 *  © ElVigilante · AGPL-3.0 · fork of Inrixia/luna-plugins (SongDownloader)
 */
import { ALL_FORMATS, BufferSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from "mediabunny";

import { readFile, rename, writeFile } from "fs/promises";

/**
 * Remux fMP4 (DASH/CMAF) → MP4 progresivo, JS puro (sin ffmpeg).
 *
 * Las descargas DASH de TIDAL salen como concatenación cruda de segmentos CMAF:
 * un MP4 FRAGMENTADO. node-taglib-sharp NO puede taggear eso (revienta en
 * save()), y algunos reproductores/software de DJ tampoco lo tragan bien.
 * Este módulo lo reescribe como MP4 progresivo estándar:
 *
 *   1. mediabunny copia los paquetes AAC bit-idénticos (sin recodificar).
 *   2. Se replica el edit list (elst) del origen — el encoder delay de AAC
 *      (típicamente 2048 samples) — para que el audio decodificado quede
 *      idéntico sample a sample y el gapless no se rompa (mediabunny solo
 *      no lo preserva). También se recortan las duraciones mvhd/tkhd.
 *   3. Se inserta un esqueleto udta>meta>hdlr(mdir)>ilst VACÍO: taglib
 *      (hasta 6.0.3 al menos) crashea guardando MP4s sin ilst de Apple
 *      (Mpeg4File.save deref de parentTree undefined) — ESTE era el bug
 *      que dejaba nuestros m4a sin tags, validado 2026-07-13 con descarga
 *      real (Historia de Taxi: packets y PCM decodificado MD5-idénticos).
 *
 * Escribe a .tmp y renombra al final: si algo falla, la descarga cruda
 * queda intacta.
 */

// #region Helpers de cajas MP4
type Box = { type: string; start: number; size: number };

/** Itera las cajas de buf entre [start, end) */
const listBoxes = (buf: Buffer, start: number, end: number): Box[] => {
	const boxes: Box[] = [];
	let pos = start;
	while (pos + 8 <= end) {
		let size: number = buf.readUInt32BE(pos);
		if (size === 1) size = Number(buf.readBigUInt64BE(pos + 8));
		else if (size === 0) size = end - pos;
		boxes.push({ type: buf.toString("latin1", pos + 4, pos + 8), start: pos, size });
		pos += size;
	}
	return boxes;
};

const findBox = (buf: Buffer, start: number, end: number, type: string): Box | undefined =>
	listBoxes(buf, start, end).find((box) => box.type === type);

/** Desciende una ruta de cajas contenedoras, ej. ["mdia", "minf", "stbl"] */
const findPath = (buf: Buffer, start: number, end: number, path: string[]): Box | undefined => {
	let box: Box | undefined = undefined;
	for (const type of path) {
		box = findBox(buf, start, end, type);
		if (box === undefined) return undefined;
		start = box.start + 8;
		end = box.start + box.size;
	}
	return box;
};

/** Lee el media_time del primer entry del elst del origen (encoder delay), si hay */
const readMediaTime = (buf: Buffer): number | undefined => {
	const moov = findBox(buf, 0, buf.length, "moov");
	if (moov === undefined) return undefined;
	const elst = findPath(buf, moov.start + 8, moov.start + moov.size, ["trak", "edts", "elst"]);
	if (elst === undefined) return undefined;
	const version = buf.readUInt8(elst.start + 8);
	const entryCount = buf.readUInt32BE(elst.start + 12);
	if (entryCount < 1) return undefined;
	const mediaTime = version === 1 ? Number(buf.readBigInt64BE(elst.start + 16 + 8)) : buf.readInt32BE(elst.start + 16 + 4);
	return mediaTime > 0 ? mediaTime : undefined;
};

type FullBoxTimes = { version: number; timescale?: number; duration: number; durationOffset: number };

/** Lee timescale+duration (y el offset del campo duration) de un fullbox mvhd/tkhd/mdhd */
const readTimes = (buf: Buffer, box: Box): FullBoxTimes => {
	const version = buf.readUInt8(box.start + 8);
	const base = box.start + 12;
	if (box.type === "mvhd" || box.type === "mdhd") {
		const timescaleOffset = version === 1 ? base + 16 : base + 8;
		const durationOffset = timescaleOffset + 4;
		return {
			version,
			timescale: buf.readUInt32BE(timescaleOffset),
			duration: version === 1 ? Number(buf.readBigUInt64BE(durationOffset)) : buf.readUInt32BE(durationOffset),
			durationOffset,
		};
	}
	// tkhd: creation, modification, track_id, reserved, duration
	const durationOffset = version === 1 ? base + 24 : base + 16;
	return {
		version,
		duration: version === 1 ? Number(buf.readBigUInt64BE(durationOffset)) : buf.readUInt32BE(durationOffset),
		durationOffset,
	};
};

const writeDuration = (buf: Buffer, times: FullBoxTimes, value: number): void => {
	if (times.version === 1) buf.writeBigUInt64BE(BigInt(value), times.durationOffset);
	else buf.writeUInt32BE(value, times.durationOffset);
};

/** edts { elst v0 [ segment_duration, media_time, rate 1.0 ] } */
const buildEdts = (segmentDuration: number, mediaTime: number): Buffer => {
	const edts = Buffer.alloc(36);
	edts.writeUInt32BE(36, 0);
	edts.write("edts", 4, "latin1");
	edts.writeUInt32BE(28, 8);
	edts.write("elst", 12, "latin1");
	edts.writeUInt32BE(0, 16); // version 0, flags 0
	edts.writeUInt32BE(1, 20); // entry_count
	edts.writeUInt32BE(segmentDuration, 24);
	edts.writeInt32BE(mediaTime, 28);
	edts.writeUInt16BE(1, 32); // media_rate_integer
	edts.writeUInt16BE(0, 34); // media_rate_fraction
	return edts;
};

/** Esqueleto vacío udta > meta > hdlr(mdir/appl) > ilst (workaround del bug de taglib) */
const buildUdta = (): Buffer => {
	const udta = Buffer.alloc(61);
	udta.writeUInt32BE(61, 0);
	udta.write("udta", 4, "latin1");
	udta.writeUInt32BE(53, 8);
	udta.write("meta", 12, "latin1");
	udta.writeUInt32BE(0, 16); // meta version/flags
	udta.writeUInt32BE(33, 20);
	udta.write("hdlr", 24, "latin1");
	udta.writeUInt32BE(0, 28); // hdlr version/flags
	udta.writeUInt32BE(0, 32); // pre_defined
	udta.write("mdir", 36, "latin1");
	udta.write("appl", 40, "latin1");
	// 8 bytes reserved + 1 byte de nombre vacío, ya en cero
	udta.writeUInt32BE(8, 53);
	udta.write("ilst", 57, "latin1");
	return udta;
};

/**
 * Inserta el edts/elst en el trak del output replicando el encoder delay del
 * origen (recortando mvhd/tkhd a la duración de presentación) y agrega el udta
 * vacío. El muxer pone el moov ANTES del mdat, así que los chunk offsets
 * (stco/co64) se corren por los bytes insertados.
 */
const patchMoov = (buf: Buffer, mediaTime?: number): Buffer => {
	const moov = findBox(buf, 0, buf.length, "moov");
	const mdat = findBox(buf, 0, buf.length, "mdat");
	if (moov === undefined || mdat === undefined) throw new Error("Muxed file is missing moov/mdat");

	const trak = findBox(buf, moov.start + 8, moov.start + moov.size, "trak");
	const tkhd = trak && findBox(buf, trak.start + 8, trak.start + trak.size, "tkhd");
	const mvhd = findBox(buf, moov.start + 8, moov.start + moov.size, "mvhd");
	const mdhd = trak && findPath(buf, trak.start + 8, trak.start + trak.size, ["mdia", "mdhd"]);
	if (!trak || !tkhd || !mvhd || !mdhd) throw new Error("Muxed file is missing moov children");

	let edts: Buffer | undefined;
	if (mediaTime !== undefined && findBox(buf, trak.start + 8, trak.start + trak.size, "edts") === undefined) {
		const movie = readTimes(buf, mvhd);
		const media = readTimes(buf, mdhd);
		const track = readTimes(buf, tkhd);
		// Duración de presentación = duración del media menos el encoder delay, en timescale del movie
		const presentation = Math.round(((media.duration - mediaTime) * movie.timescale!) / media.timescale!);
		if (presentation > 0 && presentation <= 0xffffffff) {
			writeDuration(buf, movie, presentation);
			writeDuration(buf, track, presentation);
			edts = buildEdts(presentation, mediaTime);
		}
	}
	const udta = buildUdta();
	const inserted = (edts?.length ?? 0) + udta.length;

	// Crecer el moov corre el mdat: corregir los chunk offsets
	if (moov.start < mdat.start) {
		const stbl = findPath(buf, trak.start + 8, trak.start + trak.size, ["mdia", "minf", "stbl"]);
		const table = stbl && (findBox(buf, stbl.start + 8, stbl.start + stbl.size, "stco") ?? findBox(buf, stbl.start + 8, stbl.start + stbl.size, "co64"));
		if (table === undefined) throw new Error("Muxed file is missing stco/co64");
		const entryCount = buf.readUInt32BE(table.start + 12);
		for (let i = 0; i < entryCount; i++) {
			if (table.type === "stco") {
				const at = table.start + 16 + i * 4;
				buf.writeUInt32BE(buf.readUInt32BE(at) + inserted, at);
			} else {
				const at = table.start + 16 + i * 8;
				buf.writeBigUInt64BE(buf.readBigUInt64BE(at) + BigInt(inserted), at);
			}
		}
	}

	// El edts va justo después del tkhd, el udta al final del moov; ambos crecen el moov
	const edtsAt = tkhd.start + tkhd.size;
	const udtaAt = moov.start + moov.size;
	buf.writeUInt32BE(moov.size + inserted, moov.start);
	if (edts !== undefined) buf.writeUInt32BE(trak.size + edts.length, trak.start);
	return Buffer.concat(edts !== undefined ? [buf.subarray(0, edtsAt), edts, buf.subarray(edtsAt, udtaAt), udta, buf.subarray(udtaAt)] : [buf.subarray(0, udtaAt), udta, buf.subarray(udtaAt)]);
};
// #endregion

/** Remux in-place: reemplaza el fMP4 crudo por un MP4 progresivo taggeable */
export const remuxToProgressive = async (path: string): Promise<void> => {
	const source = await readFile(path);

	const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(source) });
	const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
	await (await Conversion.init({ input, output })).execute();

	const muxed = patchMoov(Buffer.from(output.target.buffer!), readMediaTime(source));

	// Reemplaza la descarga cruda solo si el remux completó bien
	const tmpPath = `${path}.tmp`;
	await writeFile(tmpPath, muxed);
	await rename(tmpPath, path);
};
