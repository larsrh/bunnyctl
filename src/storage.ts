import { pipe } from "fp-ts/function";
import * as D from "io-ts/Decoder";
import { validate as uuidValidate } from "uuid";
import { BunnyRegion } from "./region.js";
import { arrayEquals, arrayToHex, decode, hexDecoder } from "./util.js";

const uuidDecoder: D.Decoder<unknown, string> = pipe(
    D.string,
    D.parse((uuid: string) => {
        if (uuidValidate(uuid))
            return D.success(uuid);
        else
            return D.failure(uuid, "Malformed UUID");
    })
)

export const bunnyFileEntry = Symbol();
export const bunnyDirectoryEntry = Symbol();

export interface BunnyBasicEntry {
    type: typeof bunnyFileEntry | typeof bunnyDirectoryEntry;
    guid: string;
    storageZoneName: string;
    path: string;
    objectName: string;

    fullPath: string;

    format(): string;
    delete(recursive: boolean): Promise<void>
}

export interface BunnyFileEntry extends BunnyBasicEntry {
    type: typeof bunnyFileEntry;
    length: number;
    checksum: Uint8Array;

    download(validate?: boolean): Promise<Uint8Array>
    replace(body: Uint8Array): Promise<BunnyFileEntry>;
    delete(): Promise<void>
}

export interface BunnyDirectoryEntry extends BunnyBasicEntry {
    type: typeof bunnyDirectoryEntry;

    list(subpath?: string): Promise<BunnyListing>;
    upload(path: string, body: Uint8Array): Promise<BunnyFileEntry>;
}

export type BunnyEntry = BunnyFileEntry | BunnyDirectoryEntry;
export type BunnyListing = BunnyEntry[];

export function isBunnyFile(entry: BunnyEntry): entry is BunnyFileEntry {
    return entry.type == bunnyFileEntry;
}

export function isBunnyDirectory(entry: BunnyEntry): entry is BunnyDirectoryEntry {
    return entry.type == bunnyDirectoryEntry;
}

const bunnyEntryDecoder = pipe(
    D.struct({
        Guid: uuidDecoder,
        StorageZoneName: D.string,
        Path: D.string,
        ObjectName: D.string,
        IsDirectory: D.boolean,
        Length: D.number,
        Checksum: D.nullable(hexDecoder)
    }),
    D.parse(({ Guid, StorageZoneName, Path, ObjectName, IsDirectory, Length, Checksum }) => {
        if (!Path.startsWith(`/${StorageZoneName}/`))
            return D.failure(Path, "Expected path to start with the storage zone name");
        if (ObjectName.includes("/"))
            return D.failure(ObjectName, "Unexpected / in object name");

        // strip the prefix containing the storage zone name, including first and second slash
        let cleanPath = Path.slice(Path.indexOf('/', 1) + 1);
        // unless it's the root of that storage zone, in which case we need to use '/'
        if (cleanPath == "")
            cleanPath = "/";

        return D.success({
            guid: Guid,
            storageZoneName: StorageZoneName,
            path: cleanPath,
            objectName: ObjectName,
            isDirectory: IsDirectory,
            length: Length,
            checksum: Checksum
        })
    })
);

const bunnyListingDecoder = D.array(bunnyEntryDecoder);

function getHost(region?: BunnyRegion): string {
    if (!region || region == BunnyRegion.FALKENSTEIN)
        return "storage.bunnycdn.com";

    return `${region}.storage.bunnycdn.com`;
}

class AbstractBunnyEntry {
    constructor(
        private readonly storage: BunnyStorage,
        readonly type: typeof bunnyFileEntry | typeof bunnyDirectoryEntry,
        readonly guid: string,
        readonly storageZoneName: string,
        readonly path: string,
        readonly objectName: string,
        readonly length: number,
        readonly checksum: Uint8Array
    ) {
        if ((type == bunnyDirectoryEntry) != !checksum)
            throw new Error(`Mismatch between directory flag and presence of checksum`);
        if (!path.endsWith("/"))
            throw new Error(`Expected path '${path}' to end with /`)
    }

    get fullPath() {
        return `${this.path}${this.objectName}`;
    }

    list(childPath?: string) {
        if (this.type == bunnyFileEntry)
            throw new Error("Cannot list a file");

        let path = this.fullPath;
        if (childPath) path += `/${childPath}`;
        return this.storage.list(path);
    }

    download(validate?: boolean): Promise<Uint8Array> {
        if (this.type == bunnyDirectoryEntry)
            throw new Error("Cannot download a directory");

        return this.storage.download(this.fullPath, validate && this.checksum);
    }

    replace(body: Uint8Array): Promise<BunnyFileEntry> {
        if (this.type == bunnyDirectoryEntry)
            throw new Error("Cannot replace a directory");

        return this.storage.upload(this.fullPath, body);
    }

