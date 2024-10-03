import { command, option, run, string, positional, subcommands, optional, boolean, flag } from "cmd-ts";
import { ExistingPath } from 'cmd-ts/batteries/fs';
import { BunnyListing, BunnyStorage } from "./storage.js";
import { BunnyRegion } from "./region.js";
import { hexToArray } from "./util.js";
import { diffPaths } from "./storage-algorithms.js";

interface Config {
    apiKey?: string;
    storageZone?: string;
    region?: string;
}

const configParser = {
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
}

function getStorage({ apiKey, storageZone, region: rawRegion }: Config): BunnyStorage {
    rawRegion = rawRegion || process.env.BUNNY_REGION;
    let region: BunnyRegion;
    if (rawRegion) {
        if (!(rawRegion in BunnyRegion))
            throw new Error(`Unknown region '${rawRegion}`);
        region = BunnyRegion[rawRegion];
    }
    return new BunnyStorage(
        apiKey || process.env.BUNNY_API_KEY,
        storageZone || process.env.BUNNY_STORAGE_ZONE,
        region
    );
}

const ls = command({
    name: "ls",
    args: {
        path: positional({
            type: string,
            displayName: "PATH"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        let listing: BunnyListing;
        if (args.path.endsWith("/"))
            listing = await storage.list(args.path);
        else
            listing = [await storage.describe(args.path)];
        listing.forEach(entry => console.log(entry.format()));
    }
});

const cat = command({
    name: "cat",
    args: {
        path: positional({
            type: string,
            displayName: "PATH"
        }),
        checksum: option({
            type: optional(string),
            long: "checksum"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        let checksum: Uint8Array;
        if (args.checksum)
            checksum = hexToArray(args.checksum);
        const buffer = await storage.download(args.path, checksum);
        process.stdout.write(buffer);
    }
});

const diff = command({
    name: "diff",
    args: {
        localPath: positional({
            type: ExistingPath,
            displayName: "LOCAL-PATH"
        }),
        remotePath: positional({
            type: string,
            displayName: "REMOTE-PATH"
        }),
        recursive: flag({
            type: boolean,
            long: "recursive",
            short: "r"
        }),
        ...configParser
    },
    handler: async args => {
        const storage = getStorage(args);
        const differences = await diffPaths(storage, args.localPath, args.remotePath, args.recursive);
        if (differences)
            console.log(differences.format(d => d.format()).join("\n"));
        else
            console.log("Paths identical");
    }
})

const app = subcommands({
    name: "bunnyctl",
    cmds: { cat, diff, ls }
});

export async function runCLI(args: string[]) {
    try {
        await run(app, args);
    }
    catch (ex) {
        console.error(ex.toString());
        process.exit(1);
    }
}
