import {
    isBunnyFile,
    type BunnyStorage,
    type BunnyDirectoryEntry,
    type BunnyEntry,
    type BunnyFileEntry
} from "./storage.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { arrayDiff, arrayEquals, coalesce, computeChecksum } from "./util.js";
import { Tree } from "./util/tree.js";

export type DifferenceType = "contents" | "type" | "onlyLocal" | "onlyRemote";

export class Difference {
    constructor(
        readonly localPath?: string,
        readonly remotePath?: string,
        readonly type?: DifferenceType
    ) {}

    format(): string {
        if (!this.type) return `📁 ${this.remotePath}`;

        switch (this.type) {
            case "onlyLocal":
                return `❌ Only local: '${this.localPath}'`;
            case "onlyRemote":
                return `❌ Only remote: '${this.remotePath}'`;
            case "type":
                return `⚡ '${this.remotePath}' and '${this.localPath}' differ in type`;
            case "contents":
                return `📄 '${this.remotePath}' and '${this.localPath}' differ in content`;
        }
    }
}

export type PathDifference = Tree<Difference>;

export async function diffFiles(
    localPath: string,
    remoteFile: BunnyFileEntry
): Promise<PathDifference | undefined> {
    const stat = await fs.stat(localPath);

    if (!stat.isFile)
        return new Tree(new Difference(localPath, remoteFile.path, "type"));

    const localFile = await fs.readFile(localPath);
    const localChecksum = new Uint8Array(
        await crypto.subtle.digest("SHA-256", localFile)
    );
    if (!arrayEquals(remoteFile.checksum, localChecksum))
        return new Tree(new Difference(localPath, remoteFile.path, "contents"));
}

export async function diffDirectories(
    localPath: string,
    remoteDirectory: BunnyDirectoryEntry,
    recursive: boolean
): Promise<PathDifference | undefined> {
    const stat = await fs.stat(localPath);

    if (!stat.isDirectory)
        return new Tree(
            new Difference(localPath, remoteDirectory.path, "type")
        );

    const remoteEntries = await remoteDirectory.list();
    const remoteEntriesDict = Object.fromEntries(
        remoteEntries.map(entry => [entry.name, entry])
    );

    const {
        onlyLeft: onlyLocal,
        onlyRight: onlyRemote,
        both
    } = arrayDiff(await fs.readdir(localPath), Object.keys(remoteEntriesDict));

    let children: PathDifference[] = [];
    if (recursive)
        children = coalesce(
            await Promise.all(
                both.map(name =>
                    diffPaths(
                        path.join(localPath, name),
                        remoteEntriesDict[name],
                        true
                    )
                )
            )
        );

    if (onlyLocal.length > 0 || onlyRemote.length > 0 || children.length > 0)
        return new Tree(new Difference(localPath, remoteDirectory.path), [
            ...onlyLocal.map(
                l => new Tree(new Difference(l, undefined, "onlyLocal"))
            ),
            ...onlyRemote.map(
                r => new Tree(new Difference(undefined, r, "onlyRemote"))
            ),
            ...children
        ]);
}

export async function diffPaths(
    localPath: string,
    remote: BunnyEntry,
    recursive: boolean = false
): Promise<PathDifference | undefined> {
    if (isBunnyFile(remote)) return diffFiles(localPath, remote);

    return diffDirectories(localPath, remote, recursive);
}

export type CopyProgress = (
    entry: BunnyFileEntry,
    changed: boolean
) => Promise<void>;

export interface CopyOptions {
    recursive?: boolean;
    overwrite?: boolean;
    progress?: CopyProgress;
}

export async function uploadFile(
    storage: BunnyStorage,
    localPath: string,
    remotePath: string,
    overwrite: boolean,
    progress: CopyProgress
): Promise<BunnyFileEntry> {
    const maybeEntry = await storage.maybeDescribe(remotePath);
    const localFile = await fs.readFile(localPath);
    let checksum: Uint8Array;

    if (maybeEntry) {
        checksum = await computeChecksum(localFile);
        if (arrayEquals(checksum, maybeEntry.checksum)) {
            // file identical, carry on
            await progress(maybeEntry, false);
            return;
        }

        if (!overwrite)
            throw new Error(
                `Remote file '${remotePath}' exists, but 'overwrite' not specified`
            );
    }

    // file doesn't exist or is different, just upload
    const entry = await storage.upload(remotePath, localFile, checksum);
    await progress(entry, true);
    return entry;
}

export async function uploadDirectory(
    storage: BunnyStorage,
    localPath: string,
    remoteEntry: BunnyDirectoryEntry,
    overwrite: boolean,
    progress: CopyProgress
): Promise<BunnyFileEntry[]> {
    const result: BunnyFileEntry[] = [];
    for (const name of await fs.readdir(localPath)) {
        const subResult = await uploadPath(
            storage,
            path.join(localPath, name),
            `${remoteEntry.path}/${name}`,
            { recursive: true, overwrite, progress }
        );
        result.push(...subResult);
    }
    return result;
}

export async function uploadPath(
    storage: BunnyStorage,
    localPath: string,
    remotePath: string,
    options: CopyOptions = {}
): Promise<BunnyFileEntry[]> {
    const {
        overwrite = false,
        recursive = false,
        progress = async () => {}
    } = options;

    const stat = await fs.stat(localPath);

    if (stat.isFile()) {
        return [
            await uploadFile(
                storage,
                localPath,
                remotePath,
                overwrite,
                progress
            )
        ];
    }

    if (stat.isDirectory()) {
        if (!recursive)
            throw new Error(
                `Local path '${localPath}' is a directory, but 'recursive' not specified`
            );

        const entry = storage.cd(remotePath);
        return uploadDirectory(storage, localPath, entry, overwrite, progress);
    }

    throw new Error("Unknown local path kind, neither file nor directory");
}

export async function loadPath(
    storage: BunnyStorage,
    path: string
): Promise<BunnyEntry> {
    if (path.endsWith("/")) return storage.cd(path);

    return storage.describe(path);
}