    upload(childPath: string, body: Uint8Array): Promise<BunnyFileEntry> {
        if (this.type == bunnyFileEntry)
            throw new Error("Cannot upload into a file; use 'replace' instead");

        return this.storage.upload(`${this.fullPath}/${childPath}`, body);
    }

    delete(recursive: boolean = false) {
        if (this.type == bunnyDirectoryEntry && !recursive)
            throw new Error("Cannot delete a directory without 'recursive' set to true")

        return this.storage.delete(this.fullPath);
    }

    format(): string {
        let symbol: string;
        let fileProps = "";
        if (this.type == bunnyFileEntry) {
            symbol = '🗒️';
            fileProps = ` (length = ${this.length}, checksum = ${arrayToHex(this.checksum)})`;
        }
        else {
            symbol = '📁';
        }

        return `${symbol} ${this.objectName}${fileProps}`;
    }
}

interface FetchParameters {
    method?: string,
    checksum?: Uint8Array,
    body?: BodyInit
}

export class BunnyStorage {
    private readonly baseURL: string;

    private makeRequestHeaders(checksum?: Uint8Array): Headers {
        const headers = new Headers({
            'AccessKey': this.apiKey
        });
        if (checksum) {
            // this is an upload, so we can also set the content type of the request body
            headers.set("Checksum", arrayToHex(checksum).toUpperCase());
            headers.set("Content-Type", "application/octet-stream");
        }
        return headers;
    }

    constructor(private readonly apiKey: string, storageZone: string, region?: BunnyRegion) {
        if (storageZone.includes("/"))
            throw new Error(`Storage zone `);
        this.baseURL = `https://${getHost(region)}/${storageZone}`;
    }

    private async fetch(
        path: string,
        { method, checksum, body }: FetchParameters = {}
    ): Promise<Response> {
        if (path.startsWith("/"))
            path = path.slice(1);

        const response = await fetch(
            `${this.baseURL}/${path}`,
            {
                method,
                body,
                headers: this.makeRequestHeaders(checksum)
            }
        );

        if (!response.ok)
            throw new Error(`Request for path '${path}' failed with status ${response.status}`);
        return response;
    }

    private parseEntry(entry: D.TypeOf<typeof bunnyEntryDecoder>): BunnyEntry {
        return new AbstractBunnyEntry(
            this,
            entry.isDirectory ? bunnyDirectoryEntry : bunnyFileEntry,
            entry.guid,
            entry.storageZoneName,
            entry.path,
            entry.objectName,
            entry.length,
            entry.checksum
        );
    }

    async download(path: string, expectedChecksum?: Uint8Array): Promise<Uint8Array> {
        if (path.endsWith("/"))
            throw new Error(`Cannot download directory '${path}'; file expected`);
        const response = await this.fetch(path);
        if (!response.headers.has("ETag"))
            throw new Error(`Expected a file, but '${path}' is a directory`);

        const body = new Uint8Array(await response.arrayBuffer());
        if (expectedChecksum) {
            const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
            if (!arrayEquals(expectedChecksum, checksum))
                throw new Error(`Checksum mismatch: expected ${arrayToHex(expectedChecksum)}, received ${arrayToHex(checksum)}`);
        }

        return body;
    }

    async upload(path: string, body: Uint8Array): Promise<BunnyFileEntry> {
        if (path.endsWith("/"))
            throw new Error(`Cannot upload directory '${path}'; file expected`);

        const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", body));

        await this.fetch(path, { method: "PUT", body, checksum });

        return this.describe(path);
    }

    async delete(path: string): Promise<void> {
        await this.fetch(path, { method: "DELETE" });
    }

    async describe(path: string): Promise<BunnyFileEntry> {
        if (path.endsWith("/"))
            throw new Error(`Cannot download directory '${path}'; file expected`);
        const response = await this.fetch(path, { method: "DESCRIBE" });
        if (response.headers.get("Content-Type") != "application/json")
            throw new Error("Unexpected Content-Type in response");
        const json = await response.json();
        const entry = decode(bunnyEntryDecoder, json);
        return this.parseEntry(entry) as BunnyFileEntry;
    }

    async list(path?: string): Promise<BunnyListing> {
        path = path || "";
        if (path != "" && !path.endsWith("/"))
            path += "/";
        const response = await this.fetch(path);
        if (response.headers.has("ETag"))
            throw new Error(`Expected a directory, but '${path}' is a file`);
        if (response.headers.get("Content-Type") != "application/json")
            throw new Error("Unexpected Content-Type in response");
        const json = await response.json();
        const listing = decode(bunnyListingDecoder, json);
        return listing.map(entry => this.parseEntry(entry));
    }
}