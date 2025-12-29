import { boolean, flag, option, optional, string, type Type } from "cmd-ts";
import { BunnyStorage } from "../storage.js";
import { BunnyRegion } from "../region.js";
import * as fs from "node:fs/promises";

export type PathType = "local" | "remote";

export interface TypedPath {
    type: PathType;
    path: string;
}

export interface Config {
    apiKey?: string;
    storageZone?: string;
    region?: string;
}

export const configParser = {
    apiKey: option({
        type: optional(string),
        long: "api-key"
    }),
    storageZone: option({
        type: optional(string),
        long: "storage-zone"
    }),
    region: option({
        type: optional(string),
        long: "region"
    })
};

export const recursive = flag({
    type: boolean,
    long: "recursive",
    short: "r"
});

export function parseTypedPath(path: string): [PathType | undefined, string] {
    if (path.startsWith("local:")) return ["local", path.substring(6)];

    if (path.startsWith("remote:")) return ["remote", path.substring(7)];

    return [undefined, path];
}

export function typedPath(defaultType?: PathType): Type<string, TypedPath> {
    return {
        async from(str) {
            // eslint-disable-next-line prefer-const
            let [type, path] = parseTypedPath(str);
            if (!type) {
                if (!defaultType) throw new Error("No path type specified");
                type = defaultType;
            }

            if (type == "local") {
                // just check for existence
                await fs.stat(path);
            }

            return { type, path };
        },
        get displayName() {
            return "LOCAL-OR-REMOTE-PATH";
        },
        get description() {
            let desc = "";
            if (defaultType) desc = `, default: ${defaultType}`;

            return `local or remote path with a prefix ('local:' or 'remote:' ${desc})`;
        }
    };
}

export function getStorage({
    apiKey,
    storageZone,
    region: rawRegion
}: Config): BunnyStorage {
    rawRegion = rawRegion || process.env.BUNNY_REGION;
    let region: BunnyRegion;
    if (rawRegion) {
        if (!(rawRegion in BunnyRegion))
            throw new Error(`Unknown region '${rawRegion}`);
        region = BunnyRegion[rawRegion as keyof typeof BunnyRegion];
    }

    if (!apiKey && !process.env.BUNNY_API_KEY)
        throw new Error(
            "API key not specified as parameter nor environment variable"
        );

    if (!storageZone && !process.env.BUNNY_STORAGE_ZONE)
        throw new Error(
            "Storage zone not specified as parameter nor environment variable"
        );

    return new BunnyStorage(
        apiKey || process.env.BUNNY_API_KEY,
        storageZone || process.env.BUNNY_STORAGE_ZONE,
        region
    );
}
