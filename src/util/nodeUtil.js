import path from 'path';
import {fileURLToPath} from 'url';
import {app} from "electron";

export const getDirname = (metaUrl) => path.dirname(fileURLToPath(metaUrl));
export const getFilename = (metaUrl) => fileURLToPath(metaUrl);
export const getResourceFilePath = (fileNameStartFromAppRoot) => {
    return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), fileNameStartFromAppRoot);
}
export const logInfo = (...message) => {
    !app.isPackaged && console.info(...message);
}
export const logError = (...message) => {
    !app.isPackaged && console.error(...message);
}
export const logWarn = (...message) => {
    !app.isPackaged && console.warn(...message);
}

