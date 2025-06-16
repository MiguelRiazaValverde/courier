import { FileData } from "./file";





async function folderToZipFileData(entry, onProgress = null) {
    const folderFiles = [];
    await traverseFileTree(entry, folderFiles);
    const zipBlob = await createZipFromFiles(folderFiles, onProgress);

    const zipBuffer = await zipBlob.arrayBuffer();
    const zipUint8 = new Uint8Array(zipBuffer);

    const fileData = new FileData(entry.name + ".zip", "zip", zipUint8);
    return fileData;
}

async function fileToFileData(entry) {
    return await new Promise((resolve, reject) => {
        entry.file(async file => {
            const buffer = await file.arrayBuffer();
            const uint8file = new Uint8Array(buffer);
            const fileData = new FileData(entry.name, "file", uint8file);
            resolve(fileData);
        }, reject);
    });
}


async function createZipFromFiles(files, onProgress = null) {
    const zip = new JSZip();

    for (const file of files)
        zip.file(file.fullPath || file.name, file);

    const blob = await zip.generateAsync(
        { type: "blob" },
        metadata => {
            if (onProgress) {
                onProgress(metadata.percent); // porcentaje entre 0 y 100
            }
        }
    );
    return blob;
}


async function traverseFileTree(entry, fileList, path = "") {
    return new Promise((resolve, reject) => {
        if (entry.isFile) {
            entry.file(file => {
                file.fullPath = path + file.name;
                fileList.push(file);
                resolve();
            }, reject);
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            reader.readEntries(async entries => {
                for (const ent of entries) {
                    await traverseFileTree(ent, fileList, path + entry.name + "/");
                }
                resolve();
            }, reject);
        }
    });
}






export class DropHandler extends EventTarget {
    static PROGRESS = "progress";
    static FILE_ADDED = "file-added";

    constructor(elem) {
        super();

        elem.addEventListener("dragover", (e) => {
            e.preventDefault();
            elem.classList.add("dragover");
        });

        elem.addEventListener("dragleave", () => {
            elem.classList.remove("dragover");
        });

        elem.addEventListener("drop", event => this.handleDrop(event));
    }


    async handleDrop(event) {
        event.preventDefault();
        const items = event.dataTransfer.items;
        const resultFiles = [];

        for (const item of items) {
            const entry = item.webkitGetAsEntry();
            if (!entry) continue;

            if (entry.isDirectory) {
                const fileData = await folderToZipFileData(entry, (percent) => {
                    this.dispatchEvent(new CustomEvent(DropHandler.PROGRESS, {
                        detail: {
                            name: entry.name + ".zip",
                            percent
                        }
                    }));
                });
                resultFiles.push(fileData);
            } else if (entry.isFile) {
                resultFiles.push(await fileToFileData(entry));
            }
        }

        for (const fileData of resultFiles) {
            const detail = {
                type: FileData.ADDED_EVENT,
                name: fileData.name,
                fileType: fileData.type,
                fileData: fileData
            };
            this.dispatchEvent(new CustomEvent(DropHandler.FILE_ADDED, { detail }));
        }
    }

    onFileAdded(callback) {
        this.addEventListener(DropHandler.FILE_ADDED, event => callback(event.detail));
    }

    onProgress(callback) {
        this.addEventListener(DropHandler.PROGRESS, event => callback(event.detail));
    }
}

