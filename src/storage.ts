import { pipe } from "fp-ts/lib/function.js";
import * as D from "io-ts/lib/Decoder.js";
import { BunnyRegion } from "./region.js";
import {
    arrayEquals,
    arrayToHex,
    computeChecksum,
    decode,
    hexDecoder
} from "./util.js";
import * as p from "node:path/posix";

export const bunnyFileEntry = Symbol();
export const bunnyDirectoryEntry = Symbol();

export type BunnyType = typeof bunnyFileEntry | typeof bunnyDirectoryEntry;

export interface BunnyBasicEntry {
    type: BunnyType;
    parentPath: string;
    name: string;
    path: string;

    format(fullPath?: boolean): string;
    delete(recursive: boolean): Promise<void>;
}

export interface BunnyFileEntry extends BunnyBasicEntry {
    type: typeof bunnyFileEntry;

    length: number;
    checksum: Uint8Array;

    download(validate?: boolean): Promise<Uint8Array>;
    replace(body: Uint8Array): Promise<BunnyFileEntry>;
    delete(): Promise<void>;
}

export interface BunnyDirectoryEntry extends BunnyBasicEntry {
    type: typeof bunnyDirectoryEntry;

    list(): Promise<BunnyListing>;
    upload(childPath: string, body: Uint8Array): Promise<BunnyFileEntry>;
}

export type BunnyEntry = BunnyFileEntry | BunnyDirectoryEntry;
export type BunnyListing = BunnyEntry[];

export function isBunnyFile(entry: BunnyEntry): entry is BunnyFileEntry {
    return entry.type == bunnyFileEntry;
}

export function isBunnyDirectory(
    entry: BunnyEntry
): entry is BunnyDirectoryEntry {
    return entry.type == bunnyDirectoryEntry;
}

const bunnyEntryDecoder = pipe(
    D.struct({
        StorageZoneName: D.string,
        Path: D.string,
        ObjectName: D.string,
        IsDirectory: D.boolean,
        Length: D.number,
        Checksum: D.nullable(hexDecoder)
    }),
    D.parse(
        ({
            StorageZoneName,
            Path,
            ObjectName,
            IsDirectory,
            Length,
            Checksum
        }) => {
            if (!Path.startsWith(`/${StorageZoneName}/`))
                return D.failure(
                    Path,
                    "Expected path to start with the storage zone name"
                );
            if (ObjectName.includes("/"))
                return D.failure(ObjectName, "Unexpected / in object name");

            // strip the prefix containing the storage zone name, including first and second slash
            let cleanPath = Path.slice(Path.indexOf("/", 1) + 1);
            // unless it's the root of that storage zone, in which case we need to use '/'
            if (cleanPath == "") cleanPath = "/";

            return D.success({
                parentPath: cleanPath,
                name: ObjectName,
                isDirectory: IsDirectory,
                length: Length,
                checksum: Checksum
            });
        }
    )
);

const bunnyListingDecoder = D.array(bunnyEntryDecoder);

function getHost(region?: BunnyRegion): string {
    if (!region || region == BunnyRegion.FALKENSTEIN)
        return "storage.bunnycdn.com";

    return `${region}.storage.bunnycdn.com`;
}

class AbstractBunnyEntry<T extends BunnyType> implements BunnyBasicEntry {
    constructor(
        private readonly storage: BunnyStorage,
        readonly type: T,
        readonly parentPath: string,
        readonly name: string,
        readonly length: number,
        readonly checksum: Uint8Array
    ) {
        if ((type == bunnyDirectoryEntry) != !checksum)
            throw new Error(
                `Mismatch between directory flag and presence of checksum`
            );
        if (!parentPath.endsWith("/"))
            throw new Error(
                `Expected parent path '${parentPath}' to end with /`
            );
    }

    get path() {
        return `${this.parentPath}${this.name}`;
    }

    list() {
        if (this.type == bunnyFileEntry) throw new Error("Cannot list a file");

        return this.storage.list(this.path);
    }

    download(validate?: boolean): Promise<Uint8Array> {
        if (this.type == bunnyDirectoryEntry)
            throw new Error("Cannot download a directory");

        return this.storage.download(this.path, validate && this.checksum);
    }

    replace(body: Uint8Array): Promise<BunnyFileEntry> {
        if (this.type == bunnyDirectoryEntry)
            throw new Error("Cannot replace a directory");

        return this.storage.upload(this.path, body);
    }

    upload(childPath: string, body: Uint8Array): Promise<BunnyFileEntry> {
        if (this.type == bunnyFileEntry)
            throw new Error("Cannot upload into a file; use 'replace' instead");

        return this.storage.upload(`${this.path}/${childPath}`, body);
    }

    delete(recursive: boolean = false) {
        if (this.type == bunnyDirectoryEntry && !recursive)
            throw new Error(
                "Cannot delete a directory without 'recursive' set to true"
            );

        return this.storage.delete(this.path);
    }

    format(fullPath: boolean = false): string {
        let symbol: string;
        let fileProps = "";
        if (this.type == bunnyFileEntry) {
            symbol = "🗒️";
            fileProps = ` (length = ${this.length}, checksum = ${arrayToHex(this.checksum)})`;
        } else {
            symbol = "📁";
        }

        let name: string;
        if (fullPath) name = this.path;
        else name = this.name;

        return `${symbol} ${name}${fileProps}`;
    }
}

