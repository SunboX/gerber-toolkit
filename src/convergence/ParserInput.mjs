const ASSET_MODES = new Set(['none', 'metadata', 'full'])
const EXTENSION_MODES = new Set(['none', 'metadata', 'canonical', 'full'])
const RETAIN_SOURCE_MODES = new Set(['none', 'reference'])
const WORKER_MODES = new Set(['auto', true, false])

/** Normalizes source-neutral parser requests for the Gerber adapter. */
export class ParserInput {
    /**
     * Normalizes one parser request without invoking caller accessors.
     * @param {unknown} input Parser input candidate.
     * @param {unknown} [options] Common parser options.
     * @returns {Record<string, any>} Normalized request.
     */
    static normalize(input, options = {}) {
        const fields = ParserInput.plainFields(
            input,
            'Gerber parser input must be a plain object.'
        )
        const optionFields = ParserInput.plainFields(
            options,
            'Gerber parser options must be a plain object.'
        )
        if (!ParserInput.isData(fields.data)) {
            throw new TypeError(
                'Gerber parser data must be a string, ArrayBuffer, or Uint8Array.'
            )
        }
        if (fields.assets !== undefined && !Array.isArray(fields.assets)) {
            throw new TypeError('Gerber parser assets must be an array.')
        }
        const worker =
            optionFields.worker === undefined ? 'auto' : optionFields.worker
        if (!WORKER_MODES.has(worker)) {
            throw new TypeError('Gerber worker must be auto, true, or false.')
        }
        if (
            optionFields.onProgress !== undefined &&
            typeof optionFields.onProgress !== 'function'
        ) {
            throw new TypeError('Gerber onProgress must be a function.')
        }
        return {
            input: {
                fileName: ParserInput.fileName(fields.fileName),
                data: fields.data,
                assets: fields.assets || []
            },
            sourceReference: input,
            options: {
                preserveRaw: optionFields.preserveRaw === true,
                decodeAssets: ParserInput.enumValue(
                    optionFields.decodeAssets,
                    'metadata',
                    ASSET_MODES,
                    'asset decode mode'
                ),
                extensions: ParserInput.extensions(optionFields.extensions),
                reports: ParserInput.stringList(optionFields.reports),
                retainSource: ParserInput.enumValue(
                    optionFields.retainSource,
                    'none',
                    RETAIN_SOURCE_MODES,
                    'source retention mode'
                ),
                worker,
                transferInput: optionFields.transferInput === true,
                signal: optionFields.signal,
                onProgress: optionFields.onProgress
            }
        }
    }

    /**
     * Performs bounded filename and content detection.
     * @param {unknown} input Input candidate.
     * @returns {boolean} Whether the input is supported.
     */
    static supports(input) {
        try {
            const fields = ParserInput.plainFields(
                input,
                'Gerber parser input must be a plain object.'
            )
            if (!ParserInput.isData(fields.data)) return false
            const fileName = ParserInput.fileName(fields.fileName)
            if (
                /\.(?:gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gko|gm1|drl|xln)$/iu.test(
                    fileName
                )
            ) {
                return true
            }
            const sample = ParserInput.sample(fields.data)
            return /%FS|%MO|%AD|G04|^M48\b|T\d+C[0-9.]+/imu.test(sample)
        } catch {
            return false
        }
    }

    /**
     * Returns a normalized source name.
     * @param {unknown} input Input or filename.
     * @returns {string} Normalized filename.
     */
    static fileName(input) {
        let value = input
        if (input && typeof input === 'object') {
            try {
                value = ParserInput.plainFields(
                    input,
                    'Gerber parser input must be a plain object.'
                ).fileName
            } catch {
                value = ''
            }
        }
        return String(value || '')
            .replaceAll('\\', '/')
            .replace(/^\.\//u, '')
    }

    /**
     * Copies the exact input byte window for native parsing.
     * @param {string | ArrayBuffer | Uint8Array} data Source data.
     * @returns {Uint8Array} Owned or exact source bytes.
     */
    static bytes(data) {
        if (typeof data === 'string') return new TextEncoder().encode(data)
        if (data instanceof ArrayBuffer) return new Uint8Array(data)
        if (data instanceof Uint8Array) {
            if (
                data.byteOffset === 0 &&
                data.byteLength === data.buffer.byteLength
            ) {
                return data
            }
            return new Uint8Array(
                data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength
                )
            )
        }
        throw new TypeError(
            'Gerber parser data must be a string, ArrayBuffer, or Uint8Array.'
        )
    }

    /** @param {unknown} value Candidate. @returns {boolean} Data support. */
    static isData(value) {
        return (
            typeof value === 'string' ||
            value instanceof ArrayBuffer ||
            value instanceof Uint8Array
        )
    }

    /**
     * Reads one accessor-free plain record.
     * @param {unknown} value Candidate.
     * @param {string} message Failure message.
     * @returns {Record<string, any>} Own values.
     */
    static plainFields(value, message) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(message)
        }
        let prototype
        let descriptors
        try {
            prototype = Object.getPrototypeOf(value)
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            throw new TypeError(message)
        }
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(message)
        }
        const fields = Object.create(null)
        for (const [name, descriptor] of Object.entries(descriptors)) {
            if (!Object.hasOwn(descriptor, 'value')) {
                throw new TypeError(
                    'Accessor-backed parser fields are invalid.'
                )
            }
            fields[name] = descriptor.value
        }
        return fields
    }

    /**
     * Normalizes a common enum.
     * @param {unknown} value Candidate.
     * @param {string} fallback Fallback.
     * @param {Set<any>} allowed Allowed values.
     * @param {string} label Error label.
     * @returns {any} Normalized value.
     */
    static enumValue(value, fallback, allowed, label) {
        const normalized = value === undefined ? fallback : value
        if (!allowed.has(normalized)) {
            throw new TypeError(`Unsupported Gerber ${label}: ${normalized}.`)
        }
        return normalized
    }

    /**
     * Normalizes extension selection.
     * @param {unknown} value Candidate.
     * @returns {string | string[]} Selection.
     */
    static extensions(value) {
        if (Array.isArray(value)) return ParserInput.stringList(value)
        return ParserInput.enumValue(
            value,
            'canonical',
            EXTENSION_MODES,
            'extension mode'
        )
    }

    /**
     * Normalizes one unique string list.
     * @param {unknown} value Candidate.
     * @returns {string[]} Values.
     */
    static stringList(value) {
        if (value === undefined) return []
        if (!Array.isArray(value)) {
            throw new TypeError('Gerber option list must be an array.')
        }
        const values = []
        const seen = new Set()
        for (let index = 0; index < value.length; index += 1) {
            const normalized = String(value[index]).trim()
            if (!normalized) {
                throw new TypeError('Gerber option ids must not be empty.')
            }
            if (!seen.has(normalized)) {
                seen.add(normalized)
                values.push(normalized)
            }
        }
        return values
    }

    /**
     * Reads a bounded text sample without retaining the full source.
     * @param {string | ArrayBuffer | Uint8Array} data Source data.
     * @returns {string} Detection sample.
     */
    static sample(data) {
        if (typeof data === 'string') return data.slice(0, 2048)
        return new TextDecoder().decode(
            ParserInput.bytes(data).subarray(0, 2048)
        )
    }
}

Object.freeze(ParserInput.prototype)
Object.freeze(ParserInput)
