import { isBunnyFile, type BunnyStorage, type BunnyDirectoryEntry, type BunnyEntry, type BunnyFileEntry, type BunnyListing } from "./storage.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { arrayDiff, arrayEquals, coalesce } from "./util.js";
import { Tree } from "./util/tree.js";

export type DifferenceType = "contents" | "type" | "onlyLocal" | "onlyRemote";

export class Difference {
    constructor(
        readonly localPath?: string,
        readonly remotePath?: string,
        readonly type?: DifferenceType
    ) {
    }

    format(): string {
        if (!this.type)
            return `📁 ${this.remotePath}`;

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

export async function diffFiles(localPath: string, remoteFile: BunnyFileEntry): Promise<PathDifference | undefined> {
    const stat = await fs.stat(localPath);

    if (!stat.isFile)
        return new Tree(new Difference(localPath, remoteFile.fullPath, "type"));

    const localFile = await fs.readFile(localPath);
    const localChecksum = new Uint8Array(await crypto.subtle.digest("SHA-256", localFile));
    if (!arrayEquals(remoteFile.checksum, localChecksum))
        return new Tree(new Difference(localPath, remoteFile.fullPath, "contents"));
}

async function diffDirectoriesFromEntries(
    localPath: string,
    remotePath: string,
    remoteEntries: BunnyListing,
    recursive: boolean
): Promise<PathDifference | undefined> {
    const stat = await fs.stat(localPath);

    if (!stat.isDirectory)
        return new Tree(new Difference(localPath, remotePath, "type"));

    const remoteEntriesDict = Object.fromEntries(remoteEntries.map(entry => [entry.objectName, entry]));

    const { onlyLeft: onlyLocal, onlyRight: onlyRemote, both } = arrayDiff(
        await fs.readdir(localPath),
        Object.keys(remoteEntriesDict)
    );

    let children: PathDifference[] = [];
    if (recursive)
        children = coalesce(await Promise.all(
            both.map(name =>
                diffPathsFromEntry(path.join(localPath, name), remoteEntriesDict[name], true)
            )
        ));

    if (onlyLocal.length > 0 || onlyRemote.length > 0 || children.length > 0)
        return new Tree(
            new Difference(localPath, remotePath),
            [
                ...onlyLocal.map(l => new Tree(new Difference(l, undefined, "onlyLocal"))),
                ...onlyRemote.map(r => new Tree(new Difference(undefined, r, "onlyRemote"))),
                ...children
            ]
        )
}

export async function diffDirectories(localPath: string, remoteDirectory: BunnyDirectoryEntry, recursive: boolean): Promise<PathDifference | undefined> {
    return diffDirectoriesFromEntries(
        localPath,
        remoteDirectory.fullPath,
        await remoteDirectory.list(),
        recursive
    );
}

export async function diffPathsFromEntry(localPath: string, remote: BunnyEntry, recursive: boolean = false): Promise<PathDifference | undefined> {
    if (isBunnyFile(remote))
        return diffFiles(localPath, remote);

    return diffDirectories(localPath, remote, recursive);
}

export async function diffPaths(storage: BunnyStorage, localPath: string, remotePath: string, recursive: boolean = false): Promise<PathDifference | undefined> {
    if (remotePath.endsWith("/"))
        return diffDirectoriesFromEntries(
            localPath,
            remotePath,
            await storage.list(remotePath),
            recursive
        );

    return diffFiles(
        localPath,
        await storage.describe(remotePath)
    );
}