interface FetchParameters {
    method?: string;
    checksum?: Uint8Array;
    body?: BodyInit;
    throwOnError?: boolean;
}

export class BunnyStorage {
    private readonly baseURL: string;

    private makeRequestHeaders(checksum?: Uint8Array): Headers {
        const headers = new Headers({
            AccessKey: this.apiKey
        });
        if (checksum) {
            // this is an upload, so we can also set the content type of the request body
            headers.set("Checksum", arrayToHex(checksum).toUpperCase());
            headers.set("Content-Type", "application/octet-stream");
        }
        return headers;
    }

    constructor(
        private readonly apiKey: string,
        storageZone: string,
        region?: BunnyRegion
    ) {
        if (storageZone.includes("/")) throw new Error(`Storage zone `);
        this.baseURL = `https://${getHost(region)}/${storageZone}`;
    }

    private async fetch(
        path: string,
        { method, checksum, body, throwOnError = true }: FetchParameters = {}
    ): Promise<Response> {
        if (path.startsWith("/")) path = path.slice(1);

        const response = await fetch(`${this.baseURL}/${path}`, {
            method,
            body,
            headers: this.makeRequestHeaders(checksum)
        });

        if (!response.ok && throwOnError)
            throw new Error(
                `Request for path '${path}' failed with status ${response.status}`
            );
        return response;
    }

    private parseEntry(entry: D.TypeOf<typeof bunnyEntryDecoder>): BunnyEntry {
        return new AbstractBunnyEntry(
            this,
            entry.isDirectory ? bunnyDirectoryEntry : bunnyFileEntry,
            entry.parentPath,
            entry.name,
            entry.length,
            entry.checksum
        );
    }

    async download(
        path: string,
        expectedChecksum?: Uint8Array
    ): Promise<Uint8Array> {
        if (path.endsWith("/"))
            throw new Error(
                `Cannot download directory '${path}'; file expected`
            );
        const response = await this.fetch(path);
        if (!response.headers.has("ETag"))
            throw new Error(`Expected a file, but '${path}' is a directory`);

        const body = new Uint8Array(await response.arrayBuffer());
        if (expectedChecksum) {
            const checksum = new Uint8Array(
                await crypto.subtle.digest("SHA-256", body)
            );
            if (!arrayEquals(expectedChecksum, checksum))
                throw new Error(
                    `Checksum mismatch: expected ${arrayToHex(expectedChecksum)}, received ${arrayToHex(checksum)}`
                );
        }

        return body;
    }

    async upload(
        path: string,
        body: Uint8Array,
        checksum?: Uint8Array
    ): Promise<BunnyFileEntry> {
        if (path.endsWith("/"))
            throw new Error(`Cannot upload directory '${path}'; file expected`);

        if (!checksum) checksum = await computeChecksum(body);

        await this.fetch(path, { method: "PUT", body, checksum });

        const described = await this.describe(path);

        if (!arrayEquals(checksum, described.checksum))
            throw new Error(
                `Checksum mismatch: expected ${arrayToHex(checksum)}, received ${arrayToHex(described.checksum)}`
            );

        return described;
    }

    async delete(path: string): Promise<void> {
        await this.fetch(path, { method: "DELETE" });
    }

    async describe(path: string): Promise<BunnyFileEntry> {
        const entry = await this.maybeDescribe(path);
        if (!entry) throw new Error(`File ${path} not found`);
        return entry;
    }

    async maybeDescribe(path: string): Promise<BunnyFileEntry | undefined> {
        if (path.endsWith("/"))
            throw new Error(`File expected, '${path}' received`);
        const response = await this.fetch(path, {
            method: "DESCRIBE",
            throwOnError: false
        });
        if (response.ok) {
            // TODO https://github.com/nock/nock/issues/2832
            /*if (response.headers.get("Content-Type") != "application/json")
                throw new Error("Unexpected Content-Type in response");*/
            const json: unknown = await response.json();
            const entry = decode(bunnyEntryDecoder, json);
            return this.parseEntry(entry) as BunnyFileEntry;
        }
        if (response.status == 404) return;
        throw new Error(`Unknown response ${response.status} for path ${path}`);
    }

    cd(path: string = "/"): BunnyDirectoryEntry {
        const parsed = p.parse(path);
        let dir = parsed.dir;
        if (!dir.endsWith("/")) dir += "/";

        return new AbstractBunnyEntry(
            this,
            bunnyDirectoryEntry,
            dir,
            parsed.base,
            0,
            undefined
        );
    }

    async list(path?: string): Promise<BunnyListing> {
        path = path || "";
        if (path != "" && !path.endsWith("/")) path += "/";
        const response = await this.fetch(path);
        if (response.headers.has("ETag"))
            throw new Error(`Expected a directory, but '${path}' is a file`);
        if (response.headers.get("Content-Type") != "application/json")
            throw new Error("Unexpected Content-Type in response");
        const json: unknown = await response.json();
        const listing = decode(bunnyListingDecoder, json);
        return listing.map(entry => this.parseEntry(entry));
    }
}
