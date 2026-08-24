import { dirname, join, parse, posix, resolve, sep } from "node:path";
import z from "@deepseek-ai/schemastery";
import { AttachmentError, AttachmentId, AttachmentStore } from "@deepseek-ai/dsh-attachment";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, link, mkdir, mkdtemp, open, readFile, rename, rm, unlink } from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { SaxesParser } from "saxes";
/** Maximum side used by the local `resize-to-fit` snapshot. */
const MAX_PROMPT_IMAGE_DIMENSION = 2048;
/** High/auto request budget. */
const HIGH_DETAIL_LIMITS = Object.freeze({
	maxDimension: 2048,
	maxPatches: 2500
});
/** Original/unified request budget. */
const ORIGINAL_DETAIL_LIMITS = Object.freeze({
	maxDimension: 6e3,
	maxPatches: 1e4
});
const MAX_IMAGE_CACHE_ENTRIES = 32;
const MAX_IMAGE_CACHE_BYTES = 64 * 1024 * 1024;
const MEDIA_TYPES = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
};
const preparedImageCache = /* @__PURE__ */ new Map();
let preparedImageCacheBytes = 0;
async function imageMetadata(image) {
	const metadata = await image.metadata();
	const mediaType = MEDIA_TYPES[metadata.format];
	if (mediaType === void 0) throw new AttachmentError("Unsupported or malformed image data.", "INVALID_IMAGE");
	return {
		mediaType,
		width: metadata.width,
		height: metadata.height
	};
}
/**
* Parse a supported raster's header and return its intrinsic metadata without
* decoding pixels. Digest-verified reads use this after admission has already
* proved that the exact bytes decode completely.
* @param data - encoded bytes from a supported raster image.
* @returns verified media type and intrinsic dimensions from the image header.
*/
async function probeImage(data) {
	try {
		return await imageMetadata(sharp(data, {
			failOn: "error",
			limitInputPixels: false
		}));
	} catch (error) {
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("Unsupported or malformed image data.", "INVALID_IMAGE", { cause: error });
	}
}
/**
* Fully decode a supported raster and return its intrinsic metadata.
* @param data - encoded image bytes to validate by full decode.
* @param limits - optional decoded-pixel and per-side source guards.
* @returns verified media type and intrinsic dimensions.
*/
async function detectImage(data, limits) {
	try {
		const image = sharp(data, {
			failOn: "error",
			limitInputPixels: false
		});
		const detected = await imageMetadata(image);
		if (limits?.maxPixels !== void 0 && detected.width * detected.height > limits.maxPixels) throw new AttachmentError("Image exceeds the configured decoded-pixel limit.", "IMAGE_TOO_MANY_PIXELS");
		if (limits?.maxDimension !== void 0 && Math.max(detected.width, detected.height) > limits.maxDimension) throw new AttachmentError("Image exceeds the configured per-side pixel limit.", "IMAGE_DIMENSION_TOO_LARGE");
		await image.raw().toBuffer();
		return detected;
	} catch (error) {
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("Unsupported or malformed image data.", "INVALID_IMAGE", { cause: error });
	}
}
/**
* Test dimensions against side and 32px-patch budgets.
* @param width - candidate width in pixels.
* @param height - candidate height in pixels.
* @param limits - maximum side and patch count.
* @returns whether both budgets accept the dimensions.
*/
function promptImageDimensionsFit(width, height, limits) {
	const patchesWide = Math.ceil(width / 32);
	const patchesHigh = Math.ceil(height / 32);
	return width <= limits.maxDimension && height <= limits.maxDimension && patchesWide * patchesHigh <= limits.maxPatches;
}
/**
* Match Codex/Responses patch-budget math: cap the longest side, shrink by
* area, then round the scaled patch grid down so integer output dimensions
* remain inside the budget.
* @param sourceWidth - original width in pixels.
* @param sourceHeight - original height in pixels.
* @param limits - maximum side and patch count for the prepared image.
* @returns integer output width and height that preserve ratio within the budget.
*/
function promptImageOutputDimensionsForLimits(sourceWidth, sourceHeight, limits) {
	const originalWidth = Math.max(1, sourceWidth);
	const originalHeight = Math.max(1, sourceHeight);
	if (promptImageDimensionsFit(originalWidth, originalHeight, limits)) return [originalWidth, originalHeight];
	const maxDimensionScale = Math.min(limits.maxDimension / Math.max(originalWidth, originalHeight), 1);
	const width = Math.max(1, Math.round(originalWidth * maxDimensionScale));
	const height = Math.max(1, Math.round(originalHeight * maxDimensionScale));
	if (promptImageDimensionsFit(width, height, limits)) return [width, height];
	const patchSize = 32;
	let scale = Math.sqrt(patchSize * patchSize * limits.maxPatches / width / height);
	const scaledPatchesWide = width * scale / patchSize;
	const scaledPatchesHigh = height * scale / patchSize;
	scale *= Math.min(Math.floor(scaledPatchesWide) / scaledPatchesWide, Math.floor(scaledPatchesHigh) / scaledPatchesHigh);
	return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
function resizeToFitDimensions(width, height) {
	if (Math.max(width, height) <= 2048) return [width, height];
	const scale = MAX_PROMPT_IMAGE_DIMENSION / Math.max(width, height);
	return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
function targetDimensions(source, mode) {
	if (mode.kind === "original") return [source.width, source.height];
	if (mode.kind === "resize-to-fit") return resizeToFitDimensions(source.width, source.height);
	return promptImageOutputDimensionsForLimits(source.width, source.height, mode.limits);
}
function modeKey(mode) {
	return mode.kind === "resize-with-limits" ? `${mode.kind}:${mode.limits.maxDimension}:${mode.limits.maxPatches}` : mode.kind;
}
function cacheKey(data, mode) {
	return `${createHash("sha1").update(data).digest("hex")}:${modeKey(mode)}`;
}
function cachedImage(key) {
	const found = preparedImageCache.get(key);
	if (found === void 0) return void 0;
	preparedImageCache.delete(key);
	preparedImageCache.set(key, found);
	return found;
}
function cacheImage(key, image) {
	if (image.data.byteLength > MAX_IMAGE_CACHE_BYTES) return;
	preparedImageCache.set(key, image);
	preparedImageCacheBytes += image.data.byteLength;
	while (preparedImageCache.size > MAX_IMAGE_CACHE_ENTRIES || preparedImageCacheBytes > MAX_IMAGE_CACHE_BYTES) {
		const [oldestKey, oldestImage] = preparedImageCache.entries().next().value;
		preparedImageCache.delete(oldestKey);
		preparedImageCacheBytes -= oldestImage.data.byteLength;
	}
}
function canPreserveSourceBytes(mediaType) {
	return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/webp";
}
async function encodePreparedImage(data, source, width, height) {
	let image = sharp(data, {
		failOn: "error",
		limitInputPixels: false
	}).resize({
		width,
		height,
		fit: "fill",
		kernel: sharp.kernel.linear
	}).keepIccProfile().keepExif();
	switch (source.mediaType) {
		case "image/jpeg":
			image = image.jpeg({ quality: 85 });
			break;
		case "image/webp":
			image = image.webp({ lossless: true });
			break;
		case "image/png":
		case "image/gif":
			image = image.png();
			break;
	}
	return {
		data: new Uint8Array(await image.toBuffer()),
		mediaType: source.mediaType === "image/gif" ? "image/png" : source.mediaType
	};
}
/**
* Prepare one already-validated image for a local snapshot or provider request.
* PNG/JPEG/WebP source bytes pass through unchanged when no transform is
* needed; GIF is normalized to a static PNG. Results use a 32-entry/64 MiB
* process cache keyed by source digest and preparation mode.
* @param data - already-validated encoded source bytes.
* @param source - verified source media type and dimensions.
* @param mode - local snapshot or request-stage preparation policy.
* @returns source-preserving or transformed prompt bytes with verified metadata.
*/
async function loadForPromptBytes(data, source, mode) {
	if (data.byteLength > 1073741824) throw new AttachmentError("Image exceeds the prompt-image sanity limit.", "IMAGE_TOO_LARGE");
	const key = cacheKey(data, mode);
	const cached = cachedImage(key);
	if (cached !== void 0) return cached;
	try {
		const [width, height] = targetDimensions(source, mode);
		let prepared;
		if (width === source.width && height === source.height && canPreserveSourceBytes(source.mediaType)) prepared = {
			...source,
			data,
			sourceWidth: source.width,
			sourceHeight: source.height
		};
		else {
			const encoded = await encodePreparedImage(data, source, width, height);
			prepared = {
				...await probeImage(encoded.data),
				data: encoded.data,
				sourceWidth: source.width,
				sourceHeight: source.height
			};
		}
		cacheImage(key, prepared);
		return prepared;
	} catch (error) {
		throw new AttachmentError("Unable to prepare image for a model request.", "INVALID_IMAGE", { cause: error });
	}
}
//#endregion
//#region lib/types/store.js
/** Content-addressed, owner-private local attachment storage. */
const ID_PATTERN = /^sha256:([a-f0-9]{64})$/;
const durableHomes = /* @__PURE__ */ new Set();
/**
* Compute the lowercase SHA-256 identity used by the local CAS.
* @param data - immutable bytes to identify.
* @returns lowercase hexadecimal SHA-256 digest.
*/
function digest(data) {
	return createHash("sha256").update(data).digest("hex");
}
/**
* Reduce a client path to a bounded, control-free display leaf.
* @param value - optional untrusted client-supplied path or display name.
* @returns sanitized leaf name, or undefined when no usable name remains.
*/
function displayName(value) {
	if (value === void 0) return void 0;
	const clean = value.slice(Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) + 1).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
	return clean === "" ? void 0 : clean;
}
function objectPath(root, sha256) {
	return join(root, "objects", sha256.slice(0, 2), sha256);
}
function snapshotMode(detail) {
	return detail === "original" ? "original" : "resize-to-fit";
}
function verifyImageObject(data, detected, ref) {
	if (detected.mediaType !== ref.mediaType || data.byteLength !== ref.bytes || detected.width !== ref.width || detected.height !== ref.height) throw new AttachmentError("Stored attachment metadata does not match its reference.", "ATTACHMENT_CORRUPT");
}
/**
* Extract and validate the SHA-256 component of an opaque attachment id.
* @param ref - reference containing an untrusted opaque attachment id.
* @returns validated lowercase SHA-256 digest.
*/
function ensureReference(ref) {
	const match = ID_PATTERN.exec(String(ref.attachmentId));
	if (match?.[1] === void 0) throw new AttachmentError("Attachment reference is invalid.", "INVALID_ATTACHMENT_REF");
	return match[1];
}
function inspectText(data) {
	if (data.byteLength === 0) throw new AttachmentError("Text attachment is empty.", "INVALID_TEXT");
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch (error) {
		throw new AttachmentError("Text attachment is not valid UTF-8.", "INVALID_TEXT", { cause: error });
	}
	if (text.includes("\0")) throw new AttachmentError("Text attachment contains NUL bytes.", "INVALID_TEXT");
}
async function inspectMetadata(data, declaredMediaType, limits) {
	if (data.byteLength === 0) throw new AttachmentError("Image is empty.", "INVALID_IMAGE");
	const detected = await detectImage(data, {
		maxPixels: limits.maxImagePixels,
		maxDimension: limits.maxImageDimension
	});
	if (detected.mediaType !== declaredMediaType) throw new AttachmentError("Declared image type does not match its bytes.", "IMAGE_TYPE_MISMATCH");
	return {
		...detected,
		bytes: data.byteLength
	};
}
/**
* Run the full admission policy for one image without touching storage.
* @param input - encoded bytes and declared metadata.
* @param limits - resolved storage policy.
* @returns completion after the encoded raster has been fully decoded.
*/
async function validateImageFile(input, limits) {
	if (input.data.byteLength > limits.maxImageBytes) throw new AttachmentError("Image exceeds the configured byte limit.", "IMAGE_TOO_LARGE");
	await inspectMetadata(input.data, input.mediaType, limits);
}
/**
* Validate one common text attachment without touching storage.
* @param input - candidate bytes, declared media type, and optional name.
* @param limits - resolved common-text admission policy.
*/
function validateTextFile(input, limits) {
	if (input.data.byteLength > limits.maxTextBytes) throw new AttachmentError("Text attachment exceeds the configured byte limit.", "TEXT_TOO_LARGE");
	if (!limits.mediaTypes.includes(input.mediaType)) throw new AttachmentError(`Text attachment type ${input.mediaType} is not accepted by this deployment.`, "UNSUPPORTED_TEXT_TYPE");
	inspectText(input.data);
}
/**
* Make a directory's entries durable (fsync on a read-only directory handle).
* A synced file alone does not survive a crash when its directory entry never
* reached storage, so the publication directory is synced before a durable
* reference is reported.
* @param path - directory whose entries must be crash-durable.
*/
async function syncDirectory(path) {
	/* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
	if (process.platform === "win32") return;
	/* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	/* v8 ignore stop */
}
/**
* Create one private directory tree and persist every ancestor entry up to a
* caller-vouched durable boundary. The walk deliberately ignores what mkdir
* reports as newly created: a concurrent first save can create a level this
* process then merely observes, so "already existed" is not "already durable"
* — the entry may still be unsynced in the creator, and a crash would drop a
* directory the session checkpoint already references. Re-syncing a durable
* entry is harmless; skipping an unsynced one is not.
* @param path - absolute directory to create.
* @param boundary - absolute ancestor the caller vouches is already durable.
*/
async function ensureDurableDirectory(path, boundary) {
	const target = resolve(path);
	const stop = resolve(boundary);
	await mkdir(target, {
		recursive: true,
		mode: 448
	});
	await chmod(target, 448);
	let level = target;
	while (level !== stop) {
		const parent = dirname(level);
		await syncDirectory(parent);
		/* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
		if (parent === level) return;
		level = parent;
	}
}
/**
* Establish this process's proof that one DSH_HOME entry and every ancestor
* below the filesystem root are durable. Mere existence is insufficient: a
* concurrent process may have created the directory but not synced its parent.
*/
async function ensureDurableHome(path) {
	const home = resolve(path);
	if (!durableHomes.has(home)) {
		await ensureDurableDirectory(home, parse(home).root);
		durableHomes.add(home);
	}
	return home;
}
/**
* Publish immutable bytes after the directory entry is crash-durable.
* @param root - versioned local attachment-store root.
* @param data - complete immutable object bytes.
* @returns lowercase SHA-256 digest naming the stored object.
*/
async function publishObject(root, data) {
	const sha256 = digest(data);
	const bucket = join(root, "objects", sha256.slice(0, 2));
	const staging = join(root, "tmp");
	const boundary = await ensureDurableHome(dirname(dirname(resolve(root))));
	await ensureDurableDirectory(bucket, boundary);
	await ensureDurableDirectory(staging, boundary);
	const temporary = join(staging, randomUUID());
	const target = objectPath(root, sha256);
	let handle;
	try {
		handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 384);
		await handle.writeFile(data);
		await handle.sync();
		await handle.close();
		handle = void 0;
		try {
			await link(temporary, target);
		} catch (error) {
			/* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			if (digest(new Uint8Array(await readFile(target))) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");
		}
		await syncDirectory(bucket);
		await syncDirectory(join(root, "objects"));
		await unlink(temporary);
	} catch (error) {
		/* v8 ignore next -- A descriptor can remain open only when the underlying write/sync/close operation fails. */
		if (handle !== void 0) await handle.close().catch(
			/* v8 ignore next -- Close failure is superseded by the storage operation that entered cleanup. */
			() => {}
		);
		await unlink(temporary).catch(
			/* v8 ignore next -- The callback requires a second independent staging-unlink failure. */
			(cleanupError) => {
				/* v8 ignore next -- Cleanup is best-effort only for a staging file already removed by a failed operation. */
				if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) throw cleanupError;
			}
		);
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("Unable to persist attachment.", "ATTACHMENT_WRITE_FAILED", { cause: error });
	}
	return sha256;
}
/**
* Read and digest-verify one opaque content-addressed object.
* @param root - versioned local attachment-store root.
* @param ref - reference containing the expected content identity.
* @param signal - optional cancellation for the filesystem read.
* @returns verified immutable bytes.
*/
async function readObject(root, ref, signal) {
	signal?.throwIfAborted();
	const sha256 = ensureReference(ref);
	let data;
	try {
		data = new Uint8Array(await readFile(objectPath(root, sha256), { signal }));
	} catch (error) {
		signal?.throwIfAborted();
		if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new AttachmentError("Attachment object is missing.", "ATTACHMENT_NOT_FOUND");
		throw new AttachmentError("Unable to read attachment.", "ATTACHMENT_READ_FAILED", { cause: error });
	}
	signal?.throwIfAborted();
	if (digest(data) !== sha256) throw new AttachmentError("Stored attachment failed integrity verification.", "ATTACHMENT_CORRUPT");
	return data;
}
/**
* Save and verify immutable image bytes below a versioned attachment root.
* @param root - absolute `DSH_HOME/attachments/v1` root.
* @param input - encoded bytes and declared metadata.
* @param limits - resolved storage policy.
* @returns durable content-addressed reference.
*/
async function saveImageFile(root, input, limits) {
	if (input.data.byteLength > limits.maxImageBytes) throw new AttachmentError("Image exceeds the configured byte limit.", "IMAGE_TOO_LARGE");
	const metadata = await inspectMetadata(input.data, input.mediaType, limits);
	const mode = snapshotMode(input.detail);
	const prepared = await loadForPromptBytes(input.data, metadata, { kind: mode });
	let promptSnapshot;
	if (digest(prepared.data) !== digest(input.data) || prepared.mediaType !== metadata.mediaType || prepared.width !== metadata.width || prepared.height !== metadata.height) promptSnapshot = {
		attachmentId: AttachmentId(`sha256:${await publishObject(root, prepared.data)}`),
		mediaType: prepared.mediaType,
		bytes: prepared.data.byteLength,
		width: prepared.width,
		height: prepared.height,
		mode
	};
	const sha256 = await publishObject(root, input.data);
	const name = displayName(input.name);
	return {
		attachmentId: AttachmentId(`sha256:${sha256}`),
		...metadata,
		...name !== void 0 ? { name } : {},
		...promptSnapshot !== void 0 ? { promptSnapshot } : {}
	};
}
/**
* Save and verify one immutable common-text object below the versioned root.
* @param root - absolute `DSH_HOME/attachments/v1` root.
* @param input - accepted UTF-8 bytes and declared metadata.
* @param limits - resolved common-text admission policy.
* @returns a durable content-addressed text reference.
*/
async function saveTextFile(root, input, limits) {
	validateTextFile(input, limits);
	const sha256 = await publishObject(root, input.data);
	const name = displayName(input.name);
	return {
		attachmentId: AttachmentId(`sha256:${sha256}`),
		mediaType: input.mediaType,
		bytes: input.data.byteLength,
		encoding: "utf-8",
		...name !== void 0 ? { name } : {}
	};
}
/**
* Read and verify one content-addressed image.
* @param root - absolute `DSH_HOME/attachments/v1` root.
* @param ref - reference recorded in the session log.
* @param signal - optional cancellation for filesystem and verification work.
* @returns verified bytes and reference.
* @throws the signal reason when aborted, or an AttachmentError when verification fails.
*/
async function readImageFile(root, ref, signal) {
	const data = await readObject(root, ref, signal);
	const metadata = await probeImage(data);
	signal?.throwIfAborted();
	verifyImageObject(data, metadata, ref);
	return {
		ref,
		data
	};
}
/**
* Read a Codex-style provider representation from the matching local snapshot,
* then apply the detail-stage side and patch budget. Prepared bytes are
* process-cached by source digest and mode and published to the same CAS.
* @param root - absolute `DSH_HOME/attachments/v1` root.
* @param ref - durable original reference from the session log.
* @param options - requested detail and optional cancellation.
* @returns verified request bytes and their immutable object metadata.
*/
async function readImageForModelFile(root, ref, options) {
	const detail = options?.detail ?? "auto";
	const mode = snapshotMode(detail);
	const sourceRef = ref.promptSnapshot?.mode === mode ? ref.promptSnapshot : ref;
	const data = await readObject(root, sourceRef, options?.signal);
	const metadata = await probeImage(data);
	options?.signal?.throwIfAborted();
	verifyImageObject(data, metadata, sourceRef);
	const prepared = await loadForPromptBytes(data, metadata, {
		kind: "resize-with-limits",
		limits: detail === "original" ? ORIGINAL_DETAIL_LIMITS : HIGH_DETAIL_LIMITS
	});
	options?.signal?.throwIfAborted();
	const preparedSha256 = digest(prepared.data);
	if (preparedSha256 === ensureReference(sourceRef) && prepared.mediaType === sourceRef.mediaType && prepared.width === sourceRef.width && prepared.height === sourceRef.height) return {
		ref: sourceRef,
		data
	};
	await publishObject(root, prepared.data);
	return {
		ref: {
			attachmentId: AttachmentId(`sha256:${preparedSha256}`),
			mediaType: prepared.mediaType,
			bytes: prepared.data.byteLength,
			width: prepared.width,
			height: prepared.height
		},
		data: prepared.data
	};
}
/**
* Read and verify one common-text object.
* @param root - absolute `DSH_HOME/attachments/v1` root.
* @param ref - durable text reference authorized by the caller.
* @param signal - optional cancellation for filesystem and verification work.
* @returns verified UTF-8 bytes and their canonical reference.
*/
async function readTextFile(root, ref, signal) {
	const data = await readObject(root, ref, signal);
	if (data.byteLength !== ref.bytes) throw new AttachmentError("Stored attachment metadata does not match its reference.", "ATTACHMENT_CORRUPT");
	try {
		inspectText(data);
	} catch (error) {
		throw new AttachmentError("Stored attachment content does not match its text reference.", "ATTACHMENT_CORRUPT", { cause: error });
	}
	return {
		ref,
		data
	};
}
//#endregion
//#region lib/types/csv.js
/** RFC 4180 CSV decoding with bounded range-on-demand support. */
const TEXT_CHUNK_BYTES = 64 * 1024;
function hasUtf8Bom(data) {
	return data[0] === 239 && data[1] === 187 && data[2] === 191;
}
function validates(data, label) {
	const decoder = new TextDecoder(label, { fatal: true });
	const offset = hasUtf8Bom(data) ? 3 : 0;
	try {
		for (let start = offset; start < data.byteLength; start += TEXT_CHUNK_BYTES) decoder.decode(data.subarray(start, Math.min(data.byteLength, start + TEXT_CHUNK_BYTES)), { stream: true });
		decoder.decode();
		return true;
	} catch {
		return false;
	}
}
function csvEncoding(data) {
	if (validates(data, "utf-8")) return "utf-8";
	if (validates(data, "gb18030")) return "gb18030";
	throw new AttachmentError("CSV encoding is neither UTF-8 nor GB18030.", "TEXT_ENCODING_UNSUPPORTED");
}
/**
* Validate that CSV bytes use one of the supported local encodings.
* @param data - complete CSV bytes from the external attachment boundary.
*/
function validateCsvEncoding(data) {
	csvEncoding(data);
}
function delimiterFor(data, encoding) {
	const offset = hasUtf8Bom(data) ? 3 : 0;
	const sample = new TextDecoder(encoding).decode(data.subarray(offset, Math.min(data.byteLength, offset + 16384)));
	return [
		",",
		"	",
		";"
	].map((delimiter) => ({
		delimiter,
		count: sample.split(delimiter).length - 1
	})).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ",";
}
function visitRows(data, encoding, delimiter, visit) {
	const decoder = new TextDecoder(encoding, { fatal: true });
	const offset = hasUtf8Bom(data) ? 3 : 0;
	const state = {
		row: [],
		field: "",
		quoted: false,
		pendingLf: false,
		rowNumber: 0
	};
	const consume = (source) => {
		for (let index = 0; index < source.length; index += 1) {
			const character = source.charAt(index);
			if (state.pendingLf) {
				state.pendingLf = false;
				if (character === "\n") continue;
			}
			if (state.quoted) {
				if (character === "\"") if (source[index + 1] === "\"") {
					state.field += "\"";
					index += 1;
				} else state.quoted = false;
				else state.field += character;
				continue;
			}
			if (character === "\"" && state.field === "") state.quoted = true;
			else if (character === delimiter) {
				state.row.push(state.field);
				state.field = "";
			} else if (character === "\n" || character === "\r") {
				if (character === "\r") state.pendingLf = true;
				state.row.push(state.field);
				state.rowNumber += 1;
				if (visit(state.row, state.rowNumber) === false) return true;
				state.row = [];
				state.field = "";
			} else state.field += character;
		}
		return false;
	};
	try {
		for (let start = offset; start < data.byteLength; start += TEXT_CHUNK_BYTES) if (consume(decoder.decode(data.subarray(start, Math.min(data.byteLength, start + TEXT_CHUNK_BYTES)), { stream: true }))) return;
		if (consume(decoder.decode())) return;
	} catch (error) {
		throw new AttachmentError("CSV bytes do not match the detected encoding.", "TEXT_ENCODING_UNSUPPORTED", { cause: error });
	}
	if (state.quoted) throw new AttachmentError("CSV has an unterminated quoted field.", "DOCUMENT_CORRUPT");
	if (state.field !== "" || state.row.length > 0) {
		state.row.push(state.field);
		visit(state.row, state.rowNumber + 1);
	}
}
function columnName$1(column) {
	let value = column;
	let name = "";
	while (value > 0) {
		value -= 1;
		name = String.fromCharCode(65 + value % 26) + name;
		value = Math.floor(value / 26);
	}
	return name;
}
function scan(data, encoding) {
	let rows = 0;
	let columns = 0;
	visitRows(data, encoding, delimiterFor(data, encoding), (row, rowNumber) => {
		rows = rowNumber;
		columns = Math.max(columns, row.length);
	});
	if (rows === 0) throw new AttachmentError("CSV attachment is empty.", "DOCUMENT_CORRUPT");
	return {
		rows,
		columns
	};
}
/**
* Build a row-count and width index while retaining all large-file content only in CAS.
* @param data - validated CSV bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @returns a compact normalized index for range-on-demand access.
*/
function parseCsvStreamingIndex(data, attachmentId, name) {
	const encoding = csvEncoding(data);
	const summary = scan(data, encoding);
	const range = `A1:${columnName$1(summary.columns)}${summary.rows}`;
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "spreadsheet"
		},
		outline: [{
			id: "sheet-1",
			title: name ?? "CSV",
			level: 1,
			locator: {
				kind: "csv",
				sheet: "CSV",
				range
			}
		}],
		blocks: [],
		tables: [],
		formulas: [],
		cells: [],
		sheets: [{
			name: "CSV",
			state: "visible",
			range
		}],
		images: [],
		warnings: [],
		coverage: {
			status: "COMPLETE",
			included: [
				`encoding:${encoding}`,
				"quoted-newlines",
				"streamed-range-access",
				"rows",
				"cells"
			],
			omitted: [],
			unsupported: []
		},
		streaming: {
			kind: "csv",
			encoding,
			rows: summary.rows,
			columns: summary.columns
		}
	};
}
function address$1(value) {
	const match = /^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(value.toUpperCase());
	if (match === null) return void 0;
	const letters = match[1];
	const row = match[2];
	if (letters === void 0 || row === void 0) return void 0;
	let column = 0;
	for (const character of letters) column = column * 26 + character.charCodeAt(0) - 64;
	return {
		row: Number(row),
		column
	};
}
/**
* Stream one exact CSV range without retaining rows outside the request.
* @param data - original CSV bytes read from CAS.
* @param range - A1-style inclusive range requested by the model.
* @param limits - resolved query and parser resource limits.
* @returns non-empty cells within the bounded requested range.
*/
function readCsvRangeStreaming(data, range, limits) {
	const [firstText, lastText = firstText] = range.split(":");
	const first = firstText === void 0 ? void 0 : address$1(firstText);
	const last = lastText === void 0 ? void 0 : address$1(lastText);
	if (first === void 0 || last === void 0) throw new AttachmentError(`Invalid spreadsheet range ${range}.`, "PARSER_OUTPUT_INVALID");
	const firstRow = Math.min(first.row, last.row);
	const lastRow = Math.max(first.row, last.row);
	const firstColumn = Math.min(first.column, last.column);
	const lastColumn = Math.max(first.column, last.column);
	const encoding = csvEncoding(data);
	const cells = [];
	visitRows(data, encoding, delimiterFor(data, encoding), (row, rowNumber) => {
		if (rowNumber < firstRow) return;
		if (rowNumber > lastRow) return false;
		for (let column = firstColumn; column <= lastColumn && cells.length < limits.maxQueryItems; column += 1) {
			const value = row[column - 1] ?? "";
			if (value !== "") cells.push({
				sheet: "CSV",
				cell: `${columnName$1(column)}${rowNumber}`,
				value
			});
		}
		if (cells.length >= limits.maxQueryItems || rowNumber === lastRow) return false;
	});
	return cells;
}
/**
* Normalize a small UTF-8 or GB18030 CSV while preserving quoted newlines.
* @param data - validated CSV bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @param limits - resolved normalization and query limits.
* @returns the normalized spreadsheet representation.
*/
function parseCsv(data, attachmentId, name, limits) {
	const encoding = csvEncoding(data);
	const rows = [];
	visitRows(data, encoding, delimiterFor(data, encoding), (row) => {
		rows.push([...row]);
	});
	if (rows.length === 0) throw new AttachmentError("CSV attachment is empty.", "DOCUMENT_CORRUPT");
	const width = Math.max(...rows.map((row) => row.length));
	const headers = Array.from({ length: width }, (_, index) => rows[0]?.[index] ?? columnName$1(index + 1));
	const cells = [];
	for (const [rowIndex, row] of rows.entries()) for (let column = 0; column < width; column += 1) {
		const value = row[column] ?? "";
		if (value !== "") cells.push({
			sheet: "CSV",
			cell: `${columnName$1(column + 1)}${rowIndex + 1}`,
			value
		});
	}
	const tables = [];
	for (let start = 0; start < rows.length; start += limits.csvRowsPerBlock) {
		const selected = rows.slice(start, start + limits.csvRowsPerBlock);
		tables.push({
			id: `csv-rows-${start + 1}-${start + selected.length}`,
			title: name ?? "CSV",
			headers,
			rows: selected.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
			locator: {
				kind: "csv",
				sheet: "CSV",
				range: `A${start + 1}:${columnName$1(width)}${start + selected.length}`
			},
			truncated: false,
			totalRows: selected.length
		});
	}
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "spreadsheet"
		},
		outline: [{
			id: "sheet-1",
			title: name ?? "CSV",
			level: 1,
			locator: {
				kind: "csv",
				sheet: "CSV",
				range: `A1:${columnName$1(width)}${rows.length}`
			}
		}],
		blocks: [],
		tables,
		formulas: [],
		cells,
		sheets: [{
			name: "CSV",
			state: "visible",
			range: `A1:${columnName$1(width)}${rows.length}`
		}],
		images: [],
		warnings: [],
		coverage: {
			status: "COMPLETE",
			included: [
				`encoding:${encoding}`,
				"quoted-newlines",
				"rows",
				"cells"
			],
			omitted: [],
			unsupported: []
		}
	};
}
//#endregion
//#region lib/types/officecli.js
/** Fixed, offline OfficeCLI subprocess adapter. */
/** Locked OfficeCLI release shipped with this attachment provider. */
const OFFICECLI_VERSION = "1.0.144";
/** SHA256 published for the official macOS arm64 release asset. */
const OFFICECLI_DARWIN_ARM64_SHA256 = "04757163428c5bde8d91e8f838517818e74722157722ca5f3877b6716b77bd45";
function bundledExecutable() {
	if (process.platform === "darwin" && process.arch === "arm64") return {
		path: fileURLToPath(new URL("../vendor/officecli/darwin-arm64/officecli", import.meta.url)),
		sha256: OFFICECLI_DARWIN_ARM64_SHA256
	};
	throw new AttachmentError(`Office attachments are not packaged for ${process.platform}/${process.arch}.`, "PARSER_VERSION_MISMATCH");
}
function sha256(data) {
	return createHash("sha256").update(data).digest("hex");
}
function parsedResponse(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new AttachmentError("Office parser returned invalid JSON.", "PARSER_OUTPUT_INVALID", { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value) || !("success" in value) || value.success !== true || !("data" in value)) throw new AttachmentError("Office parser returned an unexpected response.", "PARSER_OUTPUT_INVALID");
	return value;
}
/** One verified OfficeCLI executable and bounded managed-process runner. */
var OfficeCli = class {
	ctx;
	options;
	verification;
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options;
	}
	executable() {
		this.verification ??= this.verify();
		return this.verification;
	}
	runtime() {
		const runtime = this.ctx.get("subprocess");
		if (runtime === void 0) throw new AttachmentError("Office parser requires a mounted subprocess service.", "PARSER_VERSION_MISMATCH");
		return runtime;
	}
	async verify() {
		const bundled = bundledExecutable();
		const executable = this.options.executable ?? bundled.path;
		try {
			await access(executable, constants.X_OK);
			const bytes = new Uint8Array(await readFile(executable));
			if (this.options.executable === void 0 && sha256(bytes) !== bundled.sha256) throw new AttachmentError("Bundled Office parser failed checksum verification.", "PARSER_VERSION_MISMATCH");
			const resolved = await this.runtime().resolveExecutable(executable);
			if ((await this.spawnText(resolved, ["--version"], process.cwd(), void 0, 4096)).trim() !== "1.0.144") throw new AttachmentError(`Office parser version mismatch. Expected ${OFFICECLI_VERSION}.`, "PARSER_VERSION_MISMATCH");
			return resolved;
		} catch (error) {
			if (error instanceof AttachmentError) throw error;
			throw new AttachmentError("Office parser is unavailable.", "PARSER_VERSION_MISMATCH", { cause: error });
		}
	}
	async spawnText(executable, args, cwd, signal, maxOutputBytes = this.options.maxOutputBytes) {
		const timeout = AbortSignal.timeout(this.options.timeoutMs);
		const combined = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
		const handle = this.runtime().spawn({
			argv: [executable, ...args],
			cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: maxOutputBytes },
				stderr: { maxBytes: Math.min(maxOutputBytes, 1024 * 1024) }
			},
			graceMs: 2e3,
			signal: combined,
			env: {
				OFFICECLI_SKIP_UPDATE: "1",
				OFFICECLI_NO_AUTO_INSTALL: "1",
				DOTNET_CLI_TELEMETRY_OPTOUT: "1"
			}
		});
		let outcome;
		try {
			outcome = await handle.done;
		} catch (error) {
			signal?.throwIfAborted();
			if (timeout.aborted) throw new AttachmentError("Office document parsing timed out.", "DOCUMENT_PARSE_TIMEOUT", { cause: error });
			throw new AttachmentError("Office parser process could not start.", "PARSER_VERSION_MISMATCH", { cause: error });
		}
		signal?.throwIfAborted();
		if (timeout.aborted) throw new AttachmentError("Office document parsing timed out.", "DOCUMENT_PARSE_TIMEOUT");
		const stdout = handle.collected.stdout?.readFrom(0);
		const stderr = handle.collected.stderr?.readFrom(0);
		if (stdout === void 0 || stdout.lossy) throw new AttachmentError("Office parser output exceeded the configured limit.", "DOCUMENT_RESOURCE_LIMIT");
		if (outcome.exitCode !== 0) {
			const detail = stderr?.text.trim().slice(-500);
			const cause = detail === void 0 || detail === "" ? void 0 : new Error(detail);
			throw new AttachmentError("Office parser could not read this document.", "DOCUMENT_CORRUPT", cause === void 0 ? void 0 : { cause });
		}
		return stdout.text;
	}
	/**
	* Run one OfficeCLI JSON command against an isolated working directory.
	* @param args - OfficeCLI operation and operands, excluding the JSON flag.
	* @param cwd - private directory used as the subprocess working boundary.
	* @param signal - optional caller cancellation combined with the hard timeout.
	* @returns validated OfficeCLI response data.
	*/
	async json(args, cwd, signal) {
		const executable = await this.executable();
		signal?.throwIfAborted();
		return parsedResponse(await this.spawnText(executable, [...args, "--json"], cwd, signal));
	}
};
//#endregion
//#region lib/types/ooxml.js
/** Resource-bounded OOXML inspection and XLSX normalization. */
const ZIP_LOCAL = 67324752;
const ZIP_CENTRAL = 33639248;
const ZIP_EOCD = 101010256;
const MAX_EOCD_SEARCH = 65557;
const xml$1 = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	removeNSPrefix: true,
	parseTagValue: false,
	trimValues: false
});
function values$2(value) {
	return value === void 0 ? [] : Array.isArray(value) ? value : [value];
}
function object$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function string(value) {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "object" && value !== null && !Array.isArray(value) && "#text" in value) return string(value["#text"]);
}
function allText(value) {
	if (typeof value === "string") return value.replace(/&#x([0-9a-f]+);/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#([0-9]+);/gu, (_match, decimal) => String.fromCodePoint(Number(decimal))).replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return value.map(allText).join("");
	if (typeof value !== "object" || value === null) return "";
	return Object.entries(value).filter(([key]) => !key.startsWith("@_")).map(([, child]) => allText(child)).join("");
}
function uint32(data, offset) {
	return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}
function uint16(data, offset) {
	return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}
function findEocd(data) {
	const floor = Math.max(0, data.byteLength - MAX_EOCD_SEARCH);
	for (let offset = data.byteLength - 22; offset >= floor; offset -= 1) if (uint32(data, offset) === ZIP_EOCD) return offset;
	throw new AttachmentError("Office document ZIP directory is missing.", "DOCUMENT_CORRUPT");
}
/**
* Reject ZIP bombs, traversal, and malformed directories before decompression allocates output.
* @param data - complete candidate OOXML bytes.
* @param limits - resolved archive-entry, expansion, and ratio limits.
* @returns preflighted entry names and expansion statistics.
*/
function inspectArchive(data, limits) {
	if (data.byteLength < 4 || uint32(data, 0) !== ZIP_LOCAL) throw new AttachmentError("Office document is not a valid OOXML ZIP package.", "FILE_TYPE_MISMATCH");
	if (data.byteLength < 22) throw new AttachmentError("Office document ZIP package is truncated.", "DOCUMENT_CORRUPT");
	const eocd = findEocd(data);
	const entries = uint16(data, eocd + 10);
	const centralBytes = uint32(data, eocd + 12);
	const centralOffset = uint32(data, eocd + 16);
	if (entries === 65535 || centralBytes === 4294967295 || centralOffset === 4294967295) throw new AttachmentError("ZIP64 Office packages exceed this parser safety profile.", "DOCUMENT_RESOURCE_LIMIT");
	if (entries > limits.maxArchiveEntries || centralOffset + centralBytes > data.byteLength) throw new AttachmentError("Office document exceeds the configured archive-entry limit.", "DOCUMENT_RESOURCE_LIMIT");
	let offset = centralOffset;
	let total = 0;
	let largestEntryBytes = 0;
	const names = [];
	for (let index = 0; index < entries; index += 1) {
		if (offset + 46 > data.byteLength || uint32(data, offset) !== ZIP_CENTRAL) throw new AttachmentError("Office document has a malformed ZIP directory.", "DOCUMENT_CORRUPT");
		const compressed = uint32(data, offset + 20);
		const uncompressed = uint32(data, offset + 24);
		const nameLength = uint16(data, offset + 28);
		const extraLength = uint16(data, offset + 30);
		const commentLength = uint16(data, offset + 32);
		if (compressed === 4294967295 || uncompressed === 4294967295) throw new AttachmentError("ZIP64 Office entries exceed this parser safety profile.", "DOCUMENT_RESOURCE_LIMIT");
		total += uncompressed;
		largestEntryBytes = Math.max(largestEntryBytes, uncompressed);
		const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
		const normalized = posix.normalize(name);
		if (name.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) throw new AttachmentError("Office document contains an unsafe package path.", "DOCUMENT_CORRUPT");
		names.push(normalized);
		const ratio = compressed === 0 ? uncompressed === 0 ? 1 : Number.POSITIVE_INFINITY : uncompressed / compressed;
		if (total > limits.maxDecompressedBytes || ratio > limits.maxCompressionRatio) throw new AttachmentError("Office document exceeds the configured decompression limit.", "DOCUMENT_RESOURCE_LIMIT");
		offset += 46 + nameLength + extraLength + commentLength;
	}
	if (offset > centralOffset + centralBytes) throw new AttachmentError("Office document ZIP directory is inconsistent.", "DOCUMENT_CORRUPT");
	return {
		totalUncompressedBytes: total,
		largestEntryBytes,
		entries: names
	};
}
/**
* Count XML elements without retaining decompressed parts.
* @param data - preflighted OOXML package bytes.
* @param limits - resolved XML-node resource limit.
*/
function inspectXmlNodes(data, limits) {
	let nodes = 0;
	let failure;
	const archive = new Unzip((file) => {
		if (!/\.(?:xml|rels)$/iu.test(file.name)) return;
		let afterLessThan = false;
		file.ondata = (error, chunk) => {
			if (error !== null) {
				failure = error;
				return;
			}
			for (const byte of chunk) {
				if (afterLessThan) {
					afterLessThan = false;
					if (byte !== 47 && byte !== 33 && byte !== 63) {
						nodes += 1;
						if (nodes > limits.maxXmlNodes) {
							failure = new AttachmentError("Office document exceeds the configured XML-node limit.", "DOCUMENT_RESOURCE_LIMIT");
							file.terminate();
							return;
						}
					}
				}
				if (byte === 60) afterLessThan = true;
			}
		};
		file.start();
	});
	archive.register(UnzipInflate);
	archive.register(UnzipPassThrough);
	try {
		for (let offset = 0; offset < data.byteLength; offset += 64 * 1024) {
			const end = Math.min(data.byteLength, offset + 64 * 1024);
			archive.push(data.subarray(offset, end), end === data.byteLength);
			if (failure !== void 0) throw failure;
		}
	} catch (error) {
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("Office document XML could not be inspected.", "DOCUMENT_CORRUPT", { cause: error });
	}
}
/**
* Decompress a preflighted OOXML package and verify its declared family.
* @param data - complete candidate OOXML bytes.
* @param expected - declared DOCX, XLSX, or PPTX family.
* @param limits - resolved archive resource limits.
* @returns normalized package paths mapped to decompressed bytes.
*/
function openOoxml(data, expected, limits) {
	inspectArchive(data, limits);
	let entries;
	try {
		entries = unzipSync(data);
	} catch (error) {
		throw new AttachmentError("Office document could not be decompressed.", "DOCUMENT_CORRUPT", { cause: error });
	}
	if (entries[expected === "docx" ? "word/document.xml" : expected === "xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml"] === void 0) throw new AttachmentError("Declared Office type does not match the package contents.", "FILE_TYPE_MISMATCH");
	return entries;
}
function parseXml(entries, path) {
	const bytes = entries[path];
	if (bytes === void 0) throw new AttachmentError(`OOXML part ${path} is missing.`, "DOCUMENT_CORRUPT");
	try {
		return object$2(xml$1.parse(new TextDecoder().decode(bytes)));
	} catch (error) {
		throw new AttachmentError(`OOXML part ${path} is invalid.`, "DOCUMENT_CORRUPT", { cause: error });
	}
}
function relationshipMap(entries, path) {
	if (entries[path] === void 0) return /* @__PURE__ */ new Map();
	const root = object$2(parseXml(entries, path).Relationships);
	return new Map(values$2(root.Relationship).map((entry) => {
		const rel = object$2(entry);
		return [String(rel["@_Id"]), String(rel["@_Target"])];
	}));
}
function resolvePart$1(base, target) {
	const normalized = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(base), target));
	if (normalized.startsWith("../") || normalized.includes("/../")) throw new AttachmentError("OOXML relationship escapes the document package.", "DOCUMENT_CORRUPT");
	return normalized;
}
function cellCoordinates(address) {
	const match = /^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(address.toUpperCase());
	if (match === null) return void 0;
	const letters = match[1];
	const row = match[2];
	if (letters === void 0 || row === void 0) return void 0;
	let column = 0;
	for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64;
	return {
		row: Number(row),
		column
	};
}
function columnName(column) {
	let value = column;
	let name = "";
	while (value > 0) {
		value -= 1;
		name = String.fromCharCode(65 + value % 26) + name;
		value = Math.floor(value / 26);
	}
	return name;
}
function worksheetRelationshipsPath(sheetPath) {
	return posix.join(posix.dirname(sheetPath), "_rels", `${posix.basename(sheetPath)}.rels`);
}
function workbookSharedStrings(entries) {
	if (entries["xl/sharedStrings.xml"] === void 0) return [];
	return values$2(object$2(parseXml(entries, "xl/sharedStrings.xml").sst).si).map(allText);
}
function workbookFormats(entries) {
	if (entries["xl/styles.xml"] === void 0) return [];
	const root = object$2(parseXml(entries, "xl/styles.xml").styleSheet);
	const custom = new Map(values$2(object$2(root.numFmts).numFmt).map((value) => {
		const format = object$2(value);
		return [String(format["@_numFmtId"]), String(format["@_formatCode"])];
	}));
	return values$2(object$2(root.cellXfs).xf).map((value) => {
		const id = string(object$2(value)["@_numFmtId"]);
		return id === void 0 ? void 0 : custom.get(id) ?? `builtin:${id}`;
	});
}
function cellValue(cell, sharedStrings) {
	const type = string(cell["@_t"]);
	if (type === "inlineStr") return allText(cell.is);
	const raw = string(cell.v) ?? "";
	if (type === "s") return sharedStrings[Number(raw)] ?? "";
	if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
	return raw;
}
function formulaText(value) {
	if (value === void 0) return { sharedFollower: false };
	if (typeof value === "string" || typeof value === "number") return {
		text: String(value),
		sharedFollower: false
	};
	const formula = object$2(value);
	const text = string(formula["#text"]);
	return {
		...text === void 0 || text === "" ? {} : { text },
		sharedFollower: formula["@_t"] === "shared" && (text === void 0 || text === "")
	};
}
function parseComments(entries, sheetPath, sheet) {
	const rels = relationshipMap(entries, worksheetRelationshipsPath(sheetPath));
	const comments = [];
	for (const target of rels.values()) {
		if (!target.toLowerCase().includes("comments")) continue;
		const commentsPath = resolvePart$1(sheetPath, target);
		if (entries[commentsPath] === void 0) continue;
		const root = object$2(parseXml(entries, commentsPath).comments);
		for (const [index, item] of values$2(object$2(root.commentList).comment).entries()) {
			const comment = object$2(item);
			const cell = string(comment["@_ref"]) ?? "?";
			comments.push({
				id: `comment-${createHash("sha1").update(`${sheet}:${cell}:${index}`).digest("hex").slice(0, 12)}`,
				type: "comment",
				text: allText(comment.text),
				locator: {
					kind: "xlsx",
					sheet,
					range: cell
				}
			});
		}
	}
	return comments;
}
/**
* Normalize one preflighted XLSX package without recalculating formulas.
* @param data - validated XLSX bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @param limits - resolved archive, parser, and query limits.
* @returns normalized workbook content, formulas, saved values, and coverage.
*/
function parseXlsx(data, attachmentId, name, limits) {
	const entries = openOoxml(data, "xlsx", limits);
	const workbook = object$2(parseXml(entries, "xl/workbook.xml").workbook);
	const workbookRels = relationshipMap(entries, "xl/_rels/workbook.xml.rels");
	const sharedStrings = workbookSharedStrings(entries);
	const formats = workbookFormats(entries);
	const sheets = [];
	const cells = [];
	const formulas = [];
	const outline = [];
	const blocks = [];
	const tables = [];
	const images = [];
	const warnings = [];
	if (Object.keys(entries).some((path) => path.startsWith("xl/externalLinks/"))) warnings.push({
		code: "XLSX_EXTERNAL_REFERENCE_NOT_RESOLVED",
		message: "External workbook references were preserved as metadata but were not refreshed.",
		locator: {
			kind: "xlsx",
			path: "xl/externalLinks/"
		}
	});
	if (entries["xl/connections.xml"] !== void 0 || Object.keys(entries).some((path) => path.startsWith("xl/model/"))) warnings.push({
		code: "XLSX_DATA_MODEL_NOT_PARSED",
		message: "External data connections or workbook data-model content were not evaluated.",
		locator: {
			kind: "xlsx",
			path: "xl/connections.xml"
		}
	});
	for (const [sheetIndex, rawSheet] of values$2(object$2(workbook.sheets).sheet).entries()) {
		const sheetNode = object$2(rawSheet);
		const sheetName = string(sheetNode["@_name"]) ?? `Sheet${sheetIndex + 1}`;
		const relationshipId = string(sheetNode["@_id"]);
		const target = relationshipId === void 0 ? void 0 : workbookRels.get(relationshipId);
		if (target === void 0) {
			warnings.push({
				code: "XLSX_SHEET_PART_MISSING",
				message: `Worksheet ${sheetName} could not be resolved.`,
				locator: {
					kind: "xlsx",
					sheet: sheetName
				}
			});
			continue;
		}
		const sheetPath = resolvePart$1("xl/workbook.xml", target);
		const worksheet = object$2(parseXml(entries, sheetPath).worksheet);
		const range = string(object$2(worksheet.dimension)["@_ref"]);
		const stateValue = string(sheetNode["@_state"]);
		const state = stateValue === "hidden" || stateValue === "veryHidden" ? stateValue : "visible";
		sheets.push({
			name: sheetName,
			state,
			...range === void 0 ? {} : { range }
		});
		outline.push({
			id: `sheet-${sheetIndex + 1}`,
			title: sheetName,
			level: 1,
			locator: {
				kind: "xlsx",
				sheet: sheetName,
				...range === void 0 ? {} : { range }
			}
		});
		const byRow = /* @__PURE__ */ new Map();
		for (const rowValue of values$2(object$2(worksheet.sheetData).row)) {
			const rowNode = object$2(rowValue);
			for (const cellValueNode of values$2(rowNode.c)) {
				const cellNode = object$2(cellValueNode);
				const address = string(cellNode["@_r"]);
				if (address === void 0) continue;
				const coordinates = cellCoordinates(address);
				if (coordinates === void 0) continue;
				const value = cellValue(cellNode, sharedStrings);
				const formula = formulaText(cellNode.f);
				const savedText = string(cellNode.v);
				const savedValue = savedText === void 0 || savedText === "" ? void 0 : savedText;
				cells.push({
					sheet: sheetName,
					cell: address,
					value,
					...formula.text === void 0 ? {} : { formula: `=${formula.text}` },
					...savedValue === void 0 ? {} : { savedValue }
				});
				const row = byRow.get(coordinates.row) ?? /* @__PURE__ */ new Map();
				row.set(coordinates.column, value);
				byRow.set(coordinates.row, row);
				if (cellNode.f !== void 0) {
					const numberFormat = formats[Number(string(cellNode["@_s"]) ?? "0")];
					const status = formula.sharedFollower ? savedValue === void 0 ? "UNSUPPORTED_FORMULA" : "SAVED_VALUE_ONLY" : formula.text === void 0 ? savedValue === void 0 ? "UNSUPPORTED_FORMULA" : "SAVED_VALUE_ONLY" : savedValue === void 0 ? "FORMULA_ONLY" : "SAVED_CACHE";
					formulas.push({
						id: `formula-${sheetIndex + 1}-${address}`,
						sheet: sheetName,
						cell: address,
						...formula.text === void 0 ? {} : { formula: `=${formula.text}` },
						...savedValue === void 0 ? {} : { savedValue },
						...numberFormat === void 0 ? {} : { numberFormat },
						status,
						...formula.sharedFollower ? { warning: "Shared-formula follower has a saved value but no independently stored formula." } : {}
					});
				}
			}
		}
		blocks.push(...parseComments(entries, sheetPath, sheetName));
		for (const merge of values$2(object$2(worksheet.mergeCells).mergeCell)) {
			const merged = string(object$2(merge)["@_ref"]);
			if (merged !== void 0) blocks.push({
				id: `merge-${sheetIndex + 1}-${merged}`,
				type: "cell-row",
				text: `Merged range ${merged}`,
				locator: {
					kind: "xlsx",
					sheet: sheetName,
					range: merged
				}
			});
		}
		const rowNumbers = [...byRow.keys()].sort((a, b) => a - b);
		const firstRow = rowNumbers.at(0);
		if (firstRow !== void 0) {
			const maxColumn = Math.max(...[...byRow.values()].flatMap((row) => [...row.keys()]));
			const headerRow = byRow.get(firstRow);
			const headers = Array.from({ length: maxColumn }, (_, index) => headerRow?.get(index + 1) ?? columnName(index + 1));
			for (let start = 0; start < rowNumbers.length; start += limits.csvRowsPerBlock) {
				const selected = rowNumbers.slice(start, start + limits.csvRowsPerBlock);
				const first = selected.at(0);
				const last = selected.at(-1);
				if (first === void 0 || last === void 0) throw new AttachmentError("Worksheet row grouping failed.", "PARSER_OUTPUT_INVALID");
				tables.push({
					id: `sheet-${sheetIndex + 1}-rows-${first}-${last}`,
					title: sheetName,
					headers,
					rows: selected.map((rowNumber) => Array.from({ length: maxColumn }, (_, index) => byRow.get(rowNumber)?.get(index + 1) ?? "")),
					locator: {
						kind: "xlsx",
						sheet: sheetName,
						range: `A${first}:${columnName(maxColumn)}${last}`
					},
					truncated: false,
					totalRows: selected.length
				});
			}
		}
	}
	for (const path of Object.keys(entries).filter((path) => path.startsWith("xl/media/")).sort()) images.push({
		id: `image-${images.length + 1}`,
		locator: {
			kind: "xlsx",
			path
		},
		visionStatus: "NOT_REQUESTED"
	});
	for (const path of Object.keys(entries).filter((path) => /^xl\/(charts|pivotTables)\//u.test(path)).sort()) outline.push({
		id: `object-${outline.length + 1}`,
		title: posix.basename(path),
		level: 2,
		locator: {
			kind: "xlsx",
			path
		}
	});
	const coverageStatus = warnings.length === 0 ? "COMPLETE" : "PARTIAL";
	const omitted = [...warnings.some((warning) => warning.code === "XLSX_EXTERNAL_REFERENCE_NOT_RESOLVED") ? ["external-workbook-values"] : [], ...warnings.some((warning) => warning.code === "XLSX_DATA_MODEL_NOT_PARSED") ? ["external-data-and-data-model-values"] : []];
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "spreadsheet"
		},
		outline,
		blocks,
		tables,
		formulas,
		cells,
		sheets,
		images,
		warnings,
		coverage: {
			status: coverageStatus,
			included: [
				"worksheets",
				"sheet-state",
				"used-range",
				"cells",
				"formulas",
				"saved-values",
				"merged-ranges",
				"comments",
				"chart-and-pivot-metadata",
				"image-locators"
			],
			omitted,
			unsupported: [
				"macros",
				"external-data-refresh",
				"power-query",
				"power-pivot"
			]
		}
	};
}
//#endregion
//#region lib/types/office-document.js
/** OfficeCLI DOM normalization for DOCX and PPTX. */
function object$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function values$1(value) {
	return value === void 0 ? [] : Array.isArray(value) ? value : [value];
}
function optionalString(value) {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : void 0;
}
function node(value) {
	const record = object$1(value);
	const path = optionalString(record.path);
	const type = optionalString(record.type);
	if (path === void 0 || type === void 0) return void 0;
	const text = optionalString(record.text);
	const preview = optionalString(record.preview);
	const style = optionalString(record.style);
	return {
		path,
		type,
		...text === void 0 ? {} : { text },
		...preview === void 0 ? {} : { preview },
		...style === void 0 ? {} : { style },
		format: object$1(record.format),
		children: values$1(record.children).map(node).filter((child) => child !== void 0)
	};
}
function results(response) {
	const [first, ...rest] = values$1(object$1(response.data).results).map(node).filter((entry) => entry !== void 0);
	if (first === void 0) throw new AttachmentError("Office parser returned no document root.", "PARSER_OUTPUT_INVALID");
	return [first, ...rest];
}
function slideFromPath(path) {
	const match = /^\/slide\[([1-9][0-9]*)\]/u.exec(path);
	return match === null ? void 0 : Number(match[1]);
}
function locator(kind, path) {
	const slide = kind === "pptx" ? slideFromPath(path) : void 0;
	return {
		kind,
		path,
		...slide === void 0 ? {} : { slide }
	};
}
function tableFromNode(value, kind, index) {
	const rowTypes = new Set(["row", "tr"]);
	const cellTypes = new Set(["cell", "tc"]);
	const rowNodes = value.children.filter((child) => rowTypes.has(child.type));
	const rows = rowNodes.map((row) => row.children.filter((child) => cellTypes.has(child.type)).map((cell) => cell.text ?? ""));
	const mergedCells = [];
	const vertical = /* @__PURE__ */ new Map();
	for (const [rowIndex, row] of rowNodes.entries()) {
		let column = 1;
		for (const cell of row.children.filter((child) => cellTypes.has(child.type))) {
			const columnSpan = Math.max(1, Number(cell.format.gridSpan ?? cell.format.colSpan ?? 1));
			const declaredRowSpan = Math.max(1, Number(cell.format.rowSpan ?? 1));
			const verticalMode = optionalString(cell.format.vmerge)?.toLowerCase();
			if (verticalMode === "continue") {
				const mergeIndex = vertical.get(column);
				const merged = mergeIndex === void 0 ? void 0 : mergedCells[mergeIndex];
				if (merged !== void 0) merged.rowSpan += 1;
			} else {
				for (let offset = 0; offset < columnSpan; offset += 1) vertical.delete(column + offset);
				if (verticalMode === "restart" || columnSpan > 1 || declaredRowSpan > 1) {
					const mergeIndex = mergedCells.push({
						row: rowIndex + 1,
						column,
						rowSpan: declaredRowSpan,
						columnSpan
					}) - 1;
					if (verticalMode === "restart") for (let offset = 0; offset < columnSpan; offset += 1) vertical.set(column + offset, mergeIndex);
				}
			}
			column += columnSpan;
		}
	}
	const headers = rows[0] ?? [];
	const title = optionalString(value.format.name) ?? value.preview;
	return {
		id: `table-${index}`,
		...title === void 0 ? {} : { title },
		headers,
		rows: rows.slice(1),
		locator: locator(kind, value.path),
		truncated: false,
		totalRows: Math.max(0, rows.length - 1),
		...mergedCells.length === 0 ? {} : { mergedCells }
	};
}
function imageFromNode(value, kind, index) {
	const altText = optionalString(value.format.altText) ?? optionalString(value.format.description) ?? optionalString(value.format.name);
	return {
		id: `image-${index}`,
		...altText === void 0 ? {} : { altText },
		locator: locator(kind, value.path),
		visionStatus: "NOT_REQUESTED"
	};
}
function normalizeTree(root, kind) {
	const outline = [];
	const blocks = [];
	const tables = [];
	const images = [];
	let currentHeading;
	const visit = (value) => {
		if (value.type === "table") {
			tables.push(tableFromNode(value, kind, tables.length + 1));
			return;
		}
		if (value.type === "picture" || value.type === "image") {
			images.push(imageFromNode(value, kind, images.length + 1));
			return;
		}
		const insideTable = value.path.includes("/tbl[") || value.path.includes("/table[");
		const text = value.text?.trim();
		if (!insideTable && text !== void 0 && text !== "") {
			const headingStyle = `${value.style ?? ""} ${optionalString(value.format.styleName) ?? ""}`;
			const headingMatch = /heading\s*([1-9])/iu.exec(headingStyle);
			const isSlideTitle = kind === "pptx" && (value.type === "title" || value.format.isTitle === true);
			const isHeading = headingMatch !== null || isSlideTitle;
			const blockId = `block-${blocks.length + 1}`;
			const blockType = value.type === "notes" ? "note" : value.type.includes("comment") ? "comment" : isHeading ? "heading" : "paragraph";
			blocks.push({
				id: blockId,
				type: blockType,
				text,
				locator: locator(kind, value.path),
				...currentHeading === void 0 || isHeading ? {} : { parentId: currentHeading }
			});
			if (isHeading) {
				currentHeading = blockId;
				outline.push({
					id: `outline-${outline.length + 1}`,
					title: text,
					level: isSlideTitle ? 1 : Number(headingMatch?.[1] ?? 1),
					locator: locator(kind, value.path)
				});
			}
		}
		for (const child of value.children) visit(child);
	};
	visit(root);
	return {
		outline,
		blocks,
		tables,
		images
	};
}
function titleFromRoot(root) {
	const value = optionalString(root.format.title)?.trim();
	return value === "" ? void 0 : value;
}
/**
* Parse a DOCX through the fixed OfficeCLI semantic DOM.
* @param office - pinned OfficeCLI process adapter.
* @param path - private temporary path containing the original DOCX bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @param signal - optional cancellation for OfficeCLI calls.
* @returns a normalized document with semantic paths and coverage metadata.
*/
async function parseDocx(office, path, attachmentId, name, signal) {
	const cwd = path.substring(0, path.lastIndexOf("/"));
	const root = results(await office.json([
		"get",
		path,
		"/",
		"--depth",
		"2"
	], cwd, signal))[0];
	const contentPaths = root.children.filter((child) => !["styles", "numbering"].includes(child.type)).map((child) => child.path);
	const contentRoots = await Promise.all(contentPaths.map(async (contentPath) => results(await office.json([
		"get",
		path,
		contentPath,
		"--depth",
		"16"
	], cwd, signal))[0]));
	const normalized = normalizeTree({
		...root,
		children: contentRoots
	}, "docx");
	const title = titleFromRoot(root);
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "document",
			...title === void 0 ? {} : { title }
		},
		...normalized,
		formulas: [],
		cells: [],
		sheets: [],
		warnings: [],
		coverage: {
			status: "COMPLETE",
			included: [
				"body",
				"headings",
				"paragraphs",
				"tables",
				"headers-and-footers",
				"footnotes-and-endnotes",
				"comments",
				"links-and-fields",
				"image-locators"
			],
			omitted: [],
			unsupported: [
				"macros",
				"ole-execution",
				"image-ocr"
			]
		}
	};
}
/**
* Parse a PPTX through OfficeCLI, retaining notes separately from slide text.
* @param office - pinned OfficeCLI process adapter.
* @param path - private temporary path containing the original PPTX bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @param signal - optional cancellation for OfficeCLI calls.
* @returns a normalized presentation with slide, note, table, and image locators.
*/
async function parsePptx(office, path, attachmentId, name, signal) {
	const cwd = path.substring(0, path.lastIndexOf("/"));
	const [rootResponse, notesResponse] = await Promise.all([office.json([
		"get",
		path,
		"/",
		"--depth",
		"16"
	], cwd, signal), office.json([
		"query",
		path,
		"notes, comment"
	], cwd, signal)]);
	const root = results(rootResponse)[0];
	const normalized = normalizeTree(root, "pptx");
	const title = titleFromRoot(root);
	const notes = values$1(object$1(notesResponse.data).results).map(node).filter((entry) => entry !== void 0);
	for (const entry of notes) {
		const text = entry.text?.trim();
		if (text === void 0 || text === "") continue;
		normalized.blocks.push({
			id: `block-${normalized.blocks.length + 1}`,
			type: entry.type.includes("comment") ? "comment" : "note",
			text,
			locator: locator("pptx", entry.path)
		});
	}
	if (normalized.outline.length === 0) for (const child of root.children.filter((child) => child.type === "slide")) normalized.outline.push({
		id: `outline-${normalized.outline.length + 1}`,
		title: child.preview ?? `Slide ${slideFromPath(child.path) ?? normalized.outline.length + 1}`,
		level: 1,
		locator: locator("pptx", child.path)
	});
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "presentation",
			...title === void 0 ? {} : { title }
		},
		...normalized,
		formulas: [],
		cells: [],
		sheets: [],
		warnings: [],
		coverage: {
			status: "COMPLETE",
			included: [
				"slides",
				"shape-text",
				"grouped-shapes",
				"tables",
				"notes",
				"comments",
				"chart-text",
				"image-locators"
			],
			omitted: [],
			unsupported: [
				"macros",
				"embedded-object-execution",
				"image-ocr"
			]
		}
	};
}
//#endregion
//#region lib/types/xlsx-stream.js
/** Range-on-demand XLSX reader with bounded decompression and SAX XML parsing. */
const ARCHIVE_CHUNK_BYTES = 64 * 1024;
const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	removeNSPrefix: true,
	parseTagValue: false,
	trimValues: false
});
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function values(value) {
	return value === void 0 ? [] : Array.isArray(value) ? value : [value];
}
function text(value) {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : void 0;
}
function resolvePart(base, target) {
	const normalized = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(base), target));
	if (normalized.startsWith("../") || normalized.includes("/../")) throw new AttachmentError("OOXML relationship escapes the document package.", "DOCUMENT_CORRUPT");
	return normalized;
}
function streamEntry(data, target, onChunk) {
	const state = {
		found: false,
		completed: false,
		stopped: false,
		failure: void 0
	};
	const archive = new Unzip((file) => {
		if (file.name !== target) return;
		state.found = true;
		file.ondata = (error, chunk, final) => {
			if (error !== null) {
				state.failure = error;
				return;
			}
			try {
				if (onChunk(chunk, final) === false) {
					state.stopped = true;
					file.terminate();
					return;
				}
				if (final) state.completed = true;
			} catch (error_) {
				state.failure = error_ instanceof Error ? error_ : new Error(String(error_));
				file.terminate();
			}
		};
		file.start();
	});
	archive.register(UnzipInflate);
	archive.register(UnzipPassThrough);
	try {
		for (let offset = 0; offset < data.byteLength; offset += ARCHIVE_CHUNK_BYTES) {
			const end = Math.min(data.byteLength, offset + ARCHIVE_CHUNK_BYTES);
			archive.push(data.subarray(offset, end), end === data.byteLength);
			if (state.failure !== void 0) throw state.failure;
		}
	} catch (error) {
		throw new AttachmentError(`OOXML part ${target} could not be streamed.`, "DOCUMENT_CORRUPT", { cause: error });
	}
	if (!state.found) throw new AttachmentError(`OOXML part ${target} is missing.`, "DOCUMENT_CORRUPT");
	if (!state.completed && !state.stopped) throw new AttachmentError(`OOXML part ${target} ended unexpectedly.`, "DOCUMENT_CORRUPT");
}
function readEntry(data, target, maxBytes) {
	const chunks = [];
	let total = 0;
	streamEntry(data, target, (chunk) => {
		total += chunk.byteLength;
		if (total > maxBytes) throw new AttachmentError(`OOXML metadata part ${target} exceeds the parser-output limit.`, "DOCUMENT_RESOURCE_LIMIT");
		chunks.push(chunk.slice());
	});
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
function workbookDirectory(data, maxBytes) {
	let workbook;
	let relationships;
	try {
		const workbookRoot = xml.parse(new TextDecoder().decode(readEntry(data, "xl/workbook.xml", maxBytes)));
		const relationshipRoot = xml.parse(new TextDecoder().decode(readEntry(data, "xl/_rels/workbook.xml.rels", maxBytes)));
		workbook = object(object(workbookRoot).workbook);
		relationships = object(object(relationshipRoot).Relationships);
	} catch (error) {
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("XLSX workbook metadata is invalid.", "DOCUMENT_CORRUPT", { cause: error });
	}
	const targets = new Map(values(relationships.Relationship).map((entry) => {
		const relationship = object(entry);
		return [String(relationship["@_Id"]), String(relationship["@_Target"])];
	}));
	return values(object(workbook.sheets).sheet).map((entry, index) => {
		const sheet = object(entry);
		const name = text(sheet["@_name"]) ?? `Sheet${index + 1}`;
		const relationshipId = text(sheet["@_id"]);
		const target = relationshipId === void 0 ? void 0 : targets.get(relationshipId);
		if (target === void 0) throw new AttachmentError(`Worksheet ${name} could not be resolved.`, "DOCUMENT_CORRUPT");
		const rawState = text(sheet["@_state"]);
		return {
			name,
			state: rawState === "hidden" || rawState === "veryHidden" ? rawState : "visible",
			path: resolvePart("xl/workbook.xml", target)
		};
	});
}
function worksheetDimension(data, path) {
	const state = {
		range: void 0,
		failure: void 0
	};
	const parser = new SaxesParser({ xmlns: false });
	parser.on("error", (error) => {
		state.failure = error;
	});
	parser.on("opentag", (tag) => {
		const attributes = tag.attributes;
		if (tag.name.endsWith("dimension")) state.range = attributes.ref;
	});
	const needsMoreData = () => state.range === void 0;
	const decoder = new TextDecoder();
	streamEntry(data, path, (chunk, final) => {
		if (state.range !== void 0) return false;
		parser.write(decoder.decode(chunk, { stream: !final }));
		if (state.failure !== void 0) throw state.failure;
		if (final) parser.close();
		return needsMoreData();
	});
	if (state.failure !== void 0) throw new AttachmentError(`Worksheet ${path} is invalid.`, "DOCUMENT_CORRUPT", { cause: state.failure });
	return state.range;
}
function unsupportedWarnings(entries) {
	const warnings = [];
	if (entries.some((path) => path.startsWith("xl/externalLinks/"))) warnings.push({
		code: "XLSX_EXTERNAL_REFERENCE_NOT_RESOLVED",
		message: "External workbook references were preserved as metadata but were not refreshed.",
		locator: {
			kind: "xlsx",
			path: "xl/externalLinks/"
		}
	});
	if (entries.includes("xl/connections.xml") || entries.some((path) => path.startsWith("xl/model/"))) warnings.push({
		code: "XLSX_DATA_MODEL_NOT_PARSED",
		message: "External data connections or workbook data-model content were not evaluated.",
		locator: {
			kind: "xlsx",
			path: "xl/connections.xml"
		}
	});
	return warnings;
}
/**
* Build a small durable workbook directory while leaving sheet cells in the original CAS object.
* @param data - validated XLSX bytes.
* @param attachmentId - durable CAS identity assigned to the original bytes.
* @param name - sanitized user-visible file name, when supplied.
* @param limits - resolved archive, parser, and query limits.
* @returns compact worksheet metadata for range-on-demand access.
*/
function parseXlsxStreamingIndex(data, attachmentId, name, limits) {
	const stats = inspectArchive(data, limits);
	const sheets = workbookDirectory(data, limits.maxParserOutputBytes).map(({ path, ...sheet }) => {
		const range = worksheetDimension(data, path);
		return {
			...sheet,
			...range === void 0 ? {} : { range }
		};
	});
	const outline = sheets.map((sheet, index) => ({
		id: `sheet-${index + 1}`,
		title: sheet.name,
		level: 1,
		locator: {
			kind: "xlsx",
			sheet: sheet.name,
			...sheet.range === void 0 ? {} : { range: sheet.range }
		}
	}));
	const warnings = unsupportedWarnings(stats.entries);
	return {
		schemaVersion: "normalized-document.v1",
		document: {
			attachmentId,
			...name === void 0 ? {} : { name },
			kind: "spreadsheet"
		},
		outline,
		blocks: [],
		tables: [],
		formulas: [],
		cells: [],
		sheets,
		images: stats.entries.filter((path) => path.startsWith("xl/media/")).map((path, index) => ({
			id: `image-${index + 1}`,
			locator: {
				kind: "xlsx",
				path
			},
			visionStatus: "NOT_REQUESTED"
		})),
		warnings,
		coverage: {
			status: warnings.length === 0 ? "COMPLETE" : "PARTIAL",
			included: [
				"worksheets",
				"sheet-state",
				"used-range",
				"streamed-range-access",
				"formulas",
				"saved-values",
				"image-locators"
			],
			omitted: [...warnings.some((warning) => warning.code === "XLSX_EXTERNAL_REFERENCE_NOT_RESOLVED") ? ["external-workbook-values"] : [], ...warnings.some((warning) => warning.code === "XLSX_DATA_MODEL_NOT_PARSED") ? ["external-data-and-data-model-values"] : []],
			unsupported: [
				"macros",
				"external-data-refresh",
				"power-query",
				"power-pivot"
			]
		},
		streaming: { kind: "xlsx" }
	};
}
function address(value) {
	const match = /^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(value.toUpperCase());
	if (match === null) return void 0;
	const letters = match[1];
	const row = match[2];
	if (letters === void 0 || row === void 0) return void 0;
	let column = 0;
	for (const character of letters) column = column * 26 + character.charCodeAt(0) - 64;
	return {
		row: Number(row),
		column
	};
}
function bounds(range) {
	const [firstText, lastText = firstText] = range.split(":");
	const first = firstText === void 0 ? void 0 : address(firstText);
	const last = lastText === void 0 ? void 0 : address(lastText);
	if (first === void 0 || last === void 0) throw new AttachmentError(`Invalid spreadsheet range ${range}.`, "PARSER_OUTPUT_INVALID");
	return {
		firstRow: Math.min(first.row, last.row),
		lastRow: Math.max(first.row, last.row),
		firstColumn: Math.min(first.column, last.column),
		lastColumn: Math.max(first.column, last.column)
	};
}
function rawRange(data, path, range, maxCells) {
	const selected = bounds(range);
	const cells = [];
	let current;
	let capture;
	let parseFailure;
	const parser = new SaxesParser({ xmlns: false });
	parser.on("error", (error) => {
		parseFailure = error;
	});
	parser.on("opentag", (tag) => {
		const local = tag.name.includes(":") ? tag.name.slice(tag.name.lastIndexOf(":") + 1) : tag.name;
		const attributes = tag.attributes;
		if (local === "c") {
			const cell = attributes.r;
			const point = cell === void 0 ? void 0 : address(cell);
			current = cell !== void 0 && point !== void 0 && point.row >= selected.firstRow && point.row <= selected.lastRow && point.column >= selected.firstColumn && point.column <= selected.lastColumn && cells.length < maxCells ? {
				cell,
				type: attributes.t,
				value: "",
				inlineText: "",
				formula: "",
				formulaType: void 0,
				formulaSeen: false
			} : void 0;
			return;
		}
		if (current === void 0) return;
		if (local === "v") capture = "value";
		else if (local === "f") {
			capture = "formula";
			current.formulaSeen = true;
			current.formulaType = attributes.t;
		} else if (local === "t" && current.type === "inlineStr") capture = "inline";
	});
	parser.on("text", (value) => {
		if (current === void 0 || capture === void 0) return;
		if (capture === "value") current.value += value;
		else if (capture === "formula") current.formula += value;
		else current.inlineText += value;
	});
	parser.on("closetag", (tag) => {
		const local = tag.name.includes(":") ? tag.name.slice(tag.name.lastIndexOf(":") + 1) : tag.name;
		if (local === "v" || local === "f" || local === "t") capture = void 0;
		if (local === "c" && current !== void 0) {
			cells.push(current);
			current = void 0;
		}
	});
	const decoder = new TextDecoder();
	streamEntry(data, path, (chunk, final) => {
		parser.write(decoder.decode(chunk, { stream: !final }));
		if (parseFailure !== void 0) throw parseFailure;
		if (final) parser.close();
	});
	if (parseFailure !== void 0) throw new AttachmentError(`Worksheet ${path} is invalid.`, "DOCUMENT_CORRUPT", { cause: parseFailure });
	return cells;
}
function sharedStringValues(data, wanted, hasPart) {
	const result = /* @__PURE__ */ new Map();
	if (!hasPart || wanted.size === 0) return result;
	let index = -1;
	let capture = false;
	let value = "";
	let parseFailure;
	const parser = new SaxesParser({ xmlns: false });
	parser.on("error", (error) => {
		parseFailure = error;
	});
	parser.on("opentag", (tag) => {
		const local = tag.name.includes(":") ? tag.name.slice(tag.name.lastIndexOf(":") + 1) : tag.name;
		if (local === "si") {
			index += 1;
			value = "";
		} else if (local === "t" && wanted.has(index)) capture = true;
	});
	parser.on("text", (part) => {
		if (capture) value += part;
	});
	parser.on("closetag", (tag) => {
		const local = tag.name.includes(":") ? tag.name.slice(tag.name.lastIndexOf(":") + 1) : tag.name;
		if (local === "t") capture = false;
		if (local === "si" && wanted.has(index)) result.set(index, value);
	});
	const decoder = new TextDecoder();
	streamEntry(data, "xl/sharedStrings.xml", (chunk, final) => {
		parser.write(decoder.decode(chunk, { stream: !final }));
		if (parseFailure !== void 0) throw parseFailure;
		if (final) parser.close();
	});
	if (parseFailure !== void 0) throw new AttachmentError("XLSX shared strings are invalid.", "DOCUMENT_CORRUPT", { cause: parseFailure });
	return result;
}
/**
* Read one exact large-workbook range without materializing the worksheet or shared-string table.
* @param data - original XLSX bytes read from CAS.
* @param sheet - exact worksheet name selected by the model.
* @param range - A1-style inclusive range requested by the model.
* @param limits - resolved archive, parser, and query limits.
* @returns bounded cell and formula records from the selected range.
*/
function readXlsxRangeStreaming(data, sheet, range, limits) {
	const stats = inspectArchive(data, limits);
	const selected = workbookDirectory(data, limits.maxParserOutputBytes).find((entry) => entry.name === sheet);
	if (selected === void 0) throw new AttachmentError(`Worksheet ${sheet} does not exist.`, "PARSER_OUTPUT_INVALID");
	const raw = rawRange(data, selected.path, range, limits.maxQueryItems);
	const strings = sharedStringValues(data, new Set(raw.filter((cell) => cell.type === "s").map((cell) => Number(cell.value)).filter(Number.isInteger)), stats.entries.includes("xl/sharedStrings.xml"));
	const items = [];
	for (const cell of raw) {
		const value = cell.type === "s" ? strings.get(Number(cell.value)) ?? "" : cell.type === "inlineStr" ? cell.inlineText : cell.type === "b" ? cell.value === "1" ? "TRUE" : "FALSE" : cell.value;
		const formula = cell.formula === "" ? void 0 : `=${cell.formula}`;
		const savedValue = cell.formulaSeen && cell.value !== "" ? cell.value : void 0;
		items.push({
			sheet,
			cell: cell.cell,
			value,
			...formula === void 0 ? {} : { formula },
			...savedValue === void 0 ? {} : { savedValue }
		});
		if (cell.formulaSeen && items.length < limits.maxQueryItems) {
			const sharedFollower = cell.formulaType === "shared" && formula === void 0;
			const status = sharedFollower ? savedValue === void 0 ? "UNSUPPORTED_FORMULA" : "SAVED_VALUE_ONLY" : formula === void 0 ? savedValue === void 0 ? "UNSUPPORTED_FORMULA" : "SAVED_VALUE_ONLY" : savedValue === void 0 ? "FORMULA_ONLY" : "SAVED_CACHE";
			items.push({
				id: `formula-stream-${sheet}-${cell.cell}`,
				sheet,
				cell: cell.cell,
				...formula === void 0 ? {} : { formula },
				...savedValue === void 0 ? {} : { savedValue },
				status,
				...sharedFollower ? { warning: "Shared-formula follower has a saved value but no independently stored formula." } : {}
			});
		}
		if (items.length >= limits.maxQueryItems) break;
	}
	return items;
}
//#endregion
//#region lib/types/document-pipeline.js
/** Durable structured-document admission, normalization cache, and bounded query engine. */
const CACHE_SCHEMA = "attachment-document-cache.v1";
const PIPELINE_VERSION = `dsh-document-1+officecli-${OFFICECLI_VERSION}`;
const COMPOUND_FILE_MAGIC = Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225);
var ParsePool = class {
	limit;
	active = 0;
	waiters = [];
	constructor(limit) {
		this.limit = limit;
	}
	acquire(signal) {
		signal?.throwIfAborted();
		if (this.active < this.limit) {
			this.active += 1;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const waiter = {
				resolve,
				reject,
				...signal === void 0 ? {} : { signal }
			};
			if (signal !== void 0) {
				waiter.abort = () => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("Document parsing was aborted."));
				};
				signal.addEventListener("abort", waiter.abort, { once: true });
			}
			this.waiters.push(waiter);
		});
	}
	release() {
		const waiter = this.waiters.shift();
		if (waiter === void 0) {
			this.active -= 1;
			return;
		}
		if (waiter.signal !== void 0 && waiter.abort !== void 0) waiter.signal.removeEventListener("abort", waiter.abort);
		waiter.resolve();
	}
	async run(operation, signal) {
		await this.acquire(signal);
		try {
			return await operation();
		} finally {
			this.release();
		}
	}
};
function startsWith(data, magic) {
	return data.byteLength >= magic.byteLength && magic.every((byte, index) => data[index] === byte);
}
function family(mediaType) {
	switch (mediaType) {
		case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
		case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
		case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";
		case "text/csv": return "csv";
	}
}
function extensionFor(mediaType) {
	return family(mediaType);
}
function legacyName(name) {
	return name !== void 0 && /\.(doc|xls|ppt)$/iu.test(name);
}
/**
* Validate the complete file boundary before publishing any session-visible reference.
* @param input - original structured-document bytes and declared metadata.
* @param limits - resolved archive, parser, and attachment resource limits.
*/
function validateDocumentFile(input, limits) {
	if (input.data.byteLength === 0) throw new AttachmentError("Document attachment is empty.", "DOCUMENT_CORRUPT");
	if (input.data.byteLength > limits.maxDocumentBytes) throw new AttachmentError("Document attachment exceeds the configured byte limit.", "FILE_TOO_LARGE");
	if (legacyName(input.name)) throw new AttachmentError("Legacy Office files must be converted to DOCX, XLSX, or PPTX before upload.", "LEGACY_OFFICE_UNSUPPORTED");
	const kind = family(input.mediaType);
	if (kind === "csv") {
		validateCsvEncoding(input.data);
		return;
	}
	if (startsWith(input.data, COMPOUND_FILE_MAGIC)) throw new AttachmentError("Encrypted or legacy Office packages are not supported.", "ENCRYPTED_DOCUMENT_UNSUPPORTED");
	const archive = inspectArchive(input.data, limits);
	const required = kind === "docx" ? "word/document.xml" : kind === "xlsx" ? "xl/workbook.xml" : "ppt/presentation.xml";
	if (!archive.entries.includes(required)) throw new AttachmentError("Declared Office type does not match the package contents.", "FILE_TYPE_MISMATCH");
	inspectXmlNodes(input.data, limits);
}
function limitsFingerprint(limits) {
	const stable = {
		maxDocumentBytes: limits.maxDocumentBytes,
		maxDecompressedBytes: limits.maxDecompressedBytes,
		maxArchiveEntries: limits.maxArchiveEntries,
		maxCompressionRatio: limits.maxCompressionRatio,
		maxXmlNodes: limits.maxXmlNodes,
		maxParserOutputBytes: limits.maxParserOutputBytes,
		parseTimeoutMs: limits.parseTimeoutMs,
		maxPreviewCharacters: limits.maxPreviewCharacters,
		csvRowsPerBlock: limits.csvRowsPerBlock,
		streamThresholdBytes: limits.streamThresholdBytes
	};
	return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 12);
}
function cachePath(root, sha256, parserVersion) {
	const fingerprint = createHash("sha256").update(parserVersion).digest("hex");
	return join(root, "documents", sha256.slice(0, 2), `${sha256}-${fingerprint}.json`);
}
function cacheEnvelope(value, expectedSha256, parserVersion) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AttachmentError("Document cache has an invalid root.", "ATTACHMENT_INDEX_FAILED");
	const record = value;
	if (record.schemaVersion !== CACHE_SCHEMA || record.parserVersion !== parserVersion || record.sourceSha256 !== expectedSha256 || record.document?.schemaVersion !== "normalized-document.v1") throw new AttachmentError("Document cache does not match its durable reference.", "ATTACHMENT_INDEX_FAILED");
	return record;
}
async function readCache(path, sha256, parserVersion) {
	try {
		return cacheEnvelope(JSON.parse(await readFile(path, "utf8")), sha256, parserVersion);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return void 0;
		if (error instanceof AttachmentError) throw error;
		throw new AttachmentError("Document cache could not be read.", "ATTACHMENT_INDEX_FAILED", { cause: error });
	}
}
async function publishCache(root, path, envelope) {
	const directory = dirname(path);
	const boundary = resolve(dirname(dirname(root)));
	await ensureDurableDirectory(directory, boundary);
	const staging = join(root, "tmp");
	await ensureDurableDirectory(staging, boundary);
	const temporary = join(staging, randomUUID());
	let handle;
	try {
		handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 384);
		await handle.writeFile(JSON.stringify(envelope));
		await handle.sync();
		await handle.close();
		handle = void 0;
		await rename(temporary, path);
		await syncDirectory(directory);
	} catch (error) {
		if (handle !== void 0) await handle.close().catch(() => {});
		await rm(temporary, { force: true }).catch(() => {});
		throw new AttachmentError("Document index could not be persisted.", "ATTACHMENT_INDEX_FAILED", { cause: error });
	}
}
function preview(document, maxCharacters) {
	return [
		`${document.document.kind} · ${document.coverage.status}`,
		...document.outline.slice(0, 12).map((item) => {
			const location = item.locator.path ?? (item.locator.sheet === void 0 ? void 0 : `${item.locator.sheet}${item.locator.range === void 0 ? "" : `!${item.locator.range}`}`) ?? (item.locator.slide === void 0 ? void 0 : `slide ${item.locator.slide}`);
			return `${"  ".repeat(Math.max(0, item.level - 1))}${item.title}${location === void 0 ? "" : ` · ${location}`}`;
		}),
		`${document.blocks.length} blocks · ${document.tables.length} tables · ${document.formulas.length} formulas`,
		...document.warnings.slice(0, 3).map((warning) => `Warning: ${warning.message}`)
	].join("\n").slice(0, maxCharacters);
}
function parseAddress(value) {
	const match = /^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(value.toUpperCase());
	if (match === null) throw new AttachmentError(`Invalid spreadsheet cell ${value}.`, "PARSER_OUTPUT_INVALID");
	const letters = match[1];
	const row = match[2];
	if (letters === void 0 || row === void 0) throw new AttachmentError(`Invalid spreadsheet cell ${value}.`, "PARSER_OUTPUT_INVALID");
	let column = 0;
	for (const char of letters) column = column * 26 + char.charCodeAt(0) - 64;
	return {
		row: Number(row),
		column
	};
}
function inRange(cell, range) {
	const [startText, endText = startText] = range.split(":");
	if (startText === void 0 || endText === void 0) throw new AttachmentError(`Invalid spreadsheet range ${range}.`, "PARSER_OUTPUT_INVALID");
	const start = parseAddress(startText);
	const end = parseAddress(endText);
	const value = parseAddress(cell);
	return value.row >= Math.min(start.row, end.row) && value.row <= Math.max(start.row, end.row) && value.column >= Math.min(start.column, end.column) && value.column <= Math.max(start.column, end.column);
}
function itemText(item) {
	if ("text" in item) return item.text;
	if ("title" in item && typeof item.title === "string") return item.title;
	if ("rows" in item) return [item.headers.join("	"), ...item.rows.map((row) => row.join("	"))].join("\n");
	if ("value" in item) return `${item.sheet}!${item.cell} ${item.value}`;
	if ("status" in item && "cell" in item) return `${item.sheet}!${item.cell} ${item.formula ?? ""} ${item.savedValue ?? ""}`;
	if ("name" in item) return item.name;
	if ("altText" in item) return item.altText ?? "";
	return "";
}
function queryItems(document, query, limits) {
	const every = [
		...document.outline,
		...document.blocks,
		...document.tables,
		...document.formulas,
		...document.cells,
		...document.sheets,
		...document.images
	];
	switch (query.kind) {
		case "outline": return [...document.outline, ...document.sheets].slice(0, limits.maxQueryItems);
		case "search": {
			const needle = query.query.trim().toLocaleLowerCase();
			if (needle === "") throw new AttachmentError("Document search query must not be empty.", "PARSER_OUTPUT_INVALID");
			return every.filter((item) => itemText(item).toLocaleLowerCase().includes(needle)).slice(0, Math.min(query.limit, limits.maxSearchResults));
		}
		case "blocks": {
			const ids = new Set(query.blockIds);
			return every.filter((item) => "id" in item && ids.has(item.id)).slice(0, limits.maxQueryItems);
		}
		case "spreadsheet-range": return [...document.cells.filter((cell) => cell.sheet === query.sheet && inRange(cell.cell, query.range)), ...document.formulas.filter((formula) => formula.sheet === query.sheet && inRange(formula.cell, query.range))].slice(0, limits.maxQueryItems);
		case "slide": return every.filter((item) => {
			return ("locator" in item ? item.locator : void 0)?.slide === query.slide && (query.includeNotes || !("type" in item && item.type === "note"));
		}).slice(0, limits.maxQueryItems);
		case "document-path": return every.filter((item) => "locator" in item && item.locator.path?.startsWith(query.path)).slice(0, limits.maxQueryItems);
	}
}
/** Stateful local pipeline with one concurrency owner and durable derived cache. */
var DocumentPipeline = class {
	root;
	limits;
	/** Cache identity shared by references and normalized-document envelopes. */
	parserVersion;
	office;
	pool;
	constructor(ctx, root, limits, officeCliPath) {
		this.root = root;
		this.limits = limits;
		this.parserVersion = `${PIPELINE_VERSION}+limits-${limitsFingerprint(limits)}`;
		this.office = new OfficeCli(ctx, {
			...officeCliPath === void 0 ? {} : { executable: officeCliPath },
			timeoutMs: limits.parseTimeoutMs,
			maxOutputBytes: limits.maxParserOutputBytes
		});
		this.pool = new ParsePool(limits.maxConcurrentParses);
	}
	/**
	* Validate one structured document without committing it.
	* @param input - original document bytes and declared metadata.
	*/
	validate(input) {
		validateDocumentFile(input, this.limits);
	}
	async parse(input, attachmentId, name, signal) {
		const kind = family(input.mediaType);
		if (kind === "csv") return input.data.byteLength >= this.limits.streamThresholdBytes ? parseCsvStreamingIndex(input.data, attachmentId, name) : parseCsv(input.data, attachmentId, name, this.limits);
		if (kind === "xlsx") {
			const archive = inspectArchive(input.data, this.limits);
			if (input.data.byteLength >= this.limits.streamThresholdBytes || archive.totalUncompressedBytes >= this.limits.streamThresholdBytes || archive.largestEntryBytes >= this.limits.streamThresholdBytes) return parseXlsxStreamingIndex(input.data, attachmentId, name, this.limits);
		}
		const base = join(this.root, "tmp");
		await ensureDurableDirectory(base, resolve(dirname(dirname(this.root))));
		const task = await mkdtemp(join(base, "document-"));
		await chmod(task, 448);
		const source = join(task, `source.${extensionFor(input.mediaType)}`);
		const handle = await open(source, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 384);
		try {
			await handle.writeFile(input.data);
			await handle.sync();
		} finally {
			await handle.close();
		}
		try {
			if (kind === "docx") return await parseDocx(this.office, source, attachmentId, name, signal);
			if (kind === "pptx") return await parsePptx(this.office, source, attachmentId, name, signal);
			await this.office.json([
				"view",
				source,
				"text",
				"--max-lines",
				"1"
			], task, signal);
			return parseXlsx(input.data, attachmentId, name, this.limits);
		} finally {
			const resolved = resolve(task);
			if (resolved.startsWith(`${resolve(base)}${sep}`)) await rm(resolved, {
				recursive: true,
				force: true
			});
		}
	}
	/**
	* Validate, persist, normalize, and cache one structured document.
	* @param input - original document bytes and declared metadata.
	* @param signal - optional cancellation for parsing and storage work.
	* @returns a durable session-safe reference with bounded preview and coverage.
	*/
	async save(input, signal) {
		this.validate(input);
		const sha256 = await publishObject(this.root, input.data);
		const attachmentId = AttachmentId(`sha256:${sha256}`);
		const name = displayName(input.name);
		const path = cachePath(this.root, sha256, this.parserVersion);
		let cached = await readCache(path, sha256, this.parserVersion);
		if (cached === void 0) cached = await this.pool.run(async () => {
			const raced = await readCache(path, sha256, this.parserVersion);
			if (raced !== void 0) return raced;
			const document = await this.parse(input, attachmentId, name, signal);
			const envelope = {
				schemaVersion: CACHE_SCHEMA,
				parserVersion: this.parserVersion,
				sourceSha256: sha256,
				document
			};
			await publishCache(this.root, path, envelope);
			return envelope;
		}, signal);
		const document = cached.document;
		return {
			attachmentId,
			mediaType: input.mediaType,
			bytes: input.data.byteLength,
			documentKind: document.document.kind,
			status: document.coverage.status === "COMPLETE" ? "READY" : "PARTIAL",
			coverage: document.coverage,
			warnings: document.warnings,
			preview: preview(document, this.limits.maxPreviewCharacters),
			parserVersion: this.parserVersion,
			...name === void 0 ? {} : { name }
		};
	}
	/**
	* Read and integrity-check one structured document's original bytes.
	* @param ref - durable reference already authorized by the caller.
	* @param signal - optional cancellation for storage work.
	* @returns verified original bytes paired with their canonical reference.
	*/
	async read(ref, signal) {
		const data = await readObject(this.root, ref, signal);
		if (data.byteLength !== ref.bytes) throw new AttachmentError("Stored document metadata does not match its reference.", "ATTACHMENT_CORRUPT");
		return {
			ref,
			data
		};
	}
	/**
	* Execute one bounded progressive-read query against a normalized document.
	* @param ref - durable reference already authorized by the caller.
	* @param query - outline, search, block, range, slide, or semantic-path request.
	* @param signal - optional cancellation for cache and CAS reads.
	* @returns bounded items with the document's coverage and warnings.
	*/
	async query(ref, query, signal) {
		signal?.throwIfAborted();
		const sha256 = ensureReference(ref);
		const cached = await readCache(cachePath(this.root, sha256, ref.parserVersion), sha256, ref.parserVersion);
		if (cached === void 0) throw new AttachmentError("Document index is missing.", "ATTACHMENT_INDEX_FAILED");
		signal?.throwIfAborted();
		let items;
		if (query.kind === "spreadsheet-range" && cached.document.streaming !== void 0) {
			const data = await readObject(this.root, ref, signal);
			if (cached.document.streaming.kind === "csv") {
				if (query.sheet !== "CSV") throw new AttachmentError(`Worksheet ${query.sheet} does not exist.`, "PARSER_OUTPUT_INVALID");
				items = readCsvRangeStreaming(data, query.range, this.limits);
			} else items = readXlsxRangeStreaming(data, query.sheet, query.range, this.limits);
		} else items = queryItems(cached.document, query, this.limits);
		signal?.throwIfAborted();
		return {
			attachmentId: ref.attachmentId,
			...ref.name === void 0 ? {} : { name: ref.name },
			documentKind: ref.documentKind,
			queryKind: query.kind,
			items,
			coverage: cached.document.coverage,
			warnings: cached.document.warnings
		};
	}
};
//#endregion
//#region lib/types/index.js
/** Local durable attachment backend rooted below `DSH_HOME`. @module @deepseek-ai/dsh-attachment-local */
/** Default maximum encoded bytes for one image. */
const DEFAULT_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
/** Default maximum images in one prompt. */
const DEFAULT_MAX_IMAGES_PER_MESSAGE = 20;
/** Default maximum aggregate image bytes in one prompt. */
const DEFAULT_MAX_MESSAGE_IMAGE_BYTES = 100 * 1024 * 1024;
/** Default maximum intrinsic pixels for one image, aligned with libvips' guarded decode ceiling. */
const DEFAULT_MAX_IMAGE_PIXELS = 268402689;
/** Default maximum intrinsic width and height retained for one original image. */
const DEFAULT_MAX_IMAGE_DIMENSION = 65535;
/** Default maximum encoded bytes for one common text file. */
const DEFAULT_MAX_TEXT_BYTES = 50 * 1024 * 1024;
/** Default maximum common text files in one prompt. */
const DEFAULT_MAX_TEXT_ATTACHMENTS_PER_MESSAGE = 20;
/** Default maximum aggregate common text bytes in one prompt. */
const DEFAULT_MAX_MESSAGE_TEXT_BYTES = 100 * 1024 * 1024;
/** Default maximum original bytes for one structured document. */
const DEFAULT_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** Default maximum structured documents in one prompt. */
const DEFAULT_MAX_DOCUMENTS_PER_MESSAGE = 20;
/** Default maximum aggregate structured-document bytes in one prompt. */
const DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES = 100 * 1024 * 1024;
/** Maximum sum of OOXML entry sizes after decompression. */
const DEFAULT_MAX_DOCUMENT_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
/** Maximum OOXML central-directory entries. */
const DEFAULT_MAX_DOCUMENT_ARCHIVE_ENTRIES = 1e4;
/** Maximum uncompressed/compressed size ratio for any OOXML entry. */
const DEFAULT_MAX_DOCUMENT_COMPRESSION_RATIO = 100;
/** Maximum opening XML elements across one OOXML package. */
const DEFAULT_MAX_DOCUMENT_XML_NODES = 2e6;
/** Maximum captured OfficeCLI JSON bytes. */
const DEFAULT_MAX_DOCUMENT_PARSER_OUTPUT_BYTES = 32 * 1024 * 1024;
/** Default hard deadline for one OfficeCLI command. */
const DEFAULT_DOCUMENT_PARSE_TIMEOUT_MS = 3e4;
/** Default number of documents parsed concurrently. */
const DEFAULT_MAX_CONCURRENT_DOCUMENT_PARSES = 2;
/** Maximum durable card-preview characters. */
const DEFAULT_MAX_DOCUMENT_PREVIEW_CHARACTERS = 4e3;
/** Maximum model search matches per call. */
const DEFAULT_MAX_DOCUMENT_SEARCH_RESULTS = 50;
/** Maximum normalized items returned by one structured read. */
const DEFAULT_MAX_DOCUMENT_QUERY_ITEMS = 2e3;
/** Rows retained in one CSV/XLSX table block. */
const DEFAULT_CSV_ROWS_PER_BLOCK = 500;
/** Default boundary for switching spreadsheets to range-on-demand indexing. */
const DEFAULT_DOCUMENT_STREAM_THRESHOLD_BYTES = 20 * 1024 * 1024;
/** Persistent content-addressed local attachment store. */
var LocalAttachmentStore = class extends AttachmentStore {
	static Config = z.object({
		dshHome: z.string(),
		officeEnabled: z.boolean().default(true),
		maxImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_BYTES),
		maxImagesPerMessage: z.number().step(1).min(1).default(20),
		maxMessageImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_IMAGE_BYTES),
		maxImagePixels: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_PIXELS),
		maxImageDimension: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_DIMENSION),
		maxTextBytes: z.number().step(1).min(1).default(DEFAULT_MAX_TEXT_BYTES),
		maxTextAttachmentsPerMessage: z.number().step(1).min(1).default(20),
		maxMessageTextBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_TEXT_BYTES),
		maxDocumentBytes: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_BYTES),
		maxDocumentsPerMessage: z.number().step(1).min(1).default(20),
		maxMessageDocumentBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES),
		maxDocumentDecompressedBytes: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_DECOMPRESSED_BYTES),
		maxDocumentArchiveEntries: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_ARCHIVE_ENTRIES),
		maxDocumentCompressionRatio: z.number().min(1).default(100),
		maxDocumentXmlNodes: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_XML_NODES),
		maxDocumentParserOutputBytes: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_PARSER_OUTPUT_BYTES),
		documentParseTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DOCUMENT_PARSE_TIMEOUT_MS),
		maxConcurrentDocumentParses: z.number().step(1).min(1).default(2),
		maxDocumentPreviewCharacters: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_PREVIEW_CHARACTERS),
		maxDocumentSearchResults: z.number().step(1).min(1).default(50),
		maxDocumentQueryItems: z.number().step(1).min(1).default(DEFAULT_MAX_DOCUMENT_QUERY_ITEMS),
		csvRowsPerBlock: z.number().step(1).min(1).default(500),
		documentStreamThresholdBytes: z.number().step(1).min(1).default(DEFAULT_DOCUMENT_STREAM_THRESHOLD_BYTES),
		officeCliPath: z.string()
	});
	/** Absolute versioned storage root. */
	root;
	imageLimits;
	textLimits;
	documentLimits;
	documents;
	constructor(ctx, config) {
		super(ctx);
		this.root = resolve(join(resolveDshHome(config.dshHome), "attachments", "v1"));
		this.imageLimits = Object.freeze({
			maxImageBytes: config.maxImageBytes ?? 52428800,
			maxImagesPerMessage: config.maxImagesPerMessage ?? 20,
			maxMessageImageBytes: config.maxMessageImageBytes ?? 104857600,
			maxImagePixels: config.maxImagePixels ?? 268402689,
			maxImageDimension: config.maxImageDimension ?? 65535,
			mediaTypes: Object.freeze([
				"image/png",
				"image/jpeg",
				"image/webp",
				"image/gif"
			])
		});
		this.textLimits = Object.freeze({
			maxTextBytes: config.maxTextBytes ?? 52428800,
			maxTextAttachmentsPerMessage: config.maxTextAttachmentsPerMessage ?? 20,
			maxMessageTextBytes: config.maxMessageTextBytes ?? 104857600,
			mediaTypes: Object.freeze([
				"text/plain",
				"text/markdown",
				"text/csv",
				"text/tab-separated-values",
				"application/json",
				"application/x-ndjson",
				"application/yaml",
				"application/xml",
				"text/xml",
				"application/toml"
			])
		});
		this.documentLimits = Object.freeze({
			maxDocumentBytes: config.maxDocumentBytes ?? 52428800,
			maxDocumentsPerMessage: config.maxDocumentsPerMessage ?? 20,
			maxMessageDocumentBytes: config.maxMessageDocumentBytes ?? 104857600,
			maxDecompressedBytes: config.maxDocumentDecompressedBytes ?? 268435456,
			maxArchiveEntries: config.maxDocumentArchiveEntries ?? 1e4,
			maxCompressionRatio: config.maxDocumentCompressionRatio ?? 100,
			maxXmlNodes: config.maxDocumentXmlNodes ?? 2e6,
			maxParserOutputBytes: config.maxDocumentParserOutputBytes ?? 33554432,
			parseTimeoutMs: config.documentParseTimeoutMs ?? 3e4,
			maxConcurrentParses: config.maxConcurrentDocumentParses ?? 2,
			maxPreviewCharacters: config.maxDocumentPreviewCharacters ?? 4e3,
			maxSearchResults: config.maxDocumentSearchResults ?? 50,
			maxQueryItems: config.maxDocumentQueryItems ?? 2e3,
			csvRowsPerBlock: config.csvRowsPerBlock ?? 500,
			streamThresholdBytes: config.documentStreamThresholdBytes ?? 20971520,
			mediaTypes: Object.freeze(config.officeEnabled ?? true ? [
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				"application/vnd.openxmlformats-officedocument.presentationml.presentation",
				"text/csv"
			] : [])
		});
		this.documents = new DocumentPipeline(ctx, this.root, this.documentLimits, config.officeCliPath);
	}
	async validateImage(input) {
		await validateImageFile(input, this.imageLimits);
	}
	async saveImage(input) {
		return saveImageFile(this.root, input, this.imageLimits);
	}
	async readImage(ref, signal) {
		return readImageFile(this.root, ref, signal);
	}
	async readImageForModel(ref, options) {
		return readImageForModelFile(this.root, ref, options);
	}
	validateText(input) {
		validateTextFile(input, this.textLimits);
		return Promise.resolve();
	}
	async saveText(input) {
		return saveTextFile(this.root, input, this.textLimits);
	}
	async readText(ref, signal) {
		return readTextFile(this.root, ref, signal);
	}
	validateDocument(input) {
		validateDocumentFile(input, this.documentLimits);
		return Promise.resolve();
	}
	saveDocument(input) {
		return this.documents.save(input);
	}
	readDocument(ref, signal) {
		return this.documents.read(ref, signal);
	}
	queryDocument(ref, query, signal) {
		return this.documents.query(ref, query, signal);
	}
};
//#endregion
export { DEFAULT_CSV_ROWS_PER_BLOCK, DEFAULT_DOCUMENT_PARSE_TIMEOUT_MS, DEFAULT_DOCUMENT_STREAM_THRESHOLD_BYTES, DEFAULT_MAX_CONCURRENT_DOCUMENT_PARSES, DEFAULT_MAX_DOCUMENTS_PER_MESSAGE, DEFAULT_MAX_DOCUMENT_ARCHIVE_ENTRIES, DEFAULT_MAX_DOCUMENT_BYTES, DEFAULT_MAX_DOCUMENT_COMPRESSION_RATIO, DEFAULT_MAX_DOCUMENT_DECOMPRESSED_BYTES, DEFAULT_MAX_DOCUMENT_PARSER_OUTPUT_BYTES, DEFAULT_MAX_DOCUMENT_PREVIEW_CHARACTERS, DEFAULT_MAX_DOCUMENT_QUERY_ITEMS, DEFAULT_MAX_DOCUMENT_SEARCH_RESULTS, DEFAULT_MAX_DOCUMENT_XML_NODES, DEFAULT_MAX_IMAGES_PER_MESSAGE, DEFAULT_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_DIMENSION, DEFAULT_MAX_IMAGE_PIXELS, DEFAULT_MAX_MESSAGE_DOCUMENT_BYTES, DEFAULT_MAX_MESSAGE_IMAGE_BYTES, DEFAULT_MAX_MESSAGE_TEXT_BYTES, DEFAULT_MAX_TEXT_ATTACHMENTS_PER_MESSAGE, DEFAULT_MAX_TEXT_BYTES, DocumentPipeline, LocalAttachmentStore, LocalAttachmentStore as default, OFFICECLI_DARWIN_ARM64_SHA256, OFFICECLI_VERSION, OfficeCli, readImageFile, readImageForModelFile, readTextFile, saveImageFile, saveTextFile, validateDocumentFile, validateImageFile, validateTextFile };